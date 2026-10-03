use super::page_with_jobs;
use crate::error::{CrawlerError, Result};
use crate::extract::{extract_emails, normalize_whitespace, parse_datetime, strip_html};
use crate::model::{AdapterPage, JobRecord, JobSourceKind};
use quick_xml::events::Event;
use quick_xml::Reader;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use url::Url;

#[derive(Debug, Clone, Deserialize)]
pub struct JsonApiConfig {
    #[serde(default = "default_items_path")]
    pub items_path: String,
    #[serde(default = "default_json_fields")]
    pub fields: HashMap<String, String>,
    #[serde(default)]
    pub next_page_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HtmlSelectorConfig {
    pub item_selector: String,
    #[serde(default = "default_html_fields")]
    pub fields: HashMap<String, HtmlFieldSelector>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HtmlFieldSelector {
    pub selector: String,
    #[serde(default)]
    pub attribute: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CsvConfig {
    #[serde(default = "default_csv_fields")]
    pub fields: HashMap<String, String>,
    #[serde(default = "default_delimiter")]
    pub delimiter: char,
    #[serde(default = "default_true")]
    pub has_headers: bool,
}

pub fn parse_json_api(body: &str, config: &Value) -> Result<AdapterPage> {
    let config: JsonApiConfig = serde_json::from_value(config.clone())
        .map_err(|error| CrawlerError::InvalidConfig(error.to_string()))?;
    let root: Value =
        serde_json::from_str(body).map_err(|error| CrawlerError::Parse(error.to_string()))?;
    let items = json_value_at_path(&root, &config.items_path)
        .and_then(Value::as_array)
        .ok_or_else(|| CrawlerError::Parse("items_path did not resolve to an array".to_owned()))?;

    let mut jobs = Vec::new();
    for item in items {
        let title = mapped_required(item, &config.fields, "title", "title")?;
        let url = mapped_required(item, &config.fields, "url", "url")?;
        jobs.push(JobRecord {
            title,
            url,
            apply_url: mapped(item, &config.fields, "apply_url"),
            external_id: mapped(item, &config.fields, "external_id"),
            company: mapped(item, &config.fields, "company"),
            location: mapped(item, &config.fields, "location"),
            description: mapped(item, &config.fields, "description")
                .map(|value| strip_html(&value))
                .unwrap_or_default(),
            posted_at: mapped(item, &config.fields, "posted_at")
                .and_then(|value| parse_datetime(&value)),
            emails: mapped(item, &config.fields, "email")
                .into_iter()
                .flat_map(|value| extract_emails(&value))
                .collect(),
            source_kind: JobSourceKind::JsonApi,
        });
    }

    let next_cursor = config
        .next_page_path
        .as_deref()
        .and_then(|path| json_value_at_path(&root, path))
        .and_then(value_as_text);
    let mut page = page_with_jobs(jobs);
    page.next_cursor = next_cursor;
    Ok(page)
}

pub fn parse_rss(body: &str) -> Result<AdapterPage> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut item: Option<BTreeMap<String, String>> = None;
    let mut current_tag = String::new();
    let mut jobs = Vec::new();

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| CrawlerError::Parse(error.to_string()))?
        {
            Event::Start(element) => {
                let tag = String::from_utf8_lossy(element.name().as_ref()).to_ascii_lowercase();
                if tag == "item" || tag == "entry" {
                    item = Some(BTreeMap::new());
                } else if item.is_some() {
                    current_tag = tag;
                    if current_tag == "link" {
                        if let Some(href) = element
                            .attributes()
                            .flatten()
                            .find(|attribute| attribute.key.as_ref() == b"href")
                            .and_then(|attribute| attribute.unescape_value().ok())
                        {
                            if let Some(map) = item.as_mut() {
                                map.insert("link".to_owned(), href.into_owned());
                            }
                        }
                    }
                }
            }
            Event::Text(text) => {
                if let Some(map) = item.as_mut() {
                    let value = text
                        .unescape()
                        .map_err(|error| CrawlerError::Parse(error.to_string()))?;
                    map.entry(current_tag.clone())
                        .and_modify(|existing| {
                            existing.push(' ');
                            existing.push_str(&value);
                        })
                        .or_insert_with(|| value.into_owned());
                }
            }
            Event::CData(text) => {
                if let Some(map) = item.as_mut() {
                    let value = String::from_utf8_lossy(&text);
                    map.entry(current_tag.clone())
                        .and_modify(|existing| existing.push_str(&value))
                        .or_insert_with(|| value.into_owned());
                }
            }
            Event::End(element) => {
                let tag = String::from_utf8_lossy(element.name().as_ref()).to_ascii_lowercase();
                if tag == "item" || tag == "entry" {
                    if let Some(map) = item.take() {
                        let title = map.get("title").cloned().unwrap_or_default();
                        let url = map
                            .get("link")
                            .cloned()
                            .filter(|value| !value.is_empty())
                            .unwrap_or_default();
                        if !title.is_empty() && !url.is_empty() {
                            let description = map
                                .get("description")
                                .or_else(|| map.get("summary"))
                                .or_else(|| map.get("content"))
                                .cloned()
                                .unwrap_or_default();
                            jobs.push(JobRecord {
                                title: normalize_whitespace(&title),
                                url,
                                apply_url: None,
                                external_id: map.get("guid").cloned(),
                                company: None,
                                location: map.get("location").cloned(),
                                description: strip_html(&description),
                                posted_at: map
                                    .get("pubdate")
                                    .or_else(|| map.get("published"))
                                    .or_else(|| map.get("updated"))
                                    .and_then(|value| parse_datetime(value)),
                                emails: extract_emails(&description),
                                source_kind: JobSourceKind::Rss,
                            });
                        }
                    }
                } else if item.is_some() {
                    current_tag.clear();
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(page_with_jobs(jobs))
}

pub fn parse_sitemap(body: &str) -> Result<AdapterPage> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut inside_loc = false;
    let mut text = String::new();
    let mut urls = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| CrawlerError::Parse(error.to_string()))?
        {
            Event::Start(element) if element.name().as_ref().eq_ignore_ascii_case(b"loc") => {
                inside_loc = true;
                text.clear();
            }
            Event::Text(value) if inside_loc => {
                text.push_str(
                    &value
                        .unescape()
                        .map_err(|error| CrawlerError::Parse(error.to_string()))?,
                );
            }
            Event::End(element) if element.name().as_ref().eq_ignore_ascii_case(b"loc") => {
                if let Ok(url) = Url::parse(text.trim()) {
                    if matches!(url.scheme(), "http" | "https") {
                        urls.push(url.to_string());
                    }
                }
                inside_loc = false;
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(AdapterPage {
        discovered_urls: urls,
        ..AdapterPage::default()
    })
}

pub fn parse_html_selector(body: &str, base_url: &str, config: &Value) -> Result<AdapterPage> {
    let config: HtmlSelectorConfig = serde_json::from_value(config.clone())
        .map_err(|error| CrawlerError::InvalidConfig(error.to_string()))?;
    let document = Html::parse_document(body);
    let item_selector = parse_selector(&config.item_selector)?;
    let mut jobs = Vec::new();
    for item in document.select(&item_selector) {
        let mut fields = BTreeMap::new();
        for (name, field) in &config.fields {
            let selector = parse_selector(&field.selector)?;
            let value = item
                .select(&selector)
                .next()
                .and_then(|element| match &field.attribute {
                    Some(attribute) => element.value().attr(attribute).map(str::to_owned),
                    None => Some(element.text().collect::<Vec<_>>().join(" ")),
                });
            match value {
                Some(value) => {
                    fields.insert(name.clone(), normalize_whitespace(&value));
                }
                None if field.required => {
                    return Err(CrawlerError::Parse(format!(
                        "required HTML field {name} was missing"
                    )))
                }
                None => {}
            }
        }
        let title = required_field(&fields, "title")?;
        let raw_url = required_field(&fields, "url")?;
        let url = absolute_url(base_url, &raw_url)?;
        jobs.push(JobRecord {
            title,
            url,
            apply_url: fields
                .get("apply_url")
                .map(|value| absolute_url(base_url, value))
                .transpose()?,
            external_id: fields.get("external_id").cloned(),
            company: fields.get("company").cloned(),
            location: fields.get("location").cloned(),
            description: fields
                .get("description")
                .map(|value| strip_html(value))
                .unwrap_or_default(),
            posted_at: fields
                .get("posted_at")
                .and_then(|value| parse_datetime(value)),
            emails: fields
                .get("email")
                .map(|value| extract_emails(value))
                .unwrap_or_default(),
            source_kind: JobSourceKind::Html,
        });
    }
    Ok(page_with_jobs(jobs))
}

pub fn parse_csv(body: &str, config: &Value) -> Result<AdapterPage> {
    let config: CsvConfig = serde_json::from_value(config.clone())
        .map_err(|error| CrawlerError::InvalidConfig(error.to_string()))?;
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(config.delimiter as u8)
        .has_headers(config.has_headers)
        .from_reader(body.as_bytes());
    let headers = if config.has_headers {
        Some(
            reader
                .headers()
                .map_err(|error| CrawlerError::Parse(error.to_string()))?
                .clone(),
        )
    } else {
        None
    };
    let mut jobs = Vec::new();
    for row in reader.records() {
        let row = row.map_err(|error| CrawlerError::Parse(error.to_string()))?;
        let mut fields = BTreeMap::new();
        for (name, column) in &config.fields {
            let value = if let Some(headers) = &headers {
                headers
                    .iter()
                    .position(|header| header == column)
                    .and_then(|index| row.get(index))
            } else {
                column
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| row.get(index))
            };
            if let Some(value) = value {
                fields.insert(name.clone(), normalize_whitespace(value));
            }
        }
        let title = required_field(&fields, "title")?;
        let url = required_field(&fields, "url")?;
        jobs.push(JobRecord {
            title,
            url,
            apply_url: fields.get("apply_url").cloned(),
            external_id: fields.get("external_id").cloned(),
            company: fields.get("company").cloned(),
            location: fields.get("location").cloned(),
            description: fields
                .get("description")
                .map(|value| strip_html(value))
                .unwrap_or_default(),
            posted_at: fields
                .get("posted_at")
                .and_then(|value| parse_datetime(value)),
            emails: fields
                .get("email")
                .map(|value| extract_emails(value))
                .unwrap_or_default(),
            source_kind: JobSourceKind::Csv,
        });
    }
    Ok(page_with_jobs(jobs))
}

pub fn json_value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for component in path.split('.').filter(|component| !component.is_empty()) {
        current = match current {
            Value::Object(object) => object.get(component),
            Value::Array(array) => component.parse::<usize>().ok().and_then(|i| array.get(i)),
            _ => None,
        }?;
    }
    Some(current)
}

pub(crate) fn value_as_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Object(object) => ["value", "name", "text"]
            .into_iter()
            .find_map(|key| object.get(key))
            .and_then(value_as_text),
        Value::Array(values) => values.iter().find_map(value_as_text),
        Value::Null => None,
    }
}

