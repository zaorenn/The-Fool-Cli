use std::path::Path;

use fool_common::constants::FOOL_FILES_MARKER;
use foolrs_types::message::{ContentBlock, ImageInputCapability};
use tempfile::TempDir;

use super::build_content_blocks;

/// Smallest byte sequence that both sniffs as PNG and decodes as one.
const PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
];

fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> String {
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("write fixture");
    path.to_string_lossy().into_owned()
}

fn text_of(block: &ContentBlock) -> &str {
    match block {
        ContentBlock::Text { text } => text,
        other => panic!("expected a text block, got {other:?}"),
    }
}

#[tokio::test]
async fn attaches_image_bytes_so_a_vision_model_can_see_them() {
    let dir = TempDir::new().expect("temp dir");
    let image_path = write_file(dir.path(), "shot.png", PNG_BYTES);
    let content = format!("look at this\n\n{FOOL_FILES_MARKER}\n{image_path}");

    let blocks = build_content_blocks(
        &content,
        std::slice::from_ref(&image_path),
        ImageInputCapability::Supported,
    )
    .await;

    assert_eq!(blocks.len(), 2, "expected one image block and one text block");
    let ContentBlock::Image { image_url } = &blocks[0] else {
        panic!("expected the image block first, got {:?}", blocks[0]);
    };
    assert!(image_url.url.starts_with("data:image/png;base64,"));
    image_url.validate().expect("attached image must be a valid data URI");
    assert_eq!(
        text_of(&blocks[1]),
        format!("look at this\n\n[Attached files]\n{image_path}")
    );
}

#[tokio::test]
async fn keeps_image_as_path_when_the_model_cannot_take_images() {
    let dir = TempDir::new().expect("temp dir");
    let image_path = write_file(dir.path(), "shot.png", PNG_BYTES);

    for capability in [ImageInputCapability::Unsupported, ImageInputCapability::Unknown] {
        let blocks = build_content_blocks("look at this", std::slice::from_ref(&image_path), capability).await;

        assert_eq!(blocks.len(), 1, "{capability:?} must not carry image bytes");
        assert_eq!(
            text_of(&blocks[0]),
            format!("look at this\n\n[Attached files]\n{image_path}")
        );
    }
}

#[tokio::test]
async fn skips_attachments_whose_bytes_are_not_the_image_the_name_claims() {
    let dir = TempDir::new().expect("temp dir");
    let liar = write_file(
        dir.path(),
        "not-really.png",
        b"plain text pretending to be a screenshot",
    );

    let blocks = build_content_blocks(
        "look at this",
        std::slice::from_ref(&liar),
        ImageInputCapability::Supported,
    )
    .await;

    assert_eq!(blocks.len(), 1, "a mislabelled file must not become an image block");
    assert_eq!(text_of(&blocks[0]), format!("look at this\n\n[Attached files]\n{liar}"));
}

#[tokio::test]
async fn attaches_every_image_in_the_order_they_were_sent() {
    let dir = TempDir::new().expect("temp dir");
    let first = write_file(dir.path(), "first.png", PNG_BYTES);
    let notes = write_file(dir.path(), "notes.txt", b"not an image");
    let second = write_file(dir.path(), "second.png", PNG_BYTES);
    let files = vec![first, notes, second];

    let blocks = build_content_blocks("see attachments", &files, ImageInputCapability::Supported).await;

    assert_eq!(blocks.len(), 3, "two images plus the text block");
    assert!(matches!(&blocks[0], ContentBlock::Image { .. }));
    assert!(matches!(&blocks[1], ContentBlock::Image { .. }));
    assert_eq!(
        text_of(&blocks[2]),
        format!("see attachments\n\n[Attached files]\n{}", files.join("\n"))
    );
}

#[tokio::test]
async fn preserves_literal_marker_when_suffix_does_not_match_files() {
    let literal = format!("discuss {FOOL_FILES_MARKER}\nnot-the-attached-path");

    let blocks = build_content_blocks(
        &literal,
        &["/tmp/image.png".to_owned()],
        ImageInputCapability::Supported,
    )
    .await;

    let text = text_of(&blocks[0]);
    assert!(text.starts_with(&literal) && text.ends_with("[Attached files]\n/tmp/image.png"));
}

#[tokio::test]
async fn appends_all_authoritative_attachment_paths() {
    let files = vec!["/tmp/notes.txt".to_owned(), "/tmp/image.png".to_owned()];

    let blocks = build_content_blocks("see attachments", &files, ImageInputCapability::Supported).await;

    assert_eq!(
        text_of(&blocks[0]),
        "see attachments\n\n[Attached files]\n/tmp/notes.txt\n/tmp/image.png"
    );
}
