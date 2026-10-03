use crate::error::{CrawlerError, Result};
use std::env;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct CrawlerConfig {
    pub database_url: String,
    pub user_agent: String,
    pub request_timeout: Duration,
    pub max_body_bytes: usize,
    pub max_redirects: usize,
    pub requests_per_second_per_domain: f64,
    pub max_parallel_renderers: usize,
    pub lightpanda_path: String,
    pub lease_seconds: i64,
    pub shutdown_grace: Duration,
}

impl CrawlerConfig {
    pub fn from_env() -> Result<Self> {
        let database_url = required_env("DATABASE_URL")?;
        let user_agent = env::var("JOB_SNIPER_USER_AGENT").unwrap_or_else(|_| {
            "JobSniper/1.0 (personal public-job crawler; respects robots.txt)".to_owned()
        });
        let request_timeout = Duration::from_secs(parse_number("HTTP_TIMEOUT_SECS", 20)?);
        let max_body_bytes = parse_number("HTTP_MAX_BODY_BYTES", 32 * 1024 * 1024)?;
        let max_redirects = parse_number("HTTP_MAX_REDIRECTS", 5)?;
        let requests_per_second_per_domain = parse_float("REQUESTS_PER_SECOND_PER_DOMAIN", 1.0)?;
        if requests_per_second_per_domain <= 0.0 {
            return Err(CrawlerError::InvalidConfig(
                "REQUESTS_PER_SECOND_PER_DOMAIN must be greater than zero".to_owned(),
            ));
        }
        let max_parallel_renderers = parse_number("MAX_PARALLEL_RENDERERS", 2)?;
        if max_parallel_renderers == 0 {
            return Err(CrawlerError::InvalidConfig(
                "MAX_PARALLEL_RENDERERS must be greater than zero".to_owned(),
            ));
        }
        let lightpanda_path = env::var("LIGHTPANDA_PATH")
            .unwrap_or_else(|_| "/opt/homebrew/bin/lightpanda".to_owned());
        let lease_seconds = parse_number("CRAWL_TASK_LEASE_SECONDS", 300)?;
        let shutdown_grace = Duration::from_secs(parse_number("SHUTDOWN_GRACE_SECS", 30)?);

        Ok(Self {
            database_url,
            user_agent,
            request_timeout,
            max_body_bytes,
            max_redirects,
            requests_per_second_per_domain,
            max_parallel_renderers,
            lightpanda_path,
            lease_seconds,
            shutdown_grace,
        })
    }
}

fn required_env(key: &str) -> Result<String> {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CrawlerError::InvalidConfig(format!("{key} is required")))
}

fn parse_number<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
{
    match env::var(key) {
        Ok(value) => value
            .trim()
            .parse()
            .map_err(|_| CrawlerError::InvalidConfig(format!("{key} must be a valid number"))),
        Err(_) => Ok(default),
    }
}

fn parse_float(key: &str, default: f64) -> Result<f64> {
    match env::var(key) {
        Ok(value) => value
            .trim()
            .parse()
            .map_err(|_| CrawlerError::InvalidConfig(format!("{key} must be a valid number"))),
        Err(_) => Ok(default),
    }
}