fn mapped(item: &Value, fields: &HashMap<String, String>, name: &str) -> Option<String> {
    fields
        .get(name)
        .and_then(|path| json_value_at_path(item, path))
        .and_then(value_as_text)
        .map(|value| normalize_whitespace(&value))
        .filter(|value| !value.is_empty())
}

fn mapped_required(
    item: &Value,
    fields: &HashMap<String, String>,
    name: &str,
    fallback_path: &str,
) -> Result<String> {
    mapped(item, fields, name)
        .or_else(|| {
            if fields.contains_key(name) {
                None
            } else {
                json_value_at_path(item, fallback_path).and_then(value_as_text)
            }
        })
        .map(|value| normalize_whitespace(&value))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CrawlerError::Parse(format!("{name} is required")))
}

fn required_field(fields: &BTreeMap<String, String>, name: &str) -> Result<String> {
    fields
        .get(name)
        .cloned()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CrawlerError::Parse(format!("{name} is required")))
}

fn absolute_url(base_url: &str, value: &str) -> Result<String> {
    Url::parse(base_url)
        .and_then(|base| base.join(value))
        .map(|url| url.to_string())
        .map_err(|error| CrawlerError::InvalidUrl {
            url: value.to_owned(),
            reason: error.to_string(),
        })
}

