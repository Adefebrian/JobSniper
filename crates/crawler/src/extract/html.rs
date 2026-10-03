use super::json_ld::extract_json_ld_jobs;
use super::text::{decode_mailto, extract_emails, normalize_whitespace};
use crate::dedup::content_hash;
use crate::error::{CrawlerError, Result};
use crate::model::{DiscoveredLink, DiscoveredLinkKind, ExtractedPage};
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use url::Url;

pub fn extract_html(body: &str, base_url: &str) -> Result<ExtractedPage> {
    let base = parse_url(base_url)?;
    let document = Html::parse_document(body);
    let mut jobs = Vec::new();
    let script_selector = one_selector("script[type=\"application/ld+json\"]")?;
    for script in document.select(&script_selector) {
        let json = script.inner_html();
        let trimmed = json.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            jobs.extend(extract_json_ld_jobs(&value));
        }
    }

    let links = extract_links(&document, &base)?;
    let mut emails = extract_emails(body);
    let mailto_selector = one_selector("a[href^=\"mailto:\"]")?;
    for anchor in document.select(&mailto_selector) {
        if let Some(href) = anchor.value().attr("href") {
            let decoded = decode_mailto(href);
            if !decoded.is_empty() {
                emails.push(decoded);
            }
        }
    }
    emails.sort();
    emails.dedup();

    for job in &mut jobs {
        if job.emails.is_empty() {
            job.emails.clone_from(&emails);
        }
    }

    Ok(ExtractedPage {
        jobs,
        emails,
        links,
        ats_indicators: ats_indicators(body, &document),
        content_hash: content_hash(body.as_bytes()),
    })
}

pub fn extract_links(document: &Html, base: &Url) -> Result<Vec<DiscoveredLink>> {
    let selector = one_selector("a[href]")?;
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for anchor in document.select(&selector) {
        let Some(href) = anchor.value().attr("href") else {
            continue;
        };
        let href = href.trim();
        if href.is_empty() || href.starts_with('#') {
            continue;
        }
        let Ok(url) = base.join(href) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let normalized = url.as_str().to_owned();
        if !seen.insert(normalized.clone()) {
            continue;
        }
        let label = normalize_whitespace(&anchor.text().collect::<Vec<_>>().join(" "));
        let kind = classify_link(&normalized, &label);
        links.push(DiscoveredLink {
            url: normalized,
            kind,
            label: (!label.is_empty()).then_some(label),
        });
    }
    Ok(links)
}

fn classify_link(url: &str, label: &str) -> DiscoveredLinkKind {
    let lowered_url = url.to_ascii_lowercase();
    let lowered_label = label.to_ascii_lowercase();
    if lowered_label.contains("apply now")
        || lowered_label.contains("apply for")
        || lowered_label == "apply"
        || lowered_url.contains("application")
        || lowered_url.contains("/apply")
    {
        DiscoveredLinkKind::Apply
    } else if lowered_label.contains("job")
        || lowered_label.contains("position")
        || lowered_label.contains("opening")
        || lowered_url.contains("/job")
        || lowered_url.contains("/career")
        || lowered_url.contains("gh_jid=")
    {
        DiscoveredLinkKind::Job
    } else if lowered_url.contains("greenhouse.io")
        || lowered_url.contains("lever.co")
        || lowered_url.contains("ashbyhq.com")
        || lowered_url.contains("myworkdayjobs.com")
    {
        DiscoveredLinkKind::Ats
    } else {
        DiscoveredLinkKind::Career
    }
}

fn ats_indicators(body: &str, document: &Html) -> BTreeSet<String> {
    const MARKERS: [&str; 8] = [
        "greenhouse.io",
        "lever.co",
        "ashbyhq.com",
        "myworkdayjobs.com",
        "workable.com",
        "teamtailor.com",
        "recruitee.com",
        "smartrecruiters.com",
    ];
    let mut lowered = body.to_ascii_lowercase();
    let attribute_selector =
        one_selector("[src], [href], [data-ats]").expect("attribute selectors are valid");
    for element in document.select(&attribute_selector) {
        for attribute in ["src", "href", "data-ats"] {
            if let Some(value) = element.value().attr(attribute) {
                lowered.push(' ');
                lowered.push_str(&value.to_ascii_lowercase());
            }
        }
    }
    MARKERS
        .into_iter()
        .filter(|marker| lowered.contains(marker))
        .map(str::to_owned)
        .collect()
}

fn one_selector(value: &str) -> Result<Selector> {
    Selector::parse(value).map_err(|error| CrawlerError::Parse(error.to_string()))
}

fn parse_url(value: &str) -> Result<Url> {
    Url::parse(value).map_err(|error| CrawlerError::InvalidUrl {
        url: value.to_owned(),
        reason: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_ld_observed_email_apply_and_ats_links() {
        let body = r#"
          <script type="application/ld+json">
            {"@type":"JobPosting","title":"LLM Engineer","url":"https://example.com/jobs/7","description":"Build agents"}
          </script>
          <a href="mailto:jobs@example.com">Hiring</a>
          <a href="/apply/7">Apply now</a>
          <script src="https://boards.greenhouse.io/embed/job_board/js"></script>
        "#;
        let page = extract_html(body, "https://example.com/careers").unwrap();
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.emails, vec!["jobs@example.com".to_owned()]);
        assert!(page
            .links
            .iter()
            .any(|link| link.kind == DiscoveredLinkKind::Apply));
        assert!(page.ats_indicators.contains("greenhouse.io"));
    }
}
