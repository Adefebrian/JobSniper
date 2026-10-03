use super::client::{FetchResponse, HttpClient};
use crate::error::{CrawlerError, Result};
use regex::Regex;
use std::collections::HashMap;
use std::sync::Mutex;
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct RobotsPolicy {
    groups: Vec<Group>,
    pub sitemaps: Vec<String>,
}

#[derive(Debug, Clone)]
struct Group {
    agents: Vec<String>,
    rules: Vec<Rule>,
}

#[derive(Debug, Clone)]
struct Rule {
    allow: bool,
    pattern: String,
    matcher: Regex,
}

#[derive(Debug)]
pub struct RobotsCache {
    user_agent: String,
    policies: Mutex<HashMap<String, RobotsPolicy>>,
}

impl RobotsPolicy {
    pub fn parse(body: &str) -> Self {
        let mut groups: Vec<Group> = Vec::new();
        let mut current_agents: Vec<String> = Vec::new();
        let mut current_rules: Vec<Rule> = Vec::new();
        let mut has_rules = false;
        let mut sitemaps = Vec::new();

        for raw_line in body.lines() {
            let line = raw_line.trim();
            let Some((raw_directive, raw_value)) = line.split_once(':') else {
                continue;
            };
            let directive = raw_directive.trim().to_ascii_lowercase();
            let value = raw_value.trim();
            match directive.as_str() {
                "user-agent" => {
                    let agent = value.to_ascii_lowercase();
                    if has_rules {
                        groups.push(Group {
                            agents: std::mem::take(&mut current_agents),
                            rules: std::mem::take(&mut current_rules),
                        });
                        has_rules = false;
                    }
                    current_agents.push(agent);
                }
                "allow" | "disallow" => {
                    if value.is_empty() {
                        continue;
                    }
                    if let Some(matcher) = wildcard_matcher(value) {
                        has_rules = true;
                        current_rules.push(Rule {
                            allow: directive == "allow",
                            pattern: value.to_owned(),
                            matcher,
                        });
                    }
                }
                "sitemap" if !value.is_empty() => sitemaps.push(value.to_owned()),
                _ => {}
            }
        }
        if !current_agents.is_empty() {
            groups.push(Group {
                agents: current_agents,
                rules: current_rules,
            });
        }
        Self { groups, sitemaps }
    }

    pub fn is_allowed(&self, user_agent: &str, url: &Url) -> bool {
        let target = match url.query() {
            Some(query) => format!("{}?{}", url.path(), query),
            None => url.path().to_owned(),
        };
        let lowered_agent = user_agent.to_ascii_lowercase();
        let mut selected: Vec<&Rule> = Vec::new();
        let mut best_specificity = 0usize;
        for group in &self.groups {
            let specificity = group
                .agents
                .iter()
                .map(|agent| {
                    if agent == "*" {
                        0
                    } else if lowered_agent.contains(agent.as_str()) {
                        agent.len()
                    } else {
                        usize::MAX
                    }
                })
                .min()
                .unwrap_or(usize::MAX);
            if specificity == usize::MAX {
                continue;
            }
            if specificity > best_specificity {
                best_specificity = specificity;
                selected.clear();
            }
            if specificity == best_specificity {
                selected.extend(&group.rules);
            }
        }

        let mut winning: Option<&Rule> = None;
        for rule in selected
            .into_iter()
            .filter(|rule| rule.matcher.is_match(&target))
        {
            let replace = winning
                .map(|current| {
                    rule.pattern.len() > current.pattern.len()
                        || (rule.pattern.len() == current.pattern.len() && rule.allow)
                })
                .unwrap_or(true);
            if replace {
                winning = Some(rule);
            }
        }
        winning.map(|rule| rule.allow).unwrap_or(true)
    }
}

