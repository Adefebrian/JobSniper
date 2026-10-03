use crate::model::JobRecord;
use sha2::{Digest, Sha256};

pub fn content_hash(bytes: &[u8]) -> String {
    hex_digest(&Sha256::digest(bytes))
}

pub fn source_identifier(record: &JobRecord) -> String {
    if let Some(external_id) = record
        .external_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return external_id.to_owned();
    }
    if let Some(identifier) = identifier_from_url(&record.url) {
        return identifier;
    }
    format!(
        "content:{}",
        content_key(&record.company, &record.title, &record.location)
    )
}

pub fn cross_source_key(company: &str, title: &str, location: &str) -> String {
    content_key(&Some(company.to_owned()), title, &Some(location.to_owned()))
}

pub fn identifier_from_url(raw_url: &str) -> Option<String> {
    let url = url::Url::parse(raw_url).ok()?;
    for (key, value) in url.query_pairs() {
        if matches!(
            key.as_ref(),
            "gh_jid"
                | "jobId"
                | "job_id"
                | "posting_id"
                | "requisitionId"
                | "requisition_id"
                | "external_id"
        ) {
            let normalized = value.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_owned());
            }
        }
    }

    let segments: Vec<_> = url
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for index in (0..segments.len().saturating_sub(1)).rev() {
        if matches!(
            segments[index].as_str(),
            "jobs" | "job" | "postings" | "posting" | "positions" | "position"
        ) {
            let candidate = segments[index + 1].trim_matches(|character: char| {
                character == '/' || character == '.' || character == ';'
            });
            if candidate.len() >= 3 {
                return Some(candidate.to_owned());
            }
        }
    }

    None
}

fn content_key(company: &Option<String>, title: &str, location: &Option<String>) -> String {
    let normalized = [
        company.as_deref().unwrap_or_default(),
        title,
        location.as_deref().unwrap_or_default(),
    ]
    .into_iter()
    .map(normalize_component)
    .collect::<Vec<_>>()
    .join("|");
    hex_digest(&Sha256::digest(normalized.as_bytes()))
}

fn normalize_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_identifier_wins_and_url_identifier_is_deterministic() {
        let mut record = JobRecord {
            title: "AI Engineer".to_owned(),
            url: "https://example.com/jobs/123".to_owned(),
            apply_url: None,
            external_id: Some("REQ-9".to_owned()),
            company: Some("Example".to_owned()),
            location: Some("Singapore".to_owned()),
            description: String::new(),
            posted_at: None,
            emails: Vec::new(),
            source_kind: Default::default(),
        };
        assert_eq!(source_identifier(&record), "REQ-9");
        record.external_id = None;
        assert_eq!(source_identifier(&record), "123");
    }

    #[test]
    fn cross_source_key_normalizes_case_spacing_and_punctuation() {
        assert_eq!(
            cross_source_key("Acme, Inc.", "AI  Engineer", "Singapore / Remote"),
            cross_source_key("acme inc", "ai engineer", "singapore remote")
        );
    }
}
