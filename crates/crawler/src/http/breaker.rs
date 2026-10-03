use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    Retryable,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureDecision {
    pub attempts: usize,
    pub blocked_until: Option<Instant>,
    pub retry_after: Duration,
}

#[derive(Debug)]
pub struct FailureTracker {
    base_delay: Duration,
    maximum_delay: Duration,
    blocked_delay: Duration,
    states: Mutex<HashMap<String, DomainState>>,
}

#[derive(Debug, Clone, Copy)]
struct DomainState {
    attempts: usize,
    blocked_until: Option<Instant>,
}

impl FailureTracker {
    pub fn new() -> Self {
        Self {
            base_delay: Duration::from_secs(30),
            maximum_delay: Duration::from_secs(24 * 60 * 60),
            blocked_delay: Duration::from_secs(15 * 60),
            states: Mutex::new(HashMap::new()),
        }
    }

    pub fn record_success(&self, url: &Url) {
        let mut states = self.lock();
        states.remove(&domain(url));
    }

    pub fn record_failure(&self, url: &Url, kind: FailureKind) -> FailureDecision {
        let mut states = self.lock();
        let state = states.entry(domain(url)).or_insert(DomainState {
            attempts: 0,
            blocked_until: None,
        });
        state.attempts = state.attempts.saturating_add(1);
        let exponent = state.attempts.saturating_sub(1).min(20);
        let retry_after = self
            .base_delay
            .saturating_mul(2u32.saturating_pow(exponent as u32))
            .min(self.maximum_delay);
        let blocked_until = (kind == FailureKind::Blocked)
            .then(|| Instant::now() + self.blocked_delay.max(retry_after));
        state.blocked_until = blocked_until;
        FailureDecision {
            attempts: state.attempts,
            blocked_until,
            retry_after: blocked_until
                .map(|until| until.saturating_duration_since(Instant::now()))
                .unwrap_or(retry_after),
        }
    }

    pub fn is_blocked(&self, url: &Url) -> Option<Instant> {
        let states = self.lock();
        states
            .get(&domain(url))
            .and_then(|state| state.blocked_until)
            .filter(|until| *until > Instant::now())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, DomainState>> {
        self.states
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for FailureTracker {
    fn default() -> Self {
        Self::new()
    }
}

fn domain(url: &Url) -> String {
    url.host_str().unwrap_or_default().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_backoff_is_exponential_and_blocked_state_is_visible() {
        let tracker = FailureTracker::new();
        let url = Url::parse("https://example.com/jobs").unwrap();
        let first = tracker.record_failure(&url, FailureKind::Retryable);
        let second = tracker.record_failure(&url, FailureKind::Retryable);
        assert_eq!(first.attempts, 1);
        assert_eq!(second.attempts, 2);
        assert!(second.retry_after >= first.retry_after * 2);

        let blocked = tracker.record_failure(&url, FailureKind::Blocked);
        assert!(blocked.blocked_until.is_some());
        assert!(tracker.is_blocked(&url).is_some());
    }
}
