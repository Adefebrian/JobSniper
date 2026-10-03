use crate::adapters::{page_with_jobs, FetchRequest};
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, strip_html};
use crate::http::HttpClient;
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use serde_json::Value;

pub async fn fetch_page(http: &HttpClient, request: &FetchRequest) -> Result<AdapterPage> {
    let endpoint = endpoint(&request.url, &request.config)?;
    let response = http.get(&endpoint).await?;
    let mut page = parse_lever(&response.text())?;
    page.content_hash = Some(crate::dedup::content_hash(&response.body));
    page.etag = response.etag.clone();
    page.final_url = Some(response.final_url.clone());
    Ok(page)
}

pub fn parse_lever(body: &str) -> Result<AdapterPage> {
    let root: Value =
        serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let postings = root
        .as_array()
        .ok_or_else(|| CrawlerError::Parse("Lever response is not an array".to_owned()))?;
    let mut records = Vec::new();
    for posting in postings {
        let title = required_text(posting, "text")?;
        let url = posting
            .get("hostedUrl")
            .or_else(|| posting.get("applyUrl"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| CrawlerError::Parse("Lever posting has no hostedUrl".to_owned()))?;
        let description = posting
            .get("descriptionPlain")
            .or_else(|| posting.get("description"))
            .or_else(|| posting.get("description"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        records.push(JobRecord {
            title,
            url,
            apply_url: posting
                .get("applyUrl")
                .and_then(Value::as_str)
                .map(str::to_owned),
            external_id: posting.get("id").and_then(Value::as_str).map(str::to_owned),
            company: None,
            location: posting
                .get("categories")
                .and_then(|categories| categories.get("location"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            description: strip_html(description),
            posted_at: posting
                .get("createdAt")
                .and_then(Value::as_number)
                .and_then(|value| value.as_i64().map(chrono::DateTime::from_timestamp_millis))
                .flatten(),
            emails: extract_emails(description),
            source_kind: JobSourceKind::Lever,
        });
    }
    Ok(page_with_jobs(records))
}

fn endpoint(request_url: &str, config: &Value) -> Result<String> {
    if request_url.contains("api.lever.co/v0/postings/") {
        return Ok(request_url.to_owned());
    }
    let organization = config
        .get("organization")
        .or_else(|| config.get("org"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| organization_from_url(request_url))
        .ok_or_else(|| CrawlerError::InvalidConfig("Lever organization is required".to_owned()))?;
    Ok(format!(
        "https://api.lever.co/v0/postings/{organization}?mode=json"
    ))
}

fn organization_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    parsed
        .host_str()
        .filter(|host| host.ends_with("lever.co"))?;
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
        .ok_or_else(|| CrawlerError::Parse(format!("Lever posting is missing {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lever_fixture() {
        let page = parse_lever(include_str!("../../tests/fixtures/lever.json")).unwrap();
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].external_id.as_deref(), Some("a1b2c3"));
        assert_eq!(
            page.jobs[0].apply_url.as_deref(),
            Some("https://jobs.lever.co/acme/a1b2c3/apply")
        );
    }
}
