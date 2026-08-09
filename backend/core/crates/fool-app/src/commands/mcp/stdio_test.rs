use super::*;
use crate::commands::error::CliBoundaryCode;

const SUB: &str = "mcp-bridge";

async fn read(input: &str) -> Result<Option<Message>, CliBoundaryError> {
    read_message(&mut input.as_bytes(), SUB).await
}

// ---------------------------------------------------------------------------
// Content-Length framing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reads_a_content_length_frame() {
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let input = format!("Content-Length: {}\r\n\r\n{body}", body.len());

    let message = read(&input).await.unwrap().unwrap();

    assert_eq!(message.framing, Framing::ContentLength);
    assert_eq!(message.body, body.as_bytes());
}

#[tokio::test]
async fn rejects_oversized_content_length() {
    let input = format!("Content-Length: {}\r\n\r\n", MCP_STDIO_FRAME_MAX_BYTES + 1);
    let err = read(&input).await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpFrameTooLarge);
}

#[tokio::test]
async fn rejects_invalid_content_length() {
    let err = read("Content-Length: nope\r\n\r\n").await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpStdinFrameInvalid);
}

#[tokio::test]
async fn rejects_partial_header_eof() {
    for input in ["Content-Length: 2", "X-Header: value"] {
        let err = read(input).await.unwrap_err();
        assert_eq!(err.code(), CliBoundaryCode::McpStdinFrameInvalid);
    }
}

#[tokio::test]
async fn rejects_overlong_header_line() {
    let input = format!("X-Header: {}\r\nContent-Length: 2\r\n\r\n{{}}", "a".repeat(16 * 1024));
    let err = read(&input).await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpStdinFrameInvalid);
}

#[tokio::test]
async fn rejects_oversized_header_section() {
    let line_a = format!(
        "X-A: {}\r\n",
        "a".repeat(MCP_STDIO_HEADER_LINE_MAX_BYTES - "X-A: \r\n".len())
    );
    let line_b = format!(
        "X-B: {}\r\n",
        "b".repeat(MCP_STDIO_HEADER_LINE_MAX_BYTES - "X-B: \r\n".len())
    );
    let input = format!("{line_a}{line_b}X-C: v\r\nContent-Length: 0\r\n\r\n");

    let err = read(&input).await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpStdinFrameInvalid);
}

#[tokio::test]
async fn rejects_too_many_headers() {
    let mut input = String::new();
    for index in 0..=MCP_STDIO_HEADER_MAX_COUNT {
        input.push_str(&format!("X-{index}: v\r\n"));
    }
    input.push_str("Content-Length: 0\r\n\r\n");

    let err = read(&input).await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpStdinFrameInvalid);
}

// ---------------------------------------------------------------------------
// Line framing — what the MCP stdio transport actually specifies
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reads_a_line_framed_message() {
    let message = read("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(message.framing, Framing::Line);
    assert_eq!(message.body, br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
}

/// The two messages have to come out separately, and the second must not
/// inherit anything from the first.
#[tokio::test]
async fn reads_line_framed_messages_back_to_back() {
    let input = "{\"id\":1}\n{\"id\":2}\n";
    let mut reader = input.as_bytes();

    let first = read_message(&mut reader, SUB).await.unwrap().unwrap();
    let second = read_message(&mut reader, SUB).await.unwrap().unwrap();
    let third = read_message(&mut reader, SUB).await.unwrap();

    assert_eq!(first.body, br#"{"id":1}"#);
    assert_eq!(second.body, br#"{"id":2}"#);
    assert!(third.is_none(), "input is exhausted");
}

/// A client that ends its last message without a newline has still sent it.
#[tokio::test]
async fn reads_a_line_framed_message_without_a_trailing_newline() {
    let message = read("{\"id\":1}").await.unwrap().unwrap();
    assert_eq!(message.body, br#"{"id":1}"#);
}

/// Blank lines between messages are noise, not a protocol violation worth
/// killing a session over.
#[tokio::test]
async fn skips_blank_lines_between_messages() {
    let message = read("\r\n\n{\"id\":1}\n").await.unwrap().unwrap();
    assert_eq!(message.framing, Framing::Line);
    assert_eq!(message.body, br#"{"id":1}"#);
}

#[tokio::test]
async fn empty_input_is_a_clean_end() {
    assert!(read("").await.unwrap().is_none());
    assert!(read("\r\n\r\n").await.unwrap().is_none());
}

#[tokio::test]
async fn rejects_an_oversized_line() {
    let input = format!("{{\"a\":\"{}\"}}\n", "x".repeat(MCP_STDIO_FRAME_MAX_BYTES));
    let err = read(&input).await.unwrap_err();
    assert_eq!(err.code(), CliBoundaryCode::McpFrameTooLarge);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn writes_each_framing_the_way_its_reader_expects() {
    for framing in [Framing::ContentLength, Framing::Line] {
        let mut out = Vec::<u8>::new();
        write_message(&mut out, framing, br#"{"id":1}"#, SUB).await.unwrap();

        let mut cursor = std::io::Cursor::new(out);
        let read_back = read_message(&mut cursor, SUB).await.unwrap().unwrap();
        assert_eq!(read_back.framing, framing);
        assert_eq!(read_back.body, br#"{"id":1}"#);
    }
}

#[test]
fn shared_framing_starts_at_content_length() {
    let framing = SharedFraming::default();
    assert_eq!(framing.get(), Framing::ContentLength);
    framing.set(Framing::Line);
    assert_eq!(framing.get(), Framing::Line);
}
