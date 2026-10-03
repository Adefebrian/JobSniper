use thiserror::Error;

pub type Result<T> = std::result::Result<T, CrawlerError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorClass {
    Retryable,
    Blocked,
    Permanent,
}

#[derive(Debug, Error)]
pub enum CrawlerError {
    #[error("network request failed: {0}")]
    Network(String),

    #[error("HTTP request failed with status {status}: {message}")]
    Http { status: u16, message: String },

    #[error("access is blocked for {url}: {reason}")]
    Blocked { url: String, reason: String },

    #[error("robots.txt denied {url}")]
    RobotsDenied { url: String },

    #[error("response body exceeded the {limit} byte limit")]
    BodyTooLarge { limit: usize },

    #[error("invalid URL {url}: {reason}")]
    InvalidUrl { url: String, reason: String },

    #[error("adapter configuration is invalid: {0}")]
    InvalidConfig(String),

    #[error("response parsing failed: {0}")]
    Parse(String),

    #[error("database operation failed: {0}")]
    Database(String),

    #[error("task payload is invalid: {0}")]
    InvalidPayload(String),

    #[error("renderer failed: {0}")]
    Render(String),
}

impl CrawlerError {
    pub fn class(&self) -> ErrorClass {
        match self {
            Self::Network(_)
            | Self::Http {
                status: 500..=599, ..
            }
            | Self::BodyTooLarge { .. }
            | Self::Render(_)
            | Self::Database(_) => ErrorClass::Retryable,
            Self::Blocked { .. } | Self::RobotsDenied { .. } => ErrorClass::Blocked,
            Self::Http {
                status: 408 | 425 | 429,
                ..
            } => ErrorClass::Retryable,
            Self::Http { .. }
            | Self::InvalidUrl { .. }
            | Self::InvalidConfig(_)
            | Self::Parse(_)
            | Self::InvalidPayload(_) => ErrorClass::Permanent,
        }
    }
}
