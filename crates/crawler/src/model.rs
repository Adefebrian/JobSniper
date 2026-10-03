use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Discover,
    Crawl,
    ClosedCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobRecord {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub apply_url: Option<String>,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub posted_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub emails: Vec<String>,
    #[serde(default)]
    pub source_kind: JobSourceKind,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobSourceKind {
    #[default]
    JsonLd,
    JsonApi,
    Rss,
    Html,
    Csv,
    Greenhouse,
    Lever,
    Ashby,
    Workday,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredLink {
    pub url: String,
    pub kind: DiscoveredLinkKind,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveredLinkKind {
    Job,
    Apply,
    Career,
    Ats,
    Sitemap,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractedPage {
    #[serde(default)]
    pub jobs: Vec<JobRecord>,
    #[serde(default)]
    pub emails: Vec<String>,
    #[serde(default)]
    pub links: Vec<DiscoveredLink>,
    #[serde(default)]
    pub ats_indicators: BTreeSet<String>,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrawlArtifact {
    pub source_id: Option<String>,
    pub career_source_id: Option<String>,
    pub company_id: Option<String>,
    pub requested_url: String,
    pub final_url: String,
    pub content_hash: String,
    pub etag: Option<String>,
    pub jobs: Vec<JobRecord>,
    pub emails: Vec<String>,
    pub links: Vec<DiscoveredLink>,
    pub ats_indicators: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterPage {
    #[serde(default)]
    pub jobs: Vec<JobRecord>,
    #[serde(default)]
    pub discovered_urls: Vec<String>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub final_url: Option<String>,
    pub fetched_at: DateTime<Utc>,
}

impl Default for AdapterPage {
    fn default() -> Self {
        Self {
            jobs: Vec::new(),
            discovered_urls: Vec::new(),
            next_cursor: None,
            content_hash: None,
            etag: None,
            final_url: None,
            fetched_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceConfig {
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub render: bool,
    #[serde(flatten)]
    pub options: Value,
}
