mod generic;

pub use generic::{
    parse_csv, parse_html_selector, parse_json_api, parse_rss, parse_sitemap, CsvConfig,
    HtmlSelectorConfig, JsonApiConfig,
};

use crate::error::{CrawlerError, Result};
use crate::extract::extract_html;
use crate::http::HttpClient;
use crate::model::AdapterPage;
use crate::sources;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    JsonApi,
    Rss,
    Sitemap,
    JsonLd,
    HtmlSelector,
    CsvDownload,
    Headless,
    Greenhouse,
    Lever,
    Ashby,
    Workday,
    HnWhoIsHiring,
}

#[derive(Debug, Clone)]
pub struct FetchRequest {
    pub url: String,
    pub source_id: Option<String>,
    pub company_id: Option<String>,
    pub config: Value,
}

pub struct AdapterRegistry;

impl AdapterRegistry {
    pub fn kind_for(request: &FetchRequest, method: Option<&str>) -> Result<AdapterKind> {
        if let Some(adapter) = request
            .config
            .get("adapter")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase)
        {
            return match adapter.as_str() {
                "greenhouse" => Ok(AdapterKind::Greenhouse),
                "lever" => Ok(AdapterKind::Lever),
                "ashby" => Ok(AdapterKind::Ashby),
                "workday_cxs" | "workday" => Ok(AdapterKind::Workday),
                "hn_whoishiring" => Ok(AdapterKind::HnWhoIsHiring),
                "json_api" => Ok(AdapterKind::JsonApi),
                "rss" => Ok(AdapterKind::Rss),
                "sitemap" => Ok(AdapterKind::Sitemap),
                "json_ld" => Ok(AdapterKind::JsonLd),
                "html_selector" => Ok(AdapterKind::HtmlSelector),
                "csv_download" => Ok(AdapterKind::CsvDownload),
                unknown => Err(CrawlerError::InvalidConfig(format!(
                    "unknown adapter hint: {unknown}"
                ))),
            };
        }
        match method.map(str::to_ascii_lowercase).as_deref() {
            Some("json_api") => Ok(AdapterKind::JsonApi),
            Some("rss") => Ok(AdapterKind::Rss),
            Some("sitemap") => Ok(AdapterKind::Sitemap),
            Some("json_ld") => Ok(AdapterKind::JsonLd),
            Some("html_selector") => Ok(AdapterKind::HtmlSelector),
            Some("csv_download") => Ok(AdapterKind::CsvDownload),
            Some("headless") => Ok(AdapterKind::Headless),
            Some("custom_adapter") => infer_from_url(&request.url),
            None => infer_from_url(&request.url),
            Some(unknown) => Err(CrawlerError::InvalidConfig(format!(
                "unknown source method: {unknown}"
            ))),
        }
    }

    pub async fn fetch_page(
        &self,
        http: &HttpClient,
        request: &FetchRequest,
        method: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<AdapterPage> {
        match Self::kind_for(request, method)? {
            AdapterKind::JsonApi => {
                let response = http.get(&request.url).await?;
                Ok(response_metadata(
                    parse_json_api(&response.text(), &request.config)?,
                    &response,
                ))
            }
            AdapterKind::Rss => {
                let response = http.get(&request.url).await?;
                Ok(response_metadata(parse_rss(&response.text())?, &response))
            }
            AdapterKind::Sitemap => {
                let response = http.get(&request.url).await?;
                Ok(response_metadata(
                    parse_sitemap(&response.text())?,
                    &response,
                ))
            }
            AdapterKind::JsonLd | AdapterKind::Headless => {
                let response = http.get(&request.url).await?;
                let page = extract_html(&response.text(), &response.final_url)?;
                Ok(response_metadata(
                    AdapterPage {
                        jobs: page.jobs,
                        discovered_urls: page.links.into_iter().map(|link| link.url).collect(),
                        next_cursor: None,
                        fetched_at: chrono::Utc::now(),
                        content_hash: None,
                        etag: None,
                        final_url: None,
                    },
                    &response,
                ))
            }
            AdapterKind::HtmlSelector => {
                let response = http.get(&request.url).await?;
                Ok(response_metadata(
                    parse_html_selector(&response.text(), &response.final_url, &request.config)?,
                    &response,
                ))
            }
            AdapterKind::CsvDownload => {
                let response = http.get(&request.url).await?;
                Ok(response_metadata(
                    parse_csv(&response.text(), &request.config)?,
                    &response,
                ))
            }
            AdapterKind::Greenhouse => sources::greenhouse::fetch_page(http, request).await,
            AdapterKind::Lever => sources::lever::fetch_page(http, request).await,
            AdapterKind::Ashby => sources::ashby::fetch_page(http, request).await,
            AdapterKind::Workday => sources::workday::fetch_page(http, request, cursor).await,
            AdapterKind::HnWhoIsHiring => sources::hn::fetch_page(http, request).await,
        }
    }
}

fn infer_from_url(url: &str) -> Result<AdapterKind> {
    let lowered = url.to_ascii_lowercase();
    if lowered.contains("boards-api.greenhouse.io") || lowered.contains("greenhouse.io") {
        Ok(AdapterKind::Greenhouse)
    } else if lowered.contains("api.lever.co") || lowered.contains("lever.co") {
        Ok(AdapterKind::Lever)
    } else if lowered.contains("api.ashbyhq.com") || lowered.contains("ashbyhq.com") {
        Ok(AdapterKind::Ashby)
    } else if lowered.contains("myworkdayjobs.com") || lowered.contains("/wday/cxs/") {
        Ok(AdapterKind::Workday)
    } else if lowered.ends_with(".xml") && lowered.contains("sitemap") {
        Ok(AdapterKind::Sitemap)
    } else if lowered.ends_with(".csv") {
        Ok(AdapterKind::CsvDownload)
    } else {
        Ok(AdapterKind::JsonLd)
    }
}

pub(crate) fn page_with_jobs(mut jobs: Vec<crate::model::JobRecord>) -> AdapterPage {
    jobs.iter_mut().for_each(|job| {
        if job.emails.is_empty() {
            job.emails = crate::extract::extract_emails(&job.description);
        }
    });
    AdapterPage {
        jobs,
        discovered_urls: Vec::new(),
        next_cursor: None,
        content_hash: None,
        etag: None,
        final_url: None,
        fetched_at: chrono::Utc::now(),
    }
}

fn response_metadata(mut page: AdapterPage, response: &crate::http::FetchResponse) -> AdapterPage {
    page.content_hash = Some(crate::dedup::content_hash(&response.body));
    page.etag.clone_from(&response.etag);
    page.final_url = Some(response.final_url.clone());
    page
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn infers_custom_adapters_from_public_urls() {
        assert_eq!(
            AdapterRegistry::kind_for(
                &FetchRequest {
                    url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs".to_owned(),
                    source_id: None,
                    company_id: None,
                    config: json!({}),
                },
                None
            )
            .unwrap(),
            AdapterKind::Greenhouse
        );
        assert_eq!(
            AdapterRegistry::kind_for(
                &FetchRequest {
                    url: "https://example.com/sitemap.xml".to_owned(),
                    source_id: None,
                    company_id: None,
                    config: json!({}),
                },
                Some("sitemap")
            )
            .unwrap(),
            AdapterKind::Sitemap
        );
    }
}
