//! Saving a file from the web onto the disk, and refusing the ones that should
//! not land there.
//!
//! The agent could search, and it could read a page, and between those two it
//! could not obtain a single document. Asked to find a PDF it would locate the
//! address, hand it to `WebFetch`, and get back the result of running a binary
//! through a lossy UTF-8 conversion — which it then reported as the paper's
//! contents. The gap was not the search; it was that nothing wrote bytes.
//!
//! Everything here that looks like paranoia is a specific thing that happens.
//! The address comes from a model, which got it from a page somebody else
//! wrote, so it is checked exactly as strictly as `WebFetch` checks its own —
//! and re-checked at every redirect, because the next address is chosen by that
//! server rather than by us. The **name** comes from the same place, so it is
//! reduced to a bare filename before it is joined to anything: `../../` in a
//! `Content-Disposition` is how a download becomes a write to somewhere else.
//! And the **bytes** are looked at, because a server that says `application/pdf`
//! and sends an executable has not sent a PDF, and a file that lands with a
//! `.pdf` name is a file somebody will later double-click.

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

use foolrs_protocol::events::ToolCategory;
use foolrs_types::tool::{JsonSchema, ToolResult};

use crate::Tool;
use crate::web_fetch::{MAX_HOPS, UrlRefusal, check_url, resolve_relative};

/// How long to wait for the whole download.
///
/// Longer than a page fetch because this is a file, and shorter than a person's
/// patience because a stalled download that never ends is a turn that never
/// ends.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// The largest file that may land on the user's disk from one tool call.
///
/// Generous for a document and far below anything that fills a disk. A server
/// that declares more than this is refused before a byte is transferred; one
/// that declares nothing is counted as it streams, because `Content-Length` is
/// a claim rather than a fact.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Where downloads go, under the workspace.
const FOLDER: &str = "downloads";

/// Extensions that are never written, whatever the server called the file.
///
/// Not a security boundary on its own — the shell tool can still run things —
/// but a downloaded file is one somebody double-clicks later, months after the
/// conversation that produced it. A document tool has no business creating that
/// object at all.
const REFUSED_EXTENSIONS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "psm1", "dll", "sys", "lnk", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "cpl", "jar", "app", "pkg", "dmg", "deb", "rpm", "sh", "bash", "zsh",
];

/// Why a download was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum DownloadRefusal {
    /// The address itself is not one to fetch. Carries the address's own reason.
    Address(UrlRefusal),
    /// The name would put the file somewhere other than the downloads folder.
    Escapes,
    /// The name has an extension this tool will not create.
    Executable(String),
    /// Nothing in the address or the request gives the file a name.
    Unnamed,
    /// The body is not the kind of thing its own headers said it was.
    Mismatched { declared: String, actual: String },
    /// The file is larger than one call may write.
    TooLarge(u64),
}

impl std::fmt::Display for DownloadRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Address(refusal) => write!(f, "{refusal}"),
            Self::Escapes => write!(
                f,
                "that filename points outside the downloads folder; give a plain name with no directories in it"
            ),
            Self::Executable(extension) => write!(
                f,
                "this tool does not save .{extension} files — a downloaded program is something somebody runs later, \
                 and nothing here needs to create one"
            ),
            Self::Unnamed => write!(
                f,
                "that address gives the file no name; pass `filename` to say what to call it"
            ),
            Self::Mismatched { declared, actual } => write!(
                f,
                "the server said {declared} and sent {actual}; the file was not saved, because a name that lies about \
                 its contents is how the wrong thing gets opened later"
            ),
            Self::TooLarge(bytes) => write!(
                f,
                "that file is {bytes} bytes, over the {MAX_BYTES}-byte limit for one download"
            ),
        }
    }
}

/// The extension a body's first bytes actually indicate.
///
/// Deliberately short: this exists to catch a body that disagrees with its own
/// headers, not to identify every format in the world. `None` means "nothing
/// recognised", which is not a refusal — plenty of legitimate files have no
/// signature worth checking.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    const SIGNATURES: &[(&[u8], &str)] = &[
        (b"%PDF", "pdf"),
        (b"PK\x03\x04", "zip"),
        (b"\x89PNG\r\n\x1a\n", "png"),
        (b"GIF8", "gif"),
        (b"\xff\xd8\xff", "jpg"),
        (b"\x7fELF", "elf"),
        (b"MZ", "exe"),
        (b"\xd0\xcf\x11\xe0", "ole"),
        (b"\x1f\x8b", "gz"),
        (b"Rar!", "rar"),
        (b"\x00\x61\x73\x6d", "wasm"),
    ];

    SIGNATURES
        .iter()
        .find(|(signature, _)| bytes.starts_with(signature))
        .map(|(_, kind)| *kind)
}

