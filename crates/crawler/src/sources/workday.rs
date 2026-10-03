use crate::adapters::{page_with_jobs, FetchRequest};
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, parse_datetime, strip_html};
use crate::http::HttpClient;
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

#[derive(Debug, Deserialize)]
struct WorkdayConfig {
    tenant: Option<String>,
    site: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
    search_text: Option<String>,
}

pub async fn fetch_page(
    http: &HttpClient,
    request: &FetchRequest,
    cursor: Option<&str>,
) -> Result<AdapterPage> {
    let config: WorkdayConfig = serde_json::from_value(request.config.clone())
        .map_err(|error| CrawlerError::InvalidConfig(error.to_string()))?;
    if config.limit == 0 {
        return Err(CrawlerError::InvalidConfig(
            "Workday limit must be greater than zero".to_owned(),
        ));
    }
    let endpoint = endpoint(&request.url, &config)?;
    let offset = cursor
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| CrawlerError::InvalidConfig("invalid Workday cursor".to_owned()))
        })
        .transpose()?
        .unwrap_or(0);
    let mut body = json!({"limit": config.limit, "offset": offset});
    if let Some(search_text) = config
        .search_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["searchText"] = Value::String(search_text.to_owned());
    }
    let response = http.post_json(&endpoint, &body).await?;
    let mut page = parse_workday(&response.text(), &endpoint)?;
    page.content_hash = Some(crate::dedup::content_hash(&response.body));
    page.etag = response.etag.clone();
    page.final_url = Some(response.final_url.clone());
    if page.jobs.len() >= config.limit {
        page.next_cursor = Some((offset + config.limit).to_string());
    }
    Ok(page)
}

pub fn parse_workday(body: &str, base_url: &str) -> Result<AdapterPage> {
    let root: Value =
        serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let postings = root
        .get("jobPostings")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CrawlerError::Parse("Workday response has no jobPostings array".to_owned())
        })?;
    let base = Url::parse(base_url).map_err(|error| CrawlerError::InvalidUrl {
        url: base_url.to_owned(),
        reason: error.to_string(),
    })?;
    let mut records = Vec::new();
    for posting in postings {
        let title = required_text(posting, "title")?;
        let path = posting
            .get("externalPath")
            .or_else(|| posting.get("externalUrl"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let info = posting.get("jobPostingInfo").unwrap_or(&Value::Null);
        let raw_url = if path.is_empty() {
            info.get("externalUrl")
                .and_then(Value::as_str)
                .unwrap_or_default()
        } else {
            path
        };
        let url = absolute(&base, raw_url)?;
        let description = info
            .get("jobDescription")
            .or_else(|| info.get("jobPostingDescription"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let external_id = posting
            .get("jobPostingId")
            .or_else(|| posting.get("id"))
            .map(|value| match value {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                _ => String::new(),
            })
            .filter(|value| !value.is_empty())
            .or_else(|| Some(path.trim_matches('/').replace('/', ":")));
        let apply_raw = info.get("applyUrl").and_then(Value::as_str);
        records.push(JobRecord {
            title,
            url: url.clone(),
            apply_url: apply_raw.map(|value| absolute(&base, value)).transpose()?,
            external_id,
            company: None,
            location: posting
                .get("locationsText")
                .or_else(|| posting.get("location"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            description: strip_html(description),
            posted_at: posting
                .get("postedOn")
                .or_else(|| posting.get("postedDate"))
                .and_then(Value::as_str)
                .and_then(parse_datetime),
            emails: extract_emails(description),
            source_kind: JobSourceKind::Workday,
        });
    }
    Ok(page_with_jobs(records))
}

fn endpoint(request_url: &str, config: &WorkdayConfig) -> Result<String> {
    if request_url.contains("/wday/cxs/") {
        return Ok(request_url.to_owned());
    }
    let tenant = nonempty(config.tenant.as_deref(), "tenant")?;
    let site = nonempty(config.site.as_deref(), "site")?;
    let base = Url::parse(request_url).map_err(|error| CrawlerError::InvalidUrl {
        url: request_url.to_owned(),
        reason: error.to_string(),
    })?;
    Ok(format!(
        "{}://{}/wday/cxs/{}/{}/jobs",
        base.scheme(),
        base.host_str().unwrap_or_default(),
        tenant,
        site
    ))
}

fn nonempty<'a>(value: Option<&'a str>, field: &str) -> Result<&'a str> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CrawlerError::InvalidConfig(format!("Workday {field} is required")))
}

fn absolute(base: &Url, value: &str) -> Result<String> {
    base.join(value)
        .map(|url| url.to_string())
        .map_err(|error| CrawlerError::InvalidUrl {
            url: value.to_owned(),
            reason: error.to_string(),
        })
}

fn required_text(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| CrawlerError::Parse(format!("Workday posting is missing {key}")))
}

fn default_limit() -> usize {
    100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_workday_fixture_and_resolves_relative_path() {
        let page = parse_workday(
            include_str!("../../tests/fixtures/workday.json"),
            "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/careers/jobs",
        )
        .unwrap();
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].external_id.as_deref(), Some("WD-700"));
        assert_eq!(
            page.jobs[0].url,
            "https://acme.wd5.myworkdayjobs.com/acme/job/AI-Engineer/700"
        );
    }

    #[test]
    fn builds_workday_cxs_endpoint_without_double_slash() {
        let config = WorkdayConfig {
            tenant: Some("acme".to_owned()),
            site: Some("careers".to_owned()),
            limit: 100,
            search_text: None,
        };
        assert_eq!(
            endpoint("https://acme.wd5.myworkdayjobs.com", &config).unwrap(),
            "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/careers/jobs"
        );
    }
}
