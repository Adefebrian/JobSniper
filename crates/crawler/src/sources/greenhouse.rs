use crate::adapters::{page_with_jobs, FetchRequest};
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, html_to_blocks, parse_datetime, strip_html};
use crate::http::HttpClient;
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use serde_json::{json, Value};

pub async fn fetch_page(http: &HttpClient, request: &FetchRequest) -> Result<AdapterPage> {
    let endpoint = endpoint(&request.url, &request.config)?;
    let response = http.get(&endpoint).await?;
    let mut page = parse_greenhouse(&response.text())?;
    page.content_hash = Some(crate::dedup::content_hash(&response.body));
    page.etag = response.etag.clone();
    page.final_url = Some(response.final_url.clone());
    Ok(page)
}

pub fn parse_greenhouse(body: &str) -> Result<AdapterPage> {
    let root: Value =
        serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let jobs = root
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or_else(|| CrawlerError::Parse("Greenhouse response has no jobs array".to_owned()))?;
    let mut records = Vec::new();
    for job in jobs {
        let title = required_text(job, "title")?;
        let url = required_text(job, "absolute_url")?;
        let id = job
            .get("id")
            .map(|value| match value {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .filter(|value| !value.is_empty());
        let content = job
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        records.push(JobRecord {
            title,
            url: url.clone(),
            apply_url: Some(url),
            external_id: id,
            company: None,
            location: job
                .get("location")
                .and_then(|location| location.get("name"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            description: html_to_blocks(content),
            posted_at: job
                .get("first_published")
                .or_else(|| job.get("updated_at"))
                .and_then(Value::as_str)
                .and_then(parse_datetime),
            emails: extract_emails(content),
            source_kind: JobSourceKind::Greenhouse,
        });
    }
    Ok(page_with_jobs(records))
}

fn endpoint(request_url: &str, config: &Value) -> Result<String> {
    if request_url.contains("boards-api.greenhouse.io/v1/boards/") {
        return Ok(request_url.to_owned());
    }
    let board_token = config
        .get("board_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| token_from_url(request_url));
    let board_token = board_token.ok_or_else(|| {
        CrawlerError::InvalidConfig("Greenhouse board_token is required".to_owned())
    })?;
    Ok(format!(
        "https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true"
    ))
}

fn token_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segments: Vec<_> = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect();
    let token_after_boards = segments
        .iter()
        .position(|segment| segment.eq_ignore_ascii_case("boards"))
        .and_then(|index| segments.get(index + 1));
    if let Some(token) = token_after_boards {
        return Some((*token).to_owned());
    }
    if parsed.host_str()?.ends_with("greenhouse.io") {
        return segments.first().map(|value| (*value).to_owned());
    }
    None
}

fn required_text(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| CrawlerError::Parse(format!("Greenhouse job is missing {key}")))
}

#[allow(dead_code)]
fn request_shape(_: &serde_json::Value) -> Value {
    json!({})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_greenhouse_fixture() {
        let page = parse_greenhouse(include_str!("../../tests/fixtures/greenhouse.json")).unwrap();
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].external_id.as_deref(), Some("4812901"));
        assert_eq!(page.jobs[0].location.as_deref(), Some("Singapore"));
        assert!(page.jobs[0].description.contains("LLM agents"));
    }
}
