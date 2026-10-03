use crate::error::{CrawlerError, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Semaphore;
use url::Url;

pub struct LightpandaRenderer {
    binary: PathBuf,
    timeout: Duration,
    max_body_bytes: usize,
    permits: Semaphore,
}

impl LightpandaRenderer {
    pub fn new(
        binary: impl Into<PathBuf>,
        timeout: Duration,
        max_parallel: usize,
        max_body_bytes: usize,
    ) -> Self {
        Self {
            binary: binary.into(),
            timeout,
            max_body_bytes,
            permits: Semaphore::new(max_parallel.max(1)),
        }
    }

    pub async fn render(&self, raw_url: &str) -> Result<String> {
        let url = Url::parse(raw_url).map_err(|error| CrawlerError::InvalidUrl {
            url: raw_url.to_owned(),
            reason: error.to_string(),
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(CrawlerError::InvalidUrl {
                url: raw_url.to_owned(),
                reason: "renderer accepts only HTTP and HTTPS".to_owned(),
            });
        }
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| CrawlerError::Render("renderer semaphore was closed".to_owned()))?;
        let mut command = render_command(&self.binary, raw_url);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| CrawlerError::Render(error.to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CrawlerError::Render("renderer stdout was unavailable".to_owned()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| CrawlerError::Render("renderer stderr was unavailable".to_owned()))?;

        let output = tokio::time::timeout(
            self.timeout,
            collect_process_output(child, stdout, stderr, self.max_body_bytes),
        )
        .await
        .map_err(|_| CrawlerError::Render("renderer timed out".to_owned()))??;
        if !output.status.success() {
            return Err(CrawlerError::Render(format!(
                "renderer exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        String::from_utf8(output.stdout).map_err(|error| {
            CrawlerError::Render(format!("renderer returned invalid UTF-8: {error}"))
        })
    }
}

fn render_command(binary: &Path, raw_url: &str) -> Command {
    let mut command = Command::new(binary);
    command.arg("fetch").arg("--dump").arg("html").arg(raw_url);
    command
}

struct ProcessOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn collect_process_output(
    mut child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    max_body_bytes: usize,
) -> Result<ProcessOutput> {
    let stdout_future = read_capped(stdout, max_body_bytes);
    let stderr_future = read_capped(stderr, 32 * 1024);
    let (stdout, stderr) = tokio::join!(stdout_future, stderr_future);
    let status = child
        .wait()
        .await
        .map_err(|error| CrawlerError::Render(error.to_string()))?;
    Ok(ProcessOutput {
        status,
        stdout: stdout?,
        stderr: stderr?,
    })
}

async fn read_capped<R>(reader: R, limit: usize) -> Result<Vec<u8>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8 * 1024];
    let mut reader = reader;
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| CrawlerError::Render(error.to_string()))?;
        if read == 0 {
            break;
        }
        if bytes.len() + read > limit {
            return Err(CrawlerError::BodyTooLarge { limit });
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_invocation_is_argument_based_and_has_no_shell() {
        let command = render_command(Path::new("/opt/lightpanda"), "https://example.com/jobs");
        let std_command: &std::process::Command = command.as_std();
        assert_eq!(std_command.get_program(), "/opt/lightpanda");
        let arguments: Vec<_> = std_command.get_args().collect();
        assert_eq!(
            arguments,
            [
                std::ffi::OsStr::new("fetch"),
                std::ffi::OsStr::new("--dump"),
                std::ffi::OsStr::new("html"),
                std::ffi::OsStr::new("https://example.com/jobs")
            ]
        );
    }
}
