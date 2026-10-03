mod html;
mod json_ld;
mod text;

pub use html::{extract_html, extract_links};
pub use json_ld::extract_json_ld_jobs;
pub use text::{decode_mailto, extract_emails, html_to_blocks, normalize_whitespace, parse_datetime, strip_html};