fn parse_selector(value: &str) -> Result<Selector> {
    Selector::parse(value).map_err(|error| CrawlerError::InvalidConfig(error.to_string()))
}

fn default_items_path() -> String {
    "jobs".to_owned()
}

fn default_delimiter() -> char {
    ','
}

fn default_true() -> bool {
    true
}

fn default_json_fields() -> HashMap<String, String> {
    let mut fields = HashMap::new();
    fields.insert("title".to_owned(), "title".to_owned());
    fields.insert("url".to_owned(), "url".to_owned());
    fields.insert("external_id".to_owned(), "id".to_owned());
    fields.insert("location".to_owned(), "location".to_owned());
    fields.insert("description".to_owned(), "description".to_owned());
    fields.insert("posted_at".to_owned(), "posted_at".to_owned());
    fields
}

fn default_html_fields() -> HashMap<String, HtmlFieldSelector> {
    let field = |selector: &str, attribute: Option<&str>| HtmlFieldSelector {
        selector: selector.to_owned(),
        attribute: attribute.map(str::to_owned),
        required: true,
    };
    HashMap::from([
        ("title".to_owned(), field("h2", None)),
        ("url".to_owned(), field("a", Some("href"))),
    ])
}

fn default_csv_fields() -> HashMap<String, String> {
    let mut fields = HashMap::new();
    fields.insert("title".to_owned(), "title".to_owned());
    fields.insert("url".to_owned(), "url".to_owned());
    fields.insert("external_id".to_owned(), "external_id".to_owned());
    fields.insert("location".to_owned(), "location".to_owned());
    fields.insert("description".to_owned(), "description".to_owned());
    fields.insert("posted_at".to_owned(), "posted_at".to_owned());
    fields
}

#[allow(dead_code)]
fn assert_map_is_used(_: &Map<String, Value>) {}