/// Whether a body's first bytes agree with the type its server declared.
///
/// Only outright contradictions are refused. An unrecognised signature, or a
/// declared type this does not model, passes: the job here is to catch
/// `application/pdf` arriving as an executable, not to arbitrate MIME.
pub fn body_agrees(declared: &str, sniffed: Option<&str>) -> Result<(), DownloadRefusal> {
    let Some(actual) = sniffed else { return Ok(()) };
    let declared_kind = declared.split(';').next().unwrap_or("").trim().to_ascii_lowercase();

    let expected = match declared_kind.as_str() {
        "application/pdf" => Some("pdf"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/jpeg" => Some("jpg"),
        // Every OOXML document is a zip, and so is an .epub and a .jar. The
        // check that matters for these is the extension one below.
        kind if kind.starts_with("application/vnd.openxmlformats-") || kind == "application/zip" => Some("zip"),
        _ => None,
    };

    match expected {
        Some(expected) if expected != actual => Err(DownloadRefusal::Mismatched {
            declared: declared_kind,
            actual: actual.to_string(),
        }),
        _ => Ok(()),
    }
}

/// The name to save under, reduced to something that cannot leave the folder.
///
/// Directory components are dropped rather than rejected: a server sending
/// `attachment; filename="../../autorun.inf"` is describing a file called
/// `autorun.inf`, and the interesting part of that header is the part this
/// throws away. A name that is *only* directories has nothing left, and that is
/// a refusal.
pub fn chosen_filename(url: &str, requested: Option<&str>) -> Result<String, DownloadRefusal> {
    let raw = match requested.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.to_string(),
        None => {
            let path = url.split(['?', '#']).next().unwrap_or("");
            path.rsplit('/').next().unwrap_or("").to_string()
        }
    };

    // Both separators, on every platform: the string came off the wire, not off
    // this filesystem, so `Path` on Linux would keep a backslash as a character.
    let bare = raw.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if bare.is_empty() || bare == "." || bare == ".." {
        return Err(if requested.is_some() {
            DownloadRefusal::Escapes
        } else {
            DownloadRefusal::Unnamed
        });
    }

    let extension = bare.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if bare.contains('.') && REFUSED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(DownloadRefusal::Executable(extension));
    }

    Ok(bare.to_string())
}

/// Proof that a path really is inside the folder it is supposed to be in.
///
/// Belt and braces over {@link chosen_filename}: that function is where the
/// name is made safe, and this is where it is checked, so a later edit to the
/// first cannot quietly move files out of the second.
fn inside(folder: &Path, candidate: &Path) -> bool {
    candidate.starts_with(folder) && !candidate.components().any(|part| part == Component::ParentDir)
}

pub struct DownloadTool {
    client: reqwest::Client,
    workspace: PathBuf,
}

impl DownloadTool {
    pub fn new(workspace: PathBuf) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                // Followed one hop at a time in `locate`, so every address is
                // re-checked. The client following them itself would skip that.
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("TheFool/1.0")
                .build()
                .unwrap_or_default(),
            workspace,
        }
    }

    /// The response at the end of the redirect chain, and the address it came
    /// from — the name is taken from the *final* address, not the first.
    async fn locate(&self, start: &str) -> Result<(reqwest::Response, String), String> {
        let mut url = start.trim().to_string();

        for _ in 0..MAX_HOPS {
            check_url(&url).map_err(|refusal| DownloadRefusal::Address(refusal).to_string())?;

            let response = self
                .client
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("Could not reach that address: {error}"))?;

            if !response.status().is_redirection() {
                return Ok((response, url));
            }

            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "That address redirects without saying where to.".to_string())?;

            url = resolve_relative(&url, location).map_err(|refusal| refusal.to_string())?;
        }

        Err(format!("That address redirects more than {MAX_HOPS} times."))
    }
}