impl RobotsCache {
    pub fn new(user_agent: impl Into<String>) -> Self {
        Self {
            user_agent: user_agent.into(),
            policies: Mutex::new(HashMap::new()),
        }
    }

    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    pub async fn is_allowed(&self, client: &HttpClient, url: &Url) -> Result<bool> {
        let origin = origin(url);
        let cached = self
            .policies
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&origin)
            .cloned();
        let policy = match cached {
            Some(policy) => policy,
            None => {
                let robots_url = robots_url(url)?;
                let response = client.fetch_for_robots(&robots_url).await?;
                let policy = match response.status {
                    200..=299 => RobotsPolicy::parse(&response.text()),
                    401 | 403 => {
                        return Err(CrawlerError::Blocked {
                            url: url.to_string(),
                            reason: "robots.txt is protected".to_owned(),
                        })
                    }
                    400..=499 => RobotsPolicy::default(),
                    status => {
                        return Err(CrawlerError::Http {
                            status,
                            message: "robots.txt was unavailable".to_owned(),
                        })
                    }
                };
                self.policies
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .insert(origin, policy.clone());
                policy
            }
        };
        Ok(policy.is_allowed(&self.user_agent, url))
    }

    pub fn sitemaps_for(&self, url: &Url) -> Vec<String> {
        self.policies
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&origin(url))
            .map(|policy| policy.sitemaps.clone())
            .unwrap_or_default()
    }
}

fn wildcard_matcher(pattern: &str) -> Option<Regex> {
    let end_anchor = pattern.ends_with('$');
    let pattern = if end_anchor {
        &pattern[..pattern.len() - 1]
    } else {
        pattern
    };
    let mut expression = String::from("^");
    for character in pattern.chars() {
        match character {
            '*' => expression.push_str(".*"),
            other => expression.push_str(&regex::escape(&other.to_string())),
        }
    }
    if end_anchor {
        expression.push('$');
    }
    Regex::new(&expression).ok()
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

fn robots_url(url: &Url) -> Result<Url> {
    url.join("/robots.txt")
        .map_err(|error| CrawlerError::InvalidUrl {
            url: url.to_string(),
            reason: error.to_string(),
        })
}

impl FetchResponse {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_rules_win_and_wildcards_are_supported() {
        let policy = RobotsPolicy::parse(
            "User-agent: JobSniper\nAllow: /public/\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml",
        );
        let allowed = Url::parse("https://example.com/public/jobs").unwrap();
        let denied = Url::parse("https://example.com/private/jobs").unwrap();
        assert!(policy.is_allowed("JobSniper/1.0", &allowed));
        assert!(!policy.is_allowed("JobSniper/1.0", &denied));
        assert_eq!(
            policy.sitemaps,
            vec!["https://example.com/sitemap.xml".to_owned()]
        );
    }

    #[test]
    fn default_policy_allows_when_no_group_matches_and_disallow_all_denies() {
        let empty = RobotsPolicy::parse("");
        let url = Url::parse("https://example.com/jobs").unwrap();
        assert!(empty.is_allowed("JobSniper", &url));

        let denied = RobotsPolicy::parse("User-agent: JobSniper\nDisallow: /");
        assert!(!denied.is_allowed("JobSniper", &url));
    }

    #[test]
    fn consecutive_user_agent_lines_share_the_following_rules() {
        let policy = RobotsPolicy::parse(
            "User-agent: JobSniper\nUser-agent: AnotherBot\nDisallow: /blocked/",
        );
        assert!(!policy.is_allowed(
            "JobSniper/1.0",
            &Url::parse("https://example.com/blocked/x").unwrap()
        ));
        assert!(!policy.is_allowed(
            "AnotherBot/2.0",
            &Url::parse("https://example.com/blocked/x").unwrap()
        ));
    }

    #[test]
    fn fixture_policy_matches_the_deterministic_robots_fixture() {
        let policy = RobotsPolicy::parse(include_str!("../../tests/fixtures/robots.txt"));
        assert!(policy.is_allowed(
            "JobSniper/1.0",
            &Url::parse("https://example.com/public/jobs").unwrap()
        ));
        assert!(!policy.is_allowed(
            "JobSniper/1.0",
            &Url::parse("https://example.com/private/jobs").unwrap()
        ));
    }

    #[test]
    fn wildcard_suffix_and_end_anchor_are_respected() {
        let policy =
            RobotsPolicy::parse("User-agent: *\nDisallow: /*/private$\nAllow: /public/*.html");
        assert!(!policy.is_allowed(
            "JobSniper",
            &Url::parse("https://example.com/team/private").unwrap()
        ));
        assert!(policy.is_allowed(
            "JobSniper",
            &Url::parse("https://example.com/team/private/child").unwrap()
        ));
        assert!(policy.is_allowed(
            "JobSniper",
            &Url::parse("https://example.com/public/a.html").unwrap()
        ));
    }
}
