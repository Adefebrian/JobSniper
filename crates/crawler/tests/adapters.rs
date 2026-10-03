use jobsniper_crawler::{
    extract_html, parse_csv, parse_html_selector, parse_json_api, parse_rss, parse_sitemap,
    DiscoveredLinkKind,
};
use serde_json::json;

#[test]
fn generic_json_adapter_uses_config_paths() {
    let page = parse_json_api(
        include_str!("fixtures/generic.json"),
        &json!({
          "items_path": "data.jobs",
          "fields": {
            "title": "title",
            "url": "url",
            "apply_url": "apply_url",
            "external_id": "id",
            "company": "company_name",
            "location": "workplace",
            "description": "summary",
            "posted_at": "published"
          }
        }),
    )
    .unwrap();
    assert_eq!(page.jobs.len(), 1);
    assert_eq!(page.jobs[0].external_id.as_deref(), Some("GEN-10"));
    assert_eq!(page.jobs[0].company.as_deref(), Some("Example Systems"));
}

#[test]
fn rss_and_sitemap_fixtures_parse_deterministically() {
    let rss = parse_rss(include_str!("fixtures/rss.xml")).unwrap();
    assert_eq!(rss.jobs.len(), 1);
    assert_eq!(rss.jobs[0].external_id.as_deref(), Some("rss-1"));

    let sitemap = parse_sitemap(include_str!("fixtures/sitemap.xml")).unwrap();
    assert_eq!(
        sitemap.discovered_urls,
        vec![
            "https://careers.example.com/jobs/ai-engineer".to_owned(),
            "https://careers.example.com/jobs/llm-engineer".to_owned()
        ]
    );
}

#[test]
fn html_and_csv_fixtures_parse_to_complete_job_shapes() {
    let html = parse_html_selector(
        r#"<article><h2>AI Engineer</h2><a href="/jobs/42">View</a></article>"#,
        "https://careers.example.com",
        &json!({
          "item_selector": "article",
          "fields": {
            "title": {"selector": "h2"},
            "url": {"selector": "a", "attribute": "href"}
          }
        }),
    )
    .unwrap();
    assert_eq!(html.jobs[0].url, "https://careers.example.com/jobs/42");

    let csv = parse_csv(
        include_str!("fixtures/jobs.csv"),
        &json!({
          "fields": {
            "title": "title",
            "url": "url",
            "apply_url": "apply_url",
            "external_id": "external_id",
            "company": "company",
            "location": "location",
            "description": "description",
            "posted_at": "posted_at"
          }
        }),
    )
    .unwrap();
    assert_eq!(csv.jobs.len(), 1);
    assert_eq!(csv.jobs[0].external_id.as_deref(), Some("CSV-1"));
}

#[test]
fn csv_without_headers_uses_zero_based_column_indexes() {
    let csv = parse_csv(
        "10,Data Platform Engineer,https://careers.example.com/jobs/10",
        &json!({
          "has_headers": false,
          "fields": {
            "external_id": "0",
            "title": "1",
            "url": "2"
          }
        }),
    )
    .unwrap();
    assert_eq!(csv.jobs.len(), 1);
    assert_eq!(csv.jobs[0].title, "Data Platform Engineer");
    assert_eq!(csv.jobs[0].external_id.as_deref(), Some("10"));
}

#[test]
fn html_fixture_extracts_json_ld_email_and_apply_link() {
    let page = extract_html(
        include_str!("fixtures/jobs.html"),
        "https://careers.example.com/careers",
    )
    .unwrap();
    assert_eq!(page.jobs.len(), 1);
    assert_eq!(page.emails, vec!["talent@example.com".to_owned()]);
    assert!(page
        .links
        .iter()
        .any(|link| link.kind == DiscoveredLinkKind::Apply));
}
