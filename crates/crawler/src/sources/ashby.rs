use crate::adapters::{page_with_jobs, FetchRequest};
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, parse_datetime, strip_html};
use crate::http::HttpClient;
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use serde_json::Value;

pub async fn fetch_page(http: &HttpClient, request: &FetchRequest) -> Result<AdapterPage> {
    let endpoint = endpoint(&request.url, &request.config)?;
    let response = http.get(&endpoint).await?;
    let mut page = parse_ashby(&response.text())?;
    page.content_hash = Some(crate::dedup::content_hash(&response.body));
    page.etag = response.etag.clone();
    page.final_url = Some(response.final_url.clone());
    Ok(page)
}

pub fn parse_ashby(body: &str) -> Result<AdapterPage> {
    let root: Value =
        serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let jobs = root
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or_else(|| CrawlerError::Parse("Ashby response has no jobs array".to_owned()))?;
    let mut records = Vec::new();
    for job in jobs {
        let title = required_text(job, "title")?;
        let url = job
            .get("jobUrl")
            .or_else(|| job.get("jobUrl"))
            .or_else(|| job.get("applyUrl"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| CrawlerError::Parse("Ashby job has no jobUrl".to_owned()))?;
        let description = job
            .get("descriptionHtml")
            .or_else(|| job.get("description"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        records.push(JobRecord {
            title,
            url,
            apply_url: job
                .get("applyUrl")
                .or_else(|| job.get("jobUrl"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            external_id: job
                .get("id")
                .or_else(|| job.get("jobId"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            company: job
                .get("organizationName")
                .and_then(Value::as_str)
                .map(str::to_owned),
            location: job
                .get("location")
                .and_then(Value::as_str)
                .map(str::to_owned),
            description: strip_html(description),
            posted_at: job
                .get("publishedAt")
                .or_else(|| job.get("publishedDate"))
                .and_then(Value::as_str)
                .and_then(parse_datetime),
            emails: extract_emails(description),
            source_kind: JobSourceKind::Ashby,
        });
    }
    Ok(page_with_jobs(records))
}

fn endpoint(request_url: &str, config: &Value) -> Result<String> {
    if request_url.contains("api.ashbyhq.com/posting-api/job-board/") {
        return Ok(request_url.to_owned());
    }
    let board = config
        .get("board")
        .or_else(|| config.get("organization"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| board_from_url(request_url))
        .ok_or_else(|| CrawlerError::InvalidConfig("Ashby board is required".to_owned()))?;
    Ok(format!(
        "https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true"
    ))
}

fn board_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    parsed
        .host_str()
        .filter(|host| host.ends_with("ashbyhq.com"))?;
    parsed
        .path_segments()?
        .find(|segment| !segment.is_empty())
        .map(str::to_owned)
}

fn required_text(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| CrawlerError::Parse(format!("Ashby job is missing {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ashby_fixture() {
        let page = parse_ashby(include_str!("../../tests/fixtures/ashby.json")).unwrap();
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].external_id.as_deref(), Some("ashby-100"));
        assert!(page.jobs[0].description.contains("Applied AI"));
    }
}
