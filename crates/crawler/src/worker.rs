use crate::adapters::{AdapterRegistry, FetchRequest};
use crate::dedup::content_hash;
use crate::error::{CrawlerError, ErrorClass, Result};
use crate::extract::extract_html;
use crate::http::HttpClient;
use crate::model::{CrawlArtifact, TaskKind};
use crate::queue::{CrawlTask, TaskQueue, TaskResult};
use crate::render::LightpandaRenderer;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
pub struct CrawlPayload {
    pub kind: TaskKind,
    pub url: Option<String>,
    pub source_id: Option<String>,
    #[serde(default)]
    pub career_source_id: Option<String>,
    pub company_id: Option<String>,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessingOutcome {
    Extracted { jobs: usize, discovered: usize },
    Discovered { links: usize },
    JobOpen,
    JobClosed,
}

#[async_trait]
pub trait ArtifactSink: Send + Sync {
    async fn store(&self, artifact: &CrawlArtifact) -> Result<()>;

    async fn record_failure(
        &self,
        career_source_id: Option<&str>,
        source_id: Option<&str>,
        url: &str,
        blocked: bool,
        error: &str,
    ) -> Result<()> {
        let _ = (career_source_id, source_id, url, blocked, error);
        Ok(())
    }
}

pub struct NoopArtifactSink;

#[async_trait]
impl ArtifactSink for NoopArtifactSink {
    async fn store(&self, _artifact: &CrawlArtifact) -> Result<()> {
        Ok(())
    }
}

pub struct CrawlerWorker<Q, S>
where
    Q: TaskQueue,
    S: ArtifactSink,
{
    worker_id: String,
    queue: Arc<Q>,
    http: Arc<HttpClient>,
    renderer: Arc<LightpandaRenderer>,
    sink: Arc<S>,
    registry: AdapterRegistry,
}

impl<Q, S> CrawlerWorker<Q, S>
where
    Q: TaskQueue,
    S: ArtifactSink,
{
    pub fn new(
        worker_id: impl Into<String>,
        queue: Arc<Q>,
        http: Arc<HttpClient>,
        renderer: Arc<LightpandaRenderer>,
        sink: Arc<S>,
    ) -> Self {
        Self {
            worker_id: worker_id.into(),
            queue,
            http,
            renderer,
            sink,
            registry: AdapterRegistry,
        }
    }

    pub async fn run_once(&self, lease_seconds: i64) -> Result<Option<ProcessingOutcome>> {
        let Some(task) = self.queue.claim(&self.worker_id, lease_seconds).await? else {
            return Ok(None);
        };
        let result = self.process(&task).await;
        let outcome = match result {
            Ok((outcome, artifact)) => {
                if let Some(artifact) = artifact {
                    if let Err(store_error) = self.sink.store(&artifact).await {
                        let backoff_seconds = retry_delay_seconds(task.attempts);
                        let report_error = self
                            .queue
                            .retry(&task.id, &store_error.to_string(), backoff_seconds)
                            .await;
                        return match report_error {
                            Ok(()) => Err(store_error),
                            Err(queue_error) => Err(queue_error),
                        };
                    }
                }
                let summary = match &outcome {
                    ProcessingOutcome::Extracted { jobs, discovered } => {
                        format!("{jobs} jobs and {discovered} discovered links extracted")
                    }
                    ProcessingOutcome::Discovered { links } => format!("{links} links discovered"),
                    ProcessingOutcome::JobOpen => "job is open".to_owned(),
                    ProcessingOutcome::JobClosed => "job is closed".to_owned(),
                };
                self.queue
                    .report(&task.id, TaskResult::Done { summary })
                    .await?;
                outcome
            }
            Err(error) => {
                let blocked = error.class() == ErrorClass::Blocked;
                // "Breaker open" means we chose not to ask; it says nothing new about the source,
                // so it must not count toward that source's failures (that cascade blocked 25 boards).
                let breaker_hold = error.to_string().contains("circuit breaker is open");
                if breaker_hold {
                    self.queue
                        .report(&task.id, TaskResult::Retry { error: error.to_string(), backoff_seconds: 15 * 60 })
                        .await?;
                    return Err(error);
                }
                if let Err(sink_error) = self
                    .sink
                    .record_failure(
                        task.payload.get("career_source_id").and_then(Value::as_str),
                        task.source_id.as_deref(),
                        task.payload
                            .get("url")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        blocked,
                        &error.to_string(),
                    )
                    .await
                {
                    eprintln!("failed to persist crawl error: {sink_error}");
                }
                let result = match error.class() {
                    ErrorClass::Permanent => TaskResult::Failed {
                        error: error.to_string(),
                    },
                    ErrorClass::Retryable | ErrorClass::Blocked => TaskResult::Retry {
                        error: error.to_string(),
                        backoff_seconds: retry_delay_seconds(task.attempts),
                    },
                };
                self.queue.report(&task.id, result).await?;
                return Err(error);
            }
        };
        Ok(Some(outcome))
    }

    async fn process(
        &self,
        task: &CrawlTask,
    ) -> Result<(ProcessingOutcome, Option<CrawlArtifact>)> {
        let mut payload: CrawlPayload = serde_json::from_value(task.payload.clone())
            .map_err(|error| CrawlerError::InvalidPayload(error.to_string()))?;
        if payload.source_id.is_none() {
            payload.source_id.clone_from(&task.source_id);
        }
        match payload.kind {
            TaskKind::Crawl => self.crawl(payload).await,
            TaskKind::Discover => self.discover(payload).await,
            TaskKind::ClosedCheck => self.closed_check(payload).await,
        }
    }

    async fn crawl(
        &self,
        payload: CrawlPayload,
    ) -> Result<(ProcessingOutcome, Option<CrawlArtifact>)> {
        let url = required_url(&payload)?;
        let config = adapter_config(&payload);
        let request = FetchRequest {
            url: url.clone(),
            source_id: payload.source_id.clone(),
            company_id: payload.company_id.clone(),
            config,
        };
        let mut page = self
            .registry
            .fetch_page(&self.http, &request, payload.method.as_deref(), None)
            .await?;
        let multi_company = request.config.get("multi_company").and_then(Value::as_bool) == Some(true);
        let close_missing = request.config.get("close_missing").and_then(Value::as_bool) == Some(true);
        if let Some(separator) = request.config.get("title_company_separator").and_then(Value::as_str) {
            // "Samsara: Staff Software Engineer" (We Work Remotely) -> company + title
            for job in &mut page.jobs {
                if job.company.is_none() {
                    if let Some((company, title)) = job.title.split_once(separator) {
                        job.company = Some(company.trim().to_owned());
                        job.title = title.trim().to_owned();
                    }
                }
            }
        }
        let external_id = payload.external_id.clone();
        for job in &mut page.jobs {
            if job.external_id.is_none() {
                job.external_id.clone_from(&external_id);
            }
        }

        let render_requested = payload.method.as_deref() == Some("headless")
            || payload.config.get("render").and_then(Value::as_bool) == Some(true);
        if render_requested {
            let rendered = self.renderer.render(&url).await?;
            let extracted = extract_html(&rendered, &url)?;
            page.jobs.extend(extracted.jobs);
            page.discovered_urls
                .extend(extracted.links.into_iter().map(|link| link.url));
            page.content_hash = Some(content_hash(rendered.as_bytes()));
        }
        page.jobs.sort_by(|left, right| left.url.cmp(&right.url));
        page.jobs.dedup_by(|left, right| left.url == right.url);
        page.discovered_urls.sort();
        page.discovered_urls.dedup();

        let final_url = page
            .final_url
            .clone()
            .unwrap_or_else(|| request.url.clone());
        let artifact = CrawlArtifact {
            source_id: payload.source_id,
            career_source_id: payload.career_source_id,
            company_id: payload.company_id,
            requested_url: url,
            final_url,
            content_hash: page.content_hash.clone().unwrap_or_else(|| {
                content_hash(&serde_json::to_vec(&page.jobs).unwrap_or_default())
            }),
            etag: page.etag,
            jobs: page.jobs.clone(),
            emails: page
                .jobs
                .iter()
                .flat_map(|job| job.emails.iter().cloned())
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect(),
            links: page
                .discovered_urls
                .iter()
                .map(|url| crate::model::DiscoveredLink {
                    url: url.clone(),
                    kind: crate::model::DiscoveredLinkKind::Job,
                    label: None,
                })
                .collect(),
            ats_indicators: Vec::new(),
            multi_company,
            close_missing,
        };
        let discovered = page.discovered_urls.len();
        Ok((
            ProcessingOutcome::Extracted {
                jobs: page.jobs.len(),
                discovered,
            },
            Some(artifact),
        ))
    }

    async fn discover(
        &self,
        payload: CrawlPayload,
    ) -> Result<(ProcessingOutcome, Option<CrawlArtifact>)> {
        let url = required_url(&payload)?;
        let response = self.http.get(&url).await?;
        let extracted = extract_html(&response.text(), &response.final_url)?;
        let artifact = CrawlArtifact {
            source_id: payload.source_id,
            career_source_id: payload.career_source_id,
            company_id: payload.company_id,
            requested_url: url,
            final_url: response.final_url,
            content_hash: extracted.content_hash,
            etag: response.etag,
            jobs: extracted.jobs,
            emails: extracted.emails,
            links: extracted.links,
            ats_indicators: extracted.ats_indicators.into_iter().collect(),
            multi_company: false,
            close_missing: false,
        };
        let links = artifact.links.len();
        Ok((ProcessingOutcome::Discovered { links }, Some(artifact)))
    }

    async fn closed_check(
        &self,
        payload: CrawlPayload,
    ) -> Result<(ProcessingOutcome, Option<CrawlArtifact>)> {
        let url = required_url(&payload)?;
        let response = match self.http.get(&url).await {
            Ok(response) => response,
            Err(CrawlerError::Http {
                status: 404 | 410, ..
            }) => return Ok((ProcessingOutcome::JobClosed, None)),
            Err(error) => return Err(error),
        };
        let body = response.text().to_ascii_lowercase();
        let closed = body.contains("job has been closed")
            || body.contains("this position has been filled")
            || body.contains("no longer accepting applications");
        Ok((
            if closed {
                ProcessingOutcome::JobClosed
            } else {
                ProcessingOutcome::JobOpen
            },
            None,
        ))
    }
}

fn required_url(payload: &CrawlPayload) -> Result<String> {
    payload
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| CrawlerError::InvalidPayload("payload.url is required".to_owned()))
}

fn adapter_config(payload: &CrawlPayload) -> Value {
    let mut config = match &payload.config {
        Value::Object(object) => Value::Object(object.clone()),
        Value::Null => Value::Object(serde_json::Map::new()),
        value => value.clone(),
    };
    if let Some(adapter) = &payload.adapter {
        config["adapter"] = Value::String(adapter.clone());
    }
    config
}

fn retry_delay_seconds(attempts: i32) -> i64 {
    let exponent = attempts.clamp(0, 19) as u32;
    (30i64 * (2i64.saturating_pow(exponent))).min(24 * 60 * 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_is_exponential_and_capped() {
        assert_eq!(retry_delay_seconds(0), 30);
        assert_eq!(retry_delay_seconds(1), 60);
        assert_eq!(retry_delay_seconds(8), 7680);
        assert_eq!(retry_delay_seconds(20), 24 * 60 * 60);
    }
}
