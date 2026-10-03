//! Hacker News "Ask HN: Who is hiring?" threads: hundreds of posts a month, most from startups and
//! many written as "Company | Role | Location | ... email us at jobs@...". The richest public source
//! of jobs that take applications by email. Reads the two newest threads via the Algolia HN API.
use crate::adapters::{page_with_jobs, FetchRequest};
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, parse_datetime, strip_html};
use crate::http::HttpClient;
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

const THREADS: &str =
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6";

pub async fn fetch_page(http: &HttpClient, _request: &FetchRequest) -> Result<AdapterPage> {
    let listing: Value = serde_json::from_str(&http.get(THREADS).await?.text())
        .map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let ids: Vec<String> = listing
        .get("hits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|hit| {
            hit.get("title")
                .and_then(Value::as_str)
                .is_some_and(|t| t.to_ascii_lowercase().contains("who is hiring"))
        })
        .filter_map(|hit| hit.get("objectID").and_then(Value::as_str).map(str::to_owned))
        .take(2)
        .collect();
    if ids.is_empty() {
        return Err(CrawlerError::Parse("no Who is hiring thread found".to_owned()));
    }
    let mut jobs = Vec::new();
    for id in ids {
        let body = http
            .get(&format!("https://hn.algolia.com/api/v1/items/{id}"))
            .await?
            .text();
        jobs.extend(parse_thread(&body)?);
    }
    Ok(page_with_jobs(jobs))
}

/// HN posters hide addresses from scrapers: "jobs [at] acme [dot] com", "jobs (at) acme.com".
pub fn deobfuscate(text: &str) -> String {
    static AT: OnceLock<Regex> = OnceLock::new();
    static DOT: OnceLock<Regex> = OnceLock::new();
    let at = AT.get_or_init(|| {
        Regex::new(r"(?i)([A-Z0-9._%+-]+)\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|\s+at\s+)\s*([A-Z0-9-]+(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+|\.)\s*[A-Z0-9-]+)+)")
            .expect("at regex")
    });
    let dot = DOT.get_or_init(|| Regex::new(r"(?i)\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*").expect("dot regex"));
    at.replace_all(text, |caps: &regex::Captures| {
        let domain = dot.replace_all(&caps[2], ".");
        // only rewrite when the result looks like a real domain (has a TLD of letters)
        if domain.rsplit('.').next().is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic())) {
            format!("{}@{}", &caps[1], domain.replace(' ', ""))
        } else {
            caps[0].to_owned()
        }
    })
    .into_owned()
}

pub fn parse_thread(body: &str) -> Result<Vec<JobRecord>> {
    let root: Value = serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let mut jobs = Vec::new();
    for child in root.get("children").and_then(Value::as_array).into_iter().flatten() {
        let Some(html) = child.get("text").and_then(Value::as_str) else { continue };
        let id = child.get("id").map(|v| v.to_string()).unwrap_or_default();
        // keep paragraph breaks so the brain can read sentences
        let text: String = html
            .split("<p>")
            .map(|p| deobfuscate(&strip_html(p)))
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let first = text.lines().next().unwrap_or_default();
        let parts: Vec<&str> = first.split('|').map(str::trim).filter(|p| !p.is_empty()).collect();
        if parts.len() < 2 {
            continue; // not in the "Company | Role | ..." format: skip rather than guess
        }
        let company = parts[0].chars().take(80).collect::<String>();
        let title = parts[1].chars().take(160).collect::<String>();
        let location = parts.iter().skip(2).take(3).copied().collect::<Vec<_>>().join(" | ");
        jobs.push(JobRecord {
            title,
            url: format!("https://news.ycombinator.com/item?id={id}"),
            apply_url: None,
            external_id: Some(format!("hn-{id}")),
            company: Some(company),
            location: if location.is_empty() { None } else { Some(location) },
            emails: extract_emails(&text),
            description: text,
            posted_at: child.get("created_at").and_then(Value::as_str).and_then(parse_datetime),
            source_kind: JobSourceKind::JsonApi,
        });
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_who_is_hiring_comments() {
        let body = r#"{"children":[
          {"id":1,"created_at":"2026-10-01T15:00:00.000Z","text":"Acme AI | Senior LLM Engineer | Remote (Worldwide) | Full-time<p>We build agents. Send your CV to jobs [at] acme [dot] ai"},
          {"id":2,"text":"just a reply without the format"}
        ]}"#;
        let jobs = parse_thread(body).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].company.as_deref(), Some("Acme AI"));
        assert_eq!(jobs[0].title, "Senior LLM Engineer");
        assert_eq!(jobs[0].location.as_deref(), Some("Remote (Worldwide) | Full-time"));
        assert_eq!(jobs[0].emails, vec!["jobs@acme.ai".to_owned()]);
        assert!(jobs[0].description.contains("Send your CV to jobs@acme.ai"));
    }

    #[test]
    fn deobfuscation_leaves_normal_prose_alone() {
        assert_eq!(deobfuscate("meet us at the office"), "meet us at the office");
        assert_eq!(deobfuscate("hiring (at) foo.io"), "hiring@foo.io");
    }
}
