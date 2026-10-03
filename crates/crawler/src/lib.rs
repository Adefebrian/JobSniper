pub mod adapters;
pub mod config;
pub mod dedup;
pub mod error;
pub mod extract;
pub mod http;
pub mod model;
pub mod persistence;
pub mod queue;
pub mod render;
pub mod sources;
pub mod worker;

pub use adapters::{
    parse_csv, parse_html_selector, parse_json_api, parse_rss, parse_sitemap, AdapterKind,
    AdapterRegistry, FetchRequest,
};
pub use error::{CrawlerError, ErrorClass, Result};
pub use extract::extract_html;
pub use model::{
    AdapterPage, CrawlArtifact, DiscoveredLink, DiscoveredLinkKind, ExtractedPage, JobRecord,
    JobSourceKind, TaskKind,
};
pub use queue::{CrawlTask, MemoryTaskQueue, PostgresTaskQueue, TaskQueue, TaskResult};
pub use worker::{ArtifactSink, CrawlerWorker, NoopArtifactSink, ProcessingOutcome};
