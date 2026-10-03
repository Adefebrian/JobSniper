use crate::dedup::{content_hash, source_identifier};
use crate::error::{CrawlerError, Result};
use crate::model::CrawlArtifact;
use crate::worker::ArtifactSink;
use async_trait::async_trait;
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

pub struct PostgresArtifactSink {
    pool: PgPool,
}

impl PostgresArtifactSink {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn update_source_success(
        &self,
        career_source_id: Option<&str>,
        source_id: Option<&str>,
        requested_url: &str,
        content_hash: &str,
        etag: Option<&str>,
    ) -> Result<()> {
        match (career_source_id, source_id) {
            (Some(career_source_id), _) => {
                sqlx::query(
                    r#"
                    UPDATE career_sources
                    SET content_hash = $2,
                        etag = $3,
                        fail_count = 0,
                        blocked_until = NULL,
                        last_ok_at = now(),
                        last_error = NULL,
                        updated_at = now()
                    WHERE id = $1::uuid
                    "#,
                )
                .bind(career_source_id)
                .bind(content_hash)
                .bind(etag)
                .execute(&self.pool)
                .await
                .map_err(database_error)?;
            }
            (None, Some(source_id)) => {
                sqlx::query(
                    r#"
                    UPDATE career_sources
                    SET content_hash = $3,
                        etag = $4,
                        fail_count = 0,
                        blocked_until = NULL,
                        last_ok_at = now(),
                        last_error = NULL,
                        updated_at = now()
                    WHERE source_id = $1::uuid AND url = $2
                    "#,
                )
                .bind(source_id)
                .bind(requested_url)
                .bind(content_hash)
                .bind(etag)
                .execute(&self.pool)
                .await
                .map_err(database_error)?;
            }
            (None, None) => {}
        }
        Ok(())
    }

    async fn update_source_failure(
        &self,
        career_source_id: Option<&str>,
        source_id: Option<&str>,
        url: &str,
        blocked: bool,
        error: &str,
    ) -> Result<()> {
        let affected = match (career_source_id, source_id) {
            (Some(career_source_id), _) => sqlx::query(
                r#"
                    UPDATE career_sources
                    SET fail_count = fail_count + 1,
                        blocked_until = CASE
                            WHEN fail_count + 1 >= 3 OR $2::boolean
                                THEN now() + interval '24 hours'
                            ELSE blocked_until
                        END,
                        last_error = $3,
                        updated_at = now()
                    WHERE id = $1::uuid
                    "#,
            )
            .bind(career_source_id)
            .bind(blocked)
            .bind(error)
            .execute(&self.pool)
            .await
            .map_err(database_error)?
            .rows_affected(),
            (None, Some(source_id)) => sqlx::query(
                r#"
                    UPDATE career_sources
                    SET fail_count = fail_count + 1,
                        blocked_until = CASE
                            WHEN fail_count + 1 >= 3 OR $3::boolean
                                THEN now() + interval '24 hours'
                            ELSE blocked_until
                        END,
                        last_error = $4,
                        updated_at = now()
                    WHERE source_id = $1::uuid AND url = $2
                    "#,
            )
            .bind(source_id)
            .bind(url)
            .bind(blocked)
            .bind(error)
            .execute(&self.pool)
            .await
            .map_err(database_error)?
            .rows_affected(),
            (None, None) => 0,
        };
        if affected > 0 {
            sqlx::query(
                r#"
                UPDATE companies
                SET health = CASE WHEN $2::boolean THEN 'blocked' ELSE 'failing' END,
                    updated_at = now()
                WHERE id = (
                    SELECT company_id
                    FROM career_sources
                    WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
                       OR ($1::uuid IS NULL AND source_id = $3::uuid AND url = $4)
                    LIMIT 1
                )
                "#,
            )
            .bind(career_source_id)
            .bind(blocked)
            .bind(source_id)
            .bind(url)
            .execute(&self.pool)
            .await
            .map_err(database_error)?;
        }
        Ok(())
    }
}

