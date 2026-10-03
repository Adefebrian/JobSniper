use crate::error::{CrawlerError, Result};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgPool;
use sqlx::Row;
use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrawlTask {
    pub id: String,
    pub source_id: Option<String>,
    pub priority: i32,
    pub lease_until: Option<DateTime<Utc>>,
    pub attempts: i32,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskResult {
    Done { summary: String },
    Retry { error: String, backoff_seconds: i64 },
    Failed { error: String },
}

#[async_trait]
pub trait TaskQueue: Send + Sync {
    async fn claim(&self, worker_id: &str, lease_seconds: i64) -> Result<Option<CrawlTask>>;
    async fn complete(&self, task_id: &str, summary: &str) -> Result<()>;
    async fn retry(&self, task_id: &str, error: &str, backoff_seconds: i64) -> Result<()>;
    async fn fail(&self, task_id: &str, error: &str) -> Result<()>;

    async fn report(&self, task_id: &str, result: TaskResult) -> Result<()> {
        match result {
            TaskResult::Done { summary } => self.complete(task_id, &summary).await,
            TaskResult::Retry {
                error,
                backoff_seconds,
            } => self.retry(task_id, &error, backoff_seconds).await,
            TaskResult::Failed { error } => self.fail(task_id, &error).await,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PostgresTaskQueue {
    pool: PgPool,
}

impl PostgresTaskQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

#[async_trait]
impl TaskQueue for PostgresTaskQueue {
    async fn claim(&self, worker_id: &str, lease_seconds: i64) -> Result<Option<CrawlTask>> {
        let now = Utc::now();
        let lease_until = now + Duration::seconds(lease_seconds.clamp(1, 24 * 60 * 60));
        let row = sqlx::query(
            r#"
            UPDATE crawl_tasks AS task
            SET status = 'leased',
                leased_by = $1,
                lease_until = $2,
                updated_at = now()
            WHERE task.id IN (
                SELECT id
                FROM crawl_tasks
                WHERE status = 'queued'
                   OR (status = 'leased' AND lease_until < $3)
                ORDER BY priority DESC, created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING
                task.id::text AS id,
                task.source_id::text AS source_id,
                task.priority,
                task.lease_until,
                task.attempts,
                task.payload
            "#,
        )
        .bind(worker_id)
        .bind(lease_until)
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;

        row.map(|row| {
            Ok(CrawlTask {
                id: row.try_get("id").map_err(database_error)?,
                source_id: row.try_get("source_id").map_err(database_error)?,
                priority: row.try_get("priority").map_err(database_error)?,
                lease_until: row.try_get("lease_until").map_err(database_error)?,
                attempts: row.try_get("attempts").map_err(database_error)?,
                payload: row.try_get("payload").map_err(database_error)?,
            })
        })
        .transpose()
    }

    async fn complete(&self, task_id: &str, _summary: &str) -> Result<()> {
        let row = sqlx::query(
            r#"
            UPDATE crawl_tasks
            SET status = 'done',
                lease_until = NULL,
                leased_by = NULL,
                last_error = NULL,
                updated_at = now()
            WHERE id = $1::uuid
            RETURNING payload
            "#,
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        if let Some(row) = row {
            let payload: Value = row.try_get("payload").map_err(database_error)?;
            if let Some(career_source_id) = payload
                .get("career_source_id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                sqlx::query(
                    r#"
                    UPDATE career_sources
                    SET fail_count = 0,
                        blocked_until = NULL,
                        last_ok_at = now(),
                        last_error = NULL,
                        updated_at = now()
                    WHERE id = $1::uuid
                    "#,
                )
                .bind(career_source_id)
                .execute(&self.pool)
                .await
                .map_err(database_error)?;
                sqlx::query(
                    r#"
                    UPDATE companies
                    SET health = 'ok',
                        updated_at = now()
                    WHERE id = (
                        SELECT company_id FROM career_sources WHERE id = $1::uuid
                    )
                    "#,
                )
                .bind(career_source_id)
                .execute(&self.pool)
                .await
                .map_err(database_error)?;
            }
        }
        Ok(())
    }

    async fn retry(&self, task_id: &str, error: &str, backoff_seconds: i64) -> Result<()> {
        let backoff_seconds = backoff_seconds.clamp(1, 24 * 60 * 60);
        sqlx::query(
            r#"
            UPDATE crawl_tasks
            SET attempts = attempts + 1,
                status = CASE
                    WHEN attempts + 1 >= max_attempts THEN 'failed'
                    ELSE 'queued'
                END,
                lease_until = CASE
                    WHEN attempts + 1 >= max_attempts THEN NULL
                    ELSE now() + ($2::double precision * interval '1 second')
                END,
                leased_by = NULL,
                last_error = $3,
                updated_at = now()
            WHERE id = $1::uuid
            "#,
        )
        .bind(task_id)
        .bind(backoff_seconds as f64)
        .bind(error)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn fail(&self, task_id: &str, error: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE crawl_tasks
            SET status = 'failed',
                attempts = attempts + 1,
                lease_until = NULL,
                leased_by = NULL,
                last_error = $2,
                updated_at = now()
            WHERE id = $1::uuid
            "#,
        )
        .bind(task_id)
        .bind(error)
        .execute(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct MemoryTask {
    task: CrawlTask,
    status: MemoryStatus,
    last_error: Option<String>,
    result_summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemoryStatus {
    Pending,
    Done,
    Failed,
}

#[derive(Debug, Default)]
pub struct MemoryTaskQueue {
    tasks: Mutex<VecDeque<MemoryTask>>,
}

impl MemoryTaskQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, task: CrawlTask) {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push_back(MemoryTask {
                task,
                status: MemoryStatus::Pending,
                last_error: None,
                result_summary: None,
            });
    }

    pub fn snapshot(&self) -> Vec<(CrawlTask, Option<String>, Option<String>)> {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(|entry| {
                (
                    entry.task.clone(),
                    entry.last_error.clone(),
                    entry.result_summary.clone(),
                )
            })
            .collect()
    }
}

#[async_trait]
impl TaskQueue for MemoryTaskQueue {
    async fn claim(&self, _worker_id: &str, lease_seconds: i64) -> Result<Option<CrawlTask>> {
        let now = Utc::now();
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut best_index = None;
        let mut best_priority = i32::MIN;
        for (index, entry) in tasks.iter().enumerate() {
            let available = entry.status == MemoryStatus::Pending
                && entry
                    .task
                    .lease_until
                    .map(|until| until <= now)
                    .unwrap_or(true);
            if available && entry.task.priority >= best_priority {
                best_priority = entry.task.priority;
                best_index = Some(index);
            }
        }
        Ok(best_index.map(|index| {
            let entry = &mut tasks[index];
            entry.task.lease_until =
                Some(now + Duration::seconds(lease_seconds.clamp(1, 24 * 60 * 60)));
            entry.task.clone()
        }))
    }

    async fn complete(&self, task_id: &str, summary: &str) -> Result<()> {
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = find_mut(&mut tasks, task_id)?;
        entry.status = MemoryStatus::Done;
        entry.task.lease_until = None;
        entry.last_error = None;
        entry.result_summary = Some(summary.to_owned());
        Ok(())
    }

    async fn retry(&self, task_id: &str, error: &str, backoff_seconds: i64) -> Result<()> {
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = find_mut(&mut tasks, task_id)?;
        entry.status = MemoryStatus::Pending;
        entry.task.attempts += 1;
        entry.task.lease_until =
            Some(Utc::now() + Duration::seconds(backoff_seconds.clamp(1, 24 * 60 * 60)));
        entry.last_error = Some(error.to_owned());
        entry.result_summary = None;
        Ok(())
    }

    async fn fail(&self, task_id: &str, error: &str) -> Result<()> {
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = find_mut(&mut tasks, task_id)?;
        entry.status = MemoryStatus::Failed;
        entry.task.attempts += 1;
        entry.task.lease_until = None;
        entry.last_error = Some(error.to_owned());
        entry.result_summary = None;
        Ok(())
    }
}

fn find_mut<'a>(tasks: &'a mut VecDeque<MemoryTask>, task_id: &str) -> Result<&'a mut MemoryTask> {
    tasks
        .iter_mut()
        .find(|entry| entry.task.id == task_id)
        .ok_or_else(|| CrawlerError::Database(format!("task {task_id} was not found")))
}

fn database_error(error: impl std::fmt::Display) -> CrawlerError {
    CrawlerError::Database(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task(id: &str, priority: i32) -> CrawlTask {
        CrawlTask {
            id: id.to_owned(),
            source_id: Some("00000000-0000-0000-0000-000000000001".to_owned()),
            priority,
            lease_until: None,
            attempts: 0,
            payload: json!({"kind": "crawl", "url": "https://example.com/jobs"}),
        }
    }

    #[tokio::test]
    async fn claim_honors_priority_lease_and_skip_locked_semantics() {
        let queue = MemoryTaskQueue::new();
        queue.push(task("00000000-0000-0000-0000-000000000002", 5));

        let first = queue.claim("worker-1", 300).await.unwrap().unwrap();
        let second = queue.claim("worker-2", 300).await.unwrap();
        assert_eq!(first.id, "00000000-0000-0000-0000-000000000002");
        assert!(second.is_none());
    }

    #[tokio::test]
    async fn terminal_and_retry_results_update_attempts_and_state() {
        let queue = MemoryTaskQueue::new();
        queue.push(task("00000000-0000-0000-0000-000000000001", 1));
        let claimed = queue.claim("worker-1", 300).await.unwrap().unwrap();
        queue
            .report(
                &claimed.id,
                TaskResult::Retry {
                    error: "temporary failure".to_owned(),
                    backoff_seconds: 60,
                },
            )
            .await
            .unwrap();
        assert!(queue.claim("worker-1", 300).await.unwrap().is_none());
        let snapshot = queue.snapshot();
        assert_eq!(snapshot[0].0.attempts, 1);
        assert_eq!(snapshot[0].1.as_deref(), Some("temporary failure"));

        queue
            .report(
                "00000000-0000-0000-0000-000000000001",
                TaskResult::Done {
                    summary: "1 job extracted".to_owned(),
                },
            )
            .await
            .unwrap();
        let snapshot = queue.snapshot();
        assert_eq!(snapshot[0].2.as_deref(), Some("1 job extracted"));
    }
}
