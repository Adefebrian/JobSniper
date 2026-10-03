use jobsniper_crawler::config::CrawlerConfig;
use jobsniper_crawler::http::HttpClient;
use jobsniper_crawler::persistence::PostgresArtifactSink;
use jobsniper_crawler::queue::PostgresTaskQueue;
use jobsniper_crawler::render::LightpandaRenderer;
use jobsniper_crawler::CrawlerWorker;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = CrawlerConfig::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    let http = Arc::new(HttpClient::new(
        config.user_agent.clone(),
        config.request_timeout,
        config.max_body_bytes,
        config.max_redirects,
        config.requests_per_second_per_domain,
    )?);
    let renderer = Arc::new(LightpandaRenderer::new(
        config.lightpanda_path.clone(),
        config.request_timeout,
        config.max_parallel_renderers,
        config.max_body_bytes,
    ));
    let queue = Arc::new(PostgresTaskQueue::new(pool.clone()));
    let sink = Arc::new(PostgresArtifactSink::new(pool));
    let worker_id = std::env::var("CRAWLER_WORKER_ID")
        .unwrap_or_else(|_| format!("jobsniper-crawler:{}", std::process::id()));
    let worker = Arc::new(CrawlerWorker::new(worker_id, queue, http, renderer, sink));
    let poll_seconds = std::env::var("CRAWLER_POLL_SECONDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(5)
        .max(1);

    println!("jobsniper-crawler ready");
    loop {
        tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal?;
                println!("jobsniper-crawler stopping");
                break;
            }
            result = worker.run_once(config.lease_seconds) => {
                match result {
                    Ok(Some(outcome)) => println!("crawl complete: {outcome:?}"),
                    Ok(None) => tokio::time::sleep(Duration::from_secs(poll_seconds)).await,
                    Err(error) => {
                        eprintln!("crawl failed: {error}");
                        tokio::time::sleep(Duration::from_secs(poll_seconds)).await;
                    }
                }
            }
        }
    }
    Ok(())
}
