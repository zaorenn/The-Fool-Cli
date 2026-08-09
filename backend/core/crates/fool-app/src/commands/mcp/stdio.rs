//! MCP stdio framing, shared by every bridge this binary spawns.
//!
//! Two spellings are in the wild and a bridge does not get to choose which one
//! it is handed. The MCP stdio transport says one JSON document per line;
//! several clients inherited the `Content-Length` header framing from LSP and
//! still send it. A reader that knows only one of them looks, from the other
//! side, like a server that started and then said nothing — which is the
//! hardest failure of all to diagnose from a client's log.
//!
//! So the framing is read off the first byte of each message and the reply goes
//! back in the same spelling. Every limit here is on input a client controls:
//! the point is that a malformed or hostile frame ends the bridge rather than
//! making this process hold memory on the sender's behalf.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::commands::error::{CliBoundaryCode, CliBoundaryError};

/// The largest single message a bridge will assemble.
pub(crate) const MCP_STDIO_FRAME_MAX_BYTES: usize = 10 * 1024 * 1024;
const MCP_STDIO_HEADER_LINE_MAX_BYTES: usize = 8 * 1024;
const MCP_STDIO_HEADER_SECTION_MAX_BYTES: usize = 16 * 1024;
const MCP_STDIO_HEADER_MAX_COUNT: usize = 64;

/// How one message is marked off from the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Framing {
    /// `Content-Length: n\r\n\r\n` and then n bytes.
    ContentLength,
    /// One JSON document per line — what the MCP stdio transport specifies.
    Line,
}

/// One message, and the spelling it arrived in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Message {
    pub(crate) body: Vec<u8>,
    pub(crate) framing: Framing,
}

/// The framing one half of a bridge learned, for the other half to answer in.
///
/// A bridge that reads and writes on separate tasks has no other way to keep
/// the two directions speaking the same language. Until a message has actually
/// been read the answer is `ContentLength`, which is what this binary's bridges
/// have always written.
#[derive(Debug, Clone, Default)]
pub(crate) struct SharedFraming(Arc<AtomicBool>);

impl SharedFraming {
    pub(crate) fn get(&self) -> Framing {
        if self.0.load(Ordering::Relaxed) {
            Framing::Line
        } else {
            Framing::ContentLength
        }
    }

    pub(crate) fn set(&self, framing: Framing) {
        self.0.store(matches!(framing, Framing::Line), Ordering::Relaxed);
    }
}

/// Read one message. `None` is a clean end of input, not a failure.
pub(crate) async fn read_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    subcommand: &'static str,
) -> Result<Option<Message>, CliBoundaryError> {
    match detect_framing(reader, subcommand).await? {
        None => Ok(None),
        Some(Framing::Line) => read_line_message(reader, subcommand).await,
        Some(Framing::ContentLength) => Ok(read_header_message(reader, subcommand).await?.map(|body| Message {
            body,
            framing: Framing::ContentLength,
        })),
    }
}

/// Write one message in the spelling asked for.
pub(crate) async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    framing: Framing,
    body: &[u8],
    subcommand: &'static str,
) -> Result<(), CliBoundaryError> {
    match framing {
        Framing::ContentLength => {
            let header = format!("Content-Length: {}\r\n\r\n", body.len());
            writer
                .write_all(header.as_bytes())
                .await
                .map_err(|_| stdout_write_error(subcommand))?;
            writer
                .write_all(body)
                .await
                .map_err(|_| stdout_write_error(subcommand))?;
        }
        Framing::Line => {
            writer
                .write_all(body)
                .await
                .map_err(|_| stdout_write_error(subcommand))?;
            writer
                .write_all(b"\n")
                .await
                .map_err(|_| stdout_write_error(subcommand))?;
        }
    }
    writer.flush().await.map_err(|_| stdout_write_error(subcommand))
}

/// Look at the first byte of the next message without consuming it.
///
/// Blank lines between messages are skipped: a client that terminates each
/// line and then sends `\r\n` of its own is not making an error worth killing
/// the session over.
async fn detect_framing<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    subcommand: &'static str,
) -> Result<Option<Framing>, CliBoundaryError> {
    loop {
        let available = reader.fill_buf().await.map_err(|_| stdin_read_error(subcommand))?;
        if available.is_empty() {
            return Ok(None);
        }
        let skip = available
            .iter()
            .position(|byte| !matches!(byte, b'\r' | b'\n'))
            .unwrap_or(available.len());
        if skip > 0 {
            reader.consume(skip);
            continue;
        }
        return Ok(Some(match available[0] {
            b'{' | b'[' => Framing::Line,
            _ => Framing::ContentLength,
        }));
    }
}

