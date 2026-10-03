use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug)]
pub struct DomainRateLimiter {
    interval: Duration,
    reservations: Mutex<HashMap<String, Instant>>,
}

impl DomainRateLimiter {
    pub fn new(requests_per_second: f64) -> Self {
        let interval = Duration::from_secs_f64(1.0 / requests_per_second.max(f64::MIN_POSITIVE));
        Self {
            interval,
            reservations: Mutex::new(HashMap::new()),
        }
    }

    pub fn reserve(&self, url: &Url) -> Duration {
        let domain = domain_key(url);
        let mut reservations = self
            .reservations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        let next_available = reservations
            .get(&domain)
            .copied()
            .filter(|slot| *slot > now)
            .unwrap_or(now);
        reservations.insert(domain, next_available + self.interval);
        next_available.saturating_duration_since(now)
    }

    pub async fn wait_for(&self, url: &Url) {
        let delay = self.reserve(url);
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

fn domain_key(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reservations_space_requests_per_domain_without_blocking_other_domains() {
        let limiter = DomainRateLimiter::new(20.0);
        let first_url = Url::parse("https://one.example/jobs").unwrap();
        let second_url = Url::parse("https://two.example/jobs").unwrap();

        assert!(limiter.reserve(&first_url).is_zero());
        let delayed = limiter.reserve(&first_url);
        assert!(delayed >= Duration::from_millis(45));
        assert!(limiter.reserve(&second_url).is_zero());
    }
}
