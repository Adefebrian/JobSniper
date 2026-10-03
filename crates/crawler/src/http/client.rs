use super::breaker::{FailureKind, FailureTracker};
use super::limiter::DomainRateLimiter;
use super::robots::RobotsCache;
use crate::error::{CrawlerError, ErrorClass, Result};
use futures::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, ETAG, LOCATION, USER_AGENT};
use reqwest::{Method, StatusCode};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone)]
pub struct FetchResponse {
    pub status: u16,
    pub final_url: String,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub struct HttpClient {
    client: reqwest::Client,
    user_agent: String,
    max_body_bytes: usize,
    max_redirects: usize,
    rate_limiter: Arc<DomainRateLimiter>,
    robots: Arc<RobotsCache>,
    failures: Arc<FailureTracker>,
}

impl HttpClient {
    pub fn new(
        user_agent: impl Into<String>,
        timeout: Duration,
        max_body_bytes: usize,
        max_redirects: usize,
        requests_per_second_per_domain: f64,
    ) -> Result<Self> {
        let user_agent = user_agent.into();
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| CrawlerError::Network(error.to_string()))?;
        let robots = Arc::new(RobotsCache::new(user_agent.clone()));
        Ok(Self {
            client,
            user_agent,
            max_body_bytes,
            max_redirects,
            rate_limiter: Arc::new(DomainRateLimiter::new(requests_per_second_per_domain)),
            robots,
            failures: Arc::new(FailureTracker::new()),
        })
    }

    pub fn robots(&self) -> Arc<RobotsCache> {
        Arc::clone(&self.robots)
    }

    pub async fn get(&self, url: &str) -> Result<FetchResponse> {
        self.request_checked(Method::GET, url, None).await
    }

    pub async fn head(&self, url: &str) -> Result<FetchResponse> {
        self.request_checked(Method::HEAD, url, None).await
    }

    pub async fn post_json(&self, url: &str, body: &serde_json::Value) -> Result<FetchResponse> {
        self.request_checked(Method::POST, url, Some(body)).await
    }

