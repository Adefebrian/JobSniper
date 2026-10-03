use super::text::{normalize_whitespace, parse_datetime, strip_html};
use crate::dedup::identifier_from_url;
use crate::model::{JobRecord, JobSourceKind};
use serde_json::{Map, Value};

pub fn extract_json_ld_jobs(json: &Value) -> Vec<JobRecord> {
    let mut records = Vec::new();
    collect_job_postings(json, &mut records);
    records
}

fn collect_job_postings(value: &Value, records: &mut Vec<JobRecord>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_job_postings(item, records);
            }
        }
        Value::Object(object) => {
            if is_job_posting(object) {
                if let Some(record) = record_from_object(object) {
                    records.push(record);
                }
                return;
            }
            if let Some(graph) = object.get("@graph") {
                collect_job_postings(graph, records);
            }
        }
        _ => {}
    }
}

fn is_job_posting(object: &Map<String, Value>) -> bool {
    match object.get("@type") {
        Some(Value::String(kind)) => kind.eq_ignore_ascii_case("JobPosting"),
        Some(Value::Array(kinds)) => kinds.iter().any(|kind| {
            kind.as_str()
                .map(|kind| kind.eq_ignore_ascii_case("JobPosting"))
                .unwrap_or(false)
        }),
        _ => false,
    }
}

fn record_from_object(object: &Map<String, Value>) -> Option<JobRecord> {
    let title = first_string(object, &["title", "name"])?;
    let url = first_string(object, &["url", "mainEntityOfPage", "@id"])
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))?;
    let description = object
        .get("description")
        .and_then(value_to_text)
        .map(|value| strip_html(&value))
        .unwrap_or_default();
    let external_id =
        identifier_value(object.get("identifier")).or_else(|| identifier_from_url(&url));
    let company = object
        .get("hiringOrganization")
        .and_then(|organization| first_string_value(organization, &["name", "legalName"]));
    let location = location_value(object.get("jobLocation"));
    let posted_at = object
        .get("datePosted")
        .and_then(value_to_text)
        .and_then(|value| parse_datetime(&value));
    let emails = super::text::extract_emails(&format!("{url} {description}"));

    Some(JobRecord {
        title: normalize_whitespace(&title),
        url,
        apply_url: None,
        external_id,
        company,
        location,
        description,
        posted_at,
        emails,
        source_kind: JobSourceKind::JsonLd,
    })
}

fn identifier_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.trim().to_owned()).filter(|value| !value.is_empty()),
        Value::Object(object) => first_string(object, &["value", "name", "identifier"]),
        Value::Array(values) => values
            .iter()
            .find_map(|value| identifier_value(Some(value))),
        _ => None,
    }
}

fn location_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(normalize_whitespace(value)),
        Value::Object(object) => {
            if let Some(address) = object.get("address") {
                if let Some(address) = location_value(Some(address)) {
                    return Some(address);
                }
            }
            first_string(object, &["name", "addressLocality", "addressRegion"])
        }
        Value::Array(values) => values.iter().find_map(|value| location_value(Some(value))),
        _ => None,
    }
}

fn first_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key))
        .and_then(value_to_text)
        .map(|value| normalize_whitespace(&value))
        .filter(|value| !value.is_empty())
}

fn first_string_value(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => first_string(object, keys),
        Value::Array(values) => values
            .iter()
            .find_map(|value| first_string_value(value, keys)),
        Value::String(value) => Some(normalize_whitespace(value)),
        _ => None,
    }
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Object(object) => first_string(object, &["value", "name", "text"]),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_job_posting_from_graph_with_exact_description() {
        let value = json!({
          "@context": "https://schema.org",
          "@graph": [{
            "@type": "JobPosting",
            "title": "AI Fullstack Engineer",
            "url": "https://example.com/jobs/42",
            "identifier": {"value": "AI-42"},
            "description": "<p>Build <strong>LLM agents</strong>.</p>",
            "hiringOrganization": {"name": "Example"},
            "jobLocation": {"address": {"addressLocality": "Singapore"}},
            "datePosted": "2026-10-01"
          }]
        });
        let jobs = extract_json_ld_jobs(&value);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].external_id.as_deref(), Some("AI-42"));
        assert_eq!(jobs[0].description, "Build LLM agents.");
        assert_eq!(jobs[0].location.as_deref(), Some("Singapore"));
    }
}