async fn read_line_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    subcommand: &'static str,
) -> Result<Option<Message>, CliBoundaryError> {
    let mut body = Vec::new();
    loop {
        let (consumed, complete) = {
            let available = reader.fill_buf().await.map_err(|_| stdin_read_error(subcommand))?;
            if available.is_empty() {
                // A last message that was never newline-terminated is still a
                // message; nothing else can arrive after it.
                break;
            }
            let n = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |pos| pos + 1);
            if body.len() + n > MCP_STDIO_FRAME_MAX_BYTES {
                return Err(frame_too_large(subcommand));
            }
            body.extend_from_slice(&available[..n]);
            (n, available[n - 1] == b'\n')
        };
        reader.consume(consumed);
        if complete {
            break;
        }
    }

    while body.last().is_some_and(|byte| matches!(byte, b'\r' | b'\n')) {
        body.pop();
    }
    if body.is_empty() {
        return Ok(None);
    }
    Ok(Some(Message {
        body,
        framing: Framing::Line,
    }))
}

/// Read one `Content-Length` framed message. `None` on a clean EOF.
async fn read_header_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    subcommand: &'static str,
) -> Result<Option<Vec<u8>>, CliBoundaryError> {
    let mut content_length: Option<usize> = None;
    let mut header_line = Vec::new();
    let mut header_bytes = 0usize;
    let mut header_count = 0usize;
    loop {
        let n = read_bounded_header_line(reader, &mut header_line, subcommand).await?;
        if n == 0 {
            return if header_bytes == 0 {
                Ok(None) // Clean EOF before the next frame starts.
            } else {
                Err(stdin_frame_invalid(subcommand))
            };
        }
        header_bytes = header_bytes
            .checked_add(n)
            .ok_or_else(|| stdin_frame_invalid(subcommand))?;
        if header_bytes > MCP_STDIO_HEADER_SECTION_MAX_BYTES {
            return Err(stdin_frame_invalid(subcommand));
        }
        let trimmed = std::str::from_utf8(&header_line)
            .map_err(|_| stdin_frame_invalid(subcommand))?
            .trim();
        if trimmed.is_empty() {
            // Empty line = end of headers
            break;
        }
        header_count += 1;
        if header_count > MCP_STDIO_HEADER_MAX_COUNT {
            return Err(stdin_frame_invalid(subcommand));
        }
        if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                len_str
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| stdin_frame_invalid(subcommand))?,
            );
        }
        // Ignore other headers
    }
    let len = content_length.ok_or_else(|| stdin_frame_invalid(subcommand))?;
    if len > MCP_STDIO_FRAME_MAX_BYTES {
        return Err(frame_too_large(subcommand));
    }
    let mut body = vec![0u8; len];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|_| stdin_read_error(subcommand))?;
    Ok(Some(body))
}

async fn read_bounded_header_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
    subcommand: &'static str,
) -> Result<usize, CliBoundaryError> {
    line.clear();
    loop {
        let (n, end_of_line) = {
            let available = reader.fill_buf().await.map_err(|_| stdin_read_error(subcommand))?;
            if available.is_empty() {
                return Ok(line.len());
            }
            let n = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |pos| pos + 1);
            if line.len() + n > MCP_STDIO_HEADER_LINE_MAX_BYTES {
                return Err(stdin_frame_invalid(subcommand));
            }
            line.extend_from_slice(&available[..n]);
            (n, available[n - 1] == b'\n')
        };
        reader.consume(n);
        if end_of_line {
            return Ok(line.len());
        }
    }
}

pub(crate) fn stdin_frame_invalid(subcommand: &'static str) -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpStdinFrameInvalid,
        subcommand,
        "invalid MCP stdio frame",
    )
}

pub(crate) fn stdin_read_error(subcommand: &'static str) -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpStdinReadFailed,
        subcommand,
        "failed to read MCP stdio frame from stdin",
    )
}

pub(crate) fn stdout_write_error(subcommand: &'static str) -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpStdoutWriteFailed,
        subcommand,
        "failed to write MCP stdio frame to stdout",
    )
}

fn frame_too_large(subcommand: &'static str) -> CliBoundaryError {
    CliBoundaryError::new(
        CliBoundaryCode::McpFrameTooLarge,
        subcommand,
        "MCP stdio frame exceeds configured size limit",
    )
    .with_field("limitBytes", MCP_STDIO_FRAME_MAX_BYTES.to_string())
}

#[cfg(test)]
#[path = "stdio_test.rs"]
mod stdio_test;