    pub async fn fetch_for_robots(&self, url: &Url) -> Result<FetchResponse> {
        let mut current = url.clone();
        let mut redirects = 0;
        loop {
            self.rate_limiter.wait_for(&current).await;
            let response = self
                .client
                .get(current.clone())
                .header(USER_AGENT, &self.user_agent)
                .header(ACCEPT, "text/plain, */*")
                .send()
                .await
                .map_err(|error| CrawlerError::Network(error.to_string()))?;
            let status = response.status();
            if status.is_redirection() {
                if redirects >= self.max_redirects {
                    return Err(CrawlerError::Http {
                        status: status.as_u16(),
                        message: "robots.txt redirect limit exceeded".to_owned(),
                    });
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| CrawlerError::Http {
                        status: status.as_u16(),
                        message: "robots.txt redirect did not include Location".to_owned(),
                    })?;
                current = current
                    .join(location)
                    .map_err(|error| CrawlerError::InvalidUrl {
                        url: location.to_owned(),
                        reason: error.to_string(),
                    })?;
                redirects += 1;
                continue;
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let etag = response
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let body = read_capped(response, self.max_body_bytes).await?;
            return Ok(FetchResponse {
                status: status.as_u16(),
                final_url: current.to_string(),
                content_type,
                etag,
                body,
            });
        }
    }

    async fn request_checked(
        &self,
        method: Method,
        url: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<FetchResponse> {
        let parsed = Url::parse(url).map_err(|error| CrawlerError::InvalidUrl {
            url: url.to_owned(),
            reason: error.to_string(),
        })?;
        if let Some(until) = self.failures.is_blocked(&parsed) {
            let retry_after = until
                .checked_duration_since(std::time::Instant::now())
                .unwrap_or_default();
            return Err(CrawlerError::Blocked {
                url: parsed.to_string(),
                reason: format!(
                    "circuit breaker is open for {:.0} seconds",
                    retry_after.as_secs()
                ),
            });
        }
        match self.robots.is_allowed(self, &parsed).await {
            Ok(true) => {}
            Ok(false) => {
                let error = CrawlerError::RobotsDenied {
                    url: parsed.to_string(),
                };
                self.record_error(&parsed, &error);
                return Err(error);
            }
            Err(error) => {
                self.record_error(&parsed, &error);
                return Err(error);
            }
        }
        self.request_url(method, parsed, body).await
    }

    async fn request_url(
        &self,
        mut method: Method,
        mut url: Url,
        body: Option<&serde_json::Value>,
    ) -> Result<FetchResponse> {
        let mut redirects = 0;
        let mut body = body;
        loop {
            self.rate_limiter.wait_for(&url).await;
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .header(USER_AGENT, &self.user_agent)
                .header(ACCEPT, "*/*");
            if let Some(body) = body {
                request = request.header(CONTENT_TYPE, "application/json").json(body);
            }
            let response = request
                .send()
                .await
                .map_err(|error| CrawlerError::Network(error.to_string()))?;
            let status = response.status();

            if status.is_redirection() {
                if redirects >= self.max_redirects {
                    return Err(CrawlerError::Http {
                        status: status.as_u16(),
                        message: "redirect limit exceeded".to_owned(),
                    });
                }
                let Some(location) = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                else {
                    return Err(CrawlerError::Http {
                        status: status.as_u16(),
                        message: "redirect response did not include Location".to_owned(),
                    });
                };
                let next = url
                    .join(location)
                    .map_err(|error| CrawlerError::InvalidUrl {
                        url: location.to_owned(),
                        reason: error.to_string(),
                    })?;
                if !self.robots.is_allowed(self, &next).await? {
                    return Err(CrawlerError::RobotsDenied {
                        url: next.to_string(),
                    });
                }
                if status == StatusCode::SEE_OTHER {
                    method = Method::GET;
                    body = None;
                }
                url = next;
                redirects += 1;
                continue;
            }

            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let etag = response
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let bytes = read_capped(response, self.max_body_bytes).await?;
            let fetch_response = FetchResponse {
                status: status.as_u16(),
                final_url: url.to_string(),
                content_type,
                etag,
                body: bytes,
            };

            let error = status_error(status, &fetch_response);
            if let Some(error) = error {
                self.record_error(&url, &error);
                return Err(error);
            }
            if is_bot_wall(&fetch_response) {
                let error = CrawlerError::Blocked {
                    url: url.to_string(),
                    reason: "response looked like a CAPTCHA or bot wall".to_owned(),
                };
                self.record_error(&url, &error);
                return Err(error);
            }
            self.failures.record_success(&url);
            return Ok(fetch_response);
        }
    }

    fn record_error(&self, url: &Url, error: &CrawlerError) {
        let kind = match error.class() {
            ErrorClass::Blocked => FailureKind::Blocked,
            ErrorClass::Retryable => FailureKind::Retryable,
            ErrorClass::Permanent => return,
        };
        self.failures.record_failure(url, kind);
    }
}

async fn read_capped(response: reqwest::Response, max_body_bytes: usize) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| CrawlerError::Network(error.to_string()))?;
        if body.len() + chunk.len() > max_body_bytes {
            return Err(CrawlerError::BodyTooLarge {
                limit: max_body_bytes,
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn status_error(status: StatusCode, response: &FetchResponse) -> Option<CrawlerError> {
    if status.is_success() {
        return None;
    }
    let message = String::from_utf8_lossy(&response.body);
    Some(CrawlerError::Http {
        status: status.as_u16(),
        message: message.chars().take(300).collect(),
    })
}

fn is_bot_wall(response: &FetchResponse) -> bool {
    // Real challenge pages are small HTML documents. A JSON API answer or a full job page that merely
    // mentions "captcha" (HN comments, a job at an anti-bot company) is not a wall.
    let content_type = response.content_type.as_deref().unwrap_or_default().to_ascii_lowercase();
    if content_type.contains("json") || content_type.contains("xml") || response.body.len() > 60_000 {
        return false;
    }
    let body = String::from_utf8_lossy(&response.body).to_ascii_lowercase();
    [
        "captcha",
        "verify you are human",
        "access denied",
        "unusual traffic",
        "cloudflare ray id",
    ]
    .iter()
    .any(|marker| body.contains(marker))
}