#[async_trait]
impl ArtifactSink for PostgresArtifactSink {
    async fn store(&self, artifact: &CrawlArtifact) -> Result<()> {
        let company_id = if artifact.jobs.is_empty() {
            None
        } else {
            Some(parse_id(artifact.company_id.as_deref(), "company_id")?)
        };
        let source_id = artifact
            .source_id
            .as_deref()
            .map(|value| parse_id(Some(value), "source_id"))
            .transpose()?;
        for job in &artifact.jobs {
            let external_id = source_identifier(job);
            let job_id = Uuid::new_v4().to_string();
            let apply_url = job.apply_url.as_deref().unwrap_or(&job.url);
            let row = sqlx::query(
                r#"
                INSERT INTO jobs (
                    id,
                    company_id,
                    source_id,
                    external_id,
                    title,
                    url,
                    apply_url,
                    location,
                    posted_at,
                    first_seen_at,
                    last_seen_at,
                    jd_text,
                    jd_hash,
                    ai_evidence,
                    score_breakdown,
                    status
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3::uuid,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    now(),
                    now(),
                    $10,
                    $11,
                    '[]'::jsonb,
                    '{}'::jsonb,
                    'new'
                )
                ON CONFLICT (source_id, external_id)
                    WHERE source_id IS NOT NULL AND external_id IS NOT NULL
                DO UPDATE SET
                    title = EXCLUDED.title,
                    url = EXCLUDED.url,
                    apply_url = EXCLUDED.apply_url,
                    location = EXCLUDED.location,
                    posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
                    last_seen_at = now(),
                    jd_text = EXCLUDED.jd_text,
                    jd_hash = EXCLUDED.jd_hash,
                    updated_at = now()
                RETURNING id::text AS id
                "#,
            )
            .bind(&job_id)
            .bind(company_id.as_deref())
            .bind(source_id.as_deref())
            .bind(&external_id)
            .bind(&job.title)
            .bind(&job.url)
            .bind(apply_url)
            .bind(&job.location)
            .bind(job.posted_at)
            .bind(&job.description)
            .bind(content_hash(job.description.as_bytes()))
            .fetch_one(&self.pool)
            .await
            .map_err(database_error)?;
            let stored_job_id: String = row.try_get("id").map_err(database_error)?;
            if let Some(source_id) = source_id.as_deref() {
                sqlx::query(
                    r#"
                    INSERT INTO job_sightings (job_id, source_id, url, seen_at)
                    VALUES ($1::uuid, $2::uuid, $3, now())
                    ON CONFLICT (job_id, source_id) DO UPDATE SET
                        url = EXCLUDED.url,
                        seen_at = now()
                    "#,
                )
                .bind(&stored_job_id)
                .bind(source_id)
                .bind(&job.url)
                .execute(&self.pool)
                .await
                .map_err(database_error)?;
            }
        }

        let career_source_id = artifact
            .career_source_id
            .as_deref()
            .map(|value| parse_id(Some(value), "career_source_id"))
            .transpose()?;
        self.update_source_success(
            career_source_id.as_deref(),
            source_id.as_deref(),
            &artifact.requested_url,
            &artifact.content_hash,
            artifact.etag.as_deref(),
        )
        .await
    }

    async fn record_failure(
        &self,
        career_source_id: Option<&str>,
        source_id: Option<&str>,
        url: &str,
        blocked: bool,
        error: &str,
    ) -> Result<()> {
        let source_id = source_id
            .map(|value| parse_id(Some(value), "source_id"))
            .transpose()?;
        let career_source_id = career_source_id
            .map(|value| parse_id(Some(value), "career_source_id"))
            .transpose()?;
        self.update_source_failure(
            career_source_id.as_deref(),
            source_id.as_deref(),
            url,
            blocked,
            error,
        )
        .await
    }
}

fn parse_id(value: Option<&str>, field: &str) -> Result<String> {
    let value = value.ok_or_else(|| {
        CrawlerError::InvalidPayload(format!("{field} is required for persistence"))
    })?;
    Uuid::parse_str(value.trim())
        .map(|value| value.to_string())
        .map_err(|_| CrawlerError::InvalidPayload(format!("{field} must be a UUID")))
}

fn database_error(error: impl std::fmt::Display) -> CrawlerError {
    CrawlerError::Database(error.to_string())
}