#[async_trait]
impl Tool for DownloadTool {
    fn name(&self) -> &str {
        "Download"
    }

    fn description(&self) -> &str {
        "Saves a file from a public web address into the workspace's downloads folder.\n\n\
         Usage:\n\
         - Use this for anything WebFetch cannot read as text: a PDF, a spreadsheet, an image, an archive.\n\
         - Only public http and https addresses; anything inside this machine or this network is refused, at every redirect as well as at the address you gave.\n\
         - Programs and scripts are never saved, whatever the server calls the file.\n\
         - The bytes are checked against the type the server declared; a file that disagrees with its own headers is not written.\n\
         - Returns the full path it wrote. Read that path with Read, or hand it to a tool that opens documents."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "The full address of the file, including https://" },
                "filename": {
                    "type": "string",
                    "description": "What to call it. A plain name with no directories in it. Leave out to use the name from the address."
                }
            },
            "required": ["url"]
        })
    }

    fn category(&self) -> ToolCategory {
        // Not `Info`, though it reads from the web: this writes to the user's
        // disk, and the layer that decides what needs permission reads this
        // field. A tool that creates files must be seen as one that does.
        ToolCategory::Edit
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        false
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let Some(url) = input["url"].as_str().map(str::trim).filter(|url| !url.is_empty()) else {
            return ToolResult {
                content: "Missing required parameter: url".to_string(),
                is_error: true,
            };
        };

        let (response, final_url) = match self.locate(url).await {
            Ok(found) => found,
            Err(message) => {
                return ToolResult {
                    content: message,
                    is_error: true,
                };
            }
        };

        let status = response.status();
        if !status.is_success() {
            return ToolResult {
                content: format!("That address answered {status}; nothing was saved."),
                is_error: true,
            };
        }

        let declared = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();

        if let Some(length) = response.content_length()
            && length > MAX_BYTES
        {
            return ToolResult {
                content: DownloadRefusal::TooLarge(length).to_string(),
                is_error: true,
            };
        }

        let requested = input["filename"].as_str();
        let name = match chosen_filename(&final_url, requested) {
            Ok(name) => name,
            Err(refusal) => {
                return ToolResult {
                    content: refusal.to_string(),
                    is_error: true,
                };
            }
        };

        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                return ToolResult {
                    content: format!("The download stopped part-way: {error}"),
                    is_error: true,
                };
            }
        };

        if bytes.len() as u64 > MAX_BYTES {
            return ToolResult {
                content: DownloadRefusal::TooLarge(bytes.len() as u64).to_string(),
                is_error: true,
            };
        }

        // Looked at before anything is written. A body that disagrees with its
        // own headers is not saved under a name that lies about it.
        let sniffed = sniff(&bytes);
        if let Err(refusal) = body_agrees(&declared, sniffed) {
            return ToolResult {
                content: refusal.to_string(),
                is_error: true,
            };
        }
        if let Some(kind) = sniffed
            && REFUSED_EXTENSIONS.contains(&kind)
        {
            return ToolResult {
                content: DownloadRefusal::Executable(kind.to_string()).to_string(),
                is_error: true,
            };
        }

        let folder = self.workspace.join(FOLDER);
        let target = folder.join(&name);
        if !inside(&folder, &target) {
            return ToolResult {
                content: DownloadRefusal::Escapes.to_string(),
                is_error: true,
            };
        }

        if let Err(error) = tokio::fs::create_dir_all(&folder).await {
            return ToolResult {
                content: format!("The downloads folder could not be created: {error}"),
                is_error: true,
            };
        }

        let written = async {
            let mut file = tokio::fs::File::create(&target).await?;
            file.write_all(&bytes).await?;
            file.flush().await
        }
        .await;

        if let Err(error) = written {
            return ToolResult {
                content: format!("That file could not be written: {error}"),
                is_error: true,
            };
        }

        ToolResult {
            content: format!(
                "Saved {} bytes to {}\nType: {}",
                bytes.len(),
                target.display(),
                if declared.is_empty() { "unknown" } else { &declared }
            ),
            is_error: false,
        }
    }
}

#[cfg(test)]
#[path = "download_test.rs"]
mod download_test;
