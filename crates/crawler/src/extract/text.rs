use chrono::{DateTime, Utc};
use regex::Regex;
use std::sync::OnceLock;

pub fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn strip_html(value: &str) -> String {
    static BLOCK_BREAK: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    let block_break = BLOCK_BREAK.get_or_init(|| {
        Regex::new(r"(?i)</?(?:br|p|div|section|article|li|h[1-6]|ul|ol|table|tr)\b[^>]*>")
            .expect("block HTML regex is valid")
    });
    let tag = TAG.get_or_init(|| Regex::new(r"(?s)<[^>]*>").expect("HTML tag regex is valid"));
    let with_breaks = block_break.replace_all(value, " ");
    let without_tags = tag.replace_all(&with_breaks, "");
    normalize_whitespace(&decode_html_entities(&without_tags))
}

pub fn extract_emails(value: &str) -> Vec<String> {
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    let pattern = EMAIL.get_or_init(|| {
        Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b")
            .expect("email regex is valid")
    });
    let mut emails: Vec<String> = pattern
        .find_iter(value)
        .map(|matched| {
            matched
                .as_str()
                .trim_end_matches(['.', ',', ';', ':'])
                .to_ascii_lowercase()
        })
        .collect();
    emails.sort();
    emails.dedup();
    emails
}

pub fn decode_mailto(value: &str) -> String {
    value
        .trim()
        .strip_prefix("mailto:")
        .unwrap_or(value.trim())
        .replace("%40", "@")
        .replace("%2e", ".")
        .replace("%2E", ".")
        .split('?')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    let normalized = value.trim();
    if let Ok(parsed) = DateTime::parse_from_rfc3339(normalized) {
        return Some(parsed.with_timezone(&Utc));
    }
    if let Ok(parsed) = DateTime::parse_from_rfc2822(normalized) {
        return Some(parsed.with_timezone(&Utc));
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(normalized, format) {
            return Some(parsed.and_utc());
        }
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(normalized, "%Y-%m-%d") {
        return date.and_hms_opt(0, 0, 0).map(|value| value.and_utc());
    }
    // Feeds such as Himalayas and Arbeitnow publish epoch seconds (or milliseconds).
    if let Ok(epoch) = normalized.parse::<i64>() {
        let seconds = if epoch > 100_000_000_000 { epoch / 1000 } else { epoch };
        return DateTime::from_timestamp(seconds, 0);
    }
    None
}

fn decode_html_entities(value: &str) -> String {
    static NUMERIC: OnceLock<Regex> = OnceLock::new();
    let numeric = NUMERIC.get_or_init(|| {
        Regex::new(r"&#x([0-9a-fA-F]+);|&#([0-9]+);").expect("numeric entity regex is valid")
    });
    let decoded = numeric
        .replace_all(value, |captures: &regex::Captures| {
            let parsed = captures
                .get(1)
                .and_then(|value| u32::from_str_radix(value.as_str(), 16).ok())
                .or_else(|| {
                    captures
                        .get(2)
                        .and_then(|value| value.as_str().parse::<u32>().ok())
                });
            parsed
                .and_then(char::from_u32)
                .map(String::from)
                .unwrap_or_default()
        })
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_html_and_extracts_only_observed_emails() {
        let html =
            "<p>Hello <strong>AI</strong> team.</p><a href=\"mailto:Jobs@Example.COM\">mail</a>";
        assert_eq!(strip_html(html), "Hello AI team. mail");
        assert_eq!(extract_emails(html), vec!["jobs@example.com".to_owned()]);
    }

    #[test]
    fn parses_common_posting_dates() {
        assert_eq!(
            parse_datetime("2026-10-02T12:30:00Z").map(|value| value.timestamp()),
            Some(1790944200)
        );
    }
}
