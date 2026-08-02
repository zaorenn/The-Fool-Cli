use std::path::Path;

use fool_common::constants::FOOL_FILES_MARKER;
use foolrs_types::message::{
    ContentBlock, ImageInputCapability, ImageUrl, MAX_IMAGE_INPUT_BYTES, extension_to_image_media_type,
    sniff_image_media_type,
};
use tracing::warn;

const ATTACHED_FILES_HEADER: &str = "[Attached files]";

/// Build provider-independent user input from the message and its attachments.
///
/// Every attachment is listed by path so the agent can read it with its own
/// tools. Image attachments are additionally carried as `Image` blocks when the
/// selected model accepts image input, because a path alone is invisible to the
/// model: it would have to guess that the file is worth a `ViewImage` call, and
/// that tool is withheld entirely unless image support is known. Images lead the
/// block list — providers read a trailing question as being about the images
/// above it.
///
/// When the model cannot take images (or support is unknown) the attachment
/// stays a path, exactly as before.
pub(super) async fn build_content_blocks(
    content: &str,
    files: &[String],
    image_input: ImageInputCapability,
) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();

    if image_input.supports_images() {
        for (index, file_path) in files.iter().enumerate() {
            if let Some(image_url) = load_image_attachment(file_path, index).await {
                blocks.push(ContentBlock::Image { image_url });
            }
        }
    }

    let mut text = strip_attachment_metadata(content, files).trim().to_owned();
    if !files.is_empty() {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(ATTACHED_FILES_HEADER);
        for file_path in files {
            text.push('\n');
            text.push_str(file_path);
        }
    }
    if !text.is_empty() {
        blocks.push(ContentBlock::Text { text });
    }

    blocks
}

/// Read one attachment into a data URI, or return `None` if it is not an image
/// this turn can carry.
///
/// Anything that is not a usable image is skipped silently at `debug`: most
/// attachments are ordinary files and a miss is the normal case. Only a file
/// that *looks* like an image and still cannot be attached warns, since that is
/// the case a user would report as "it did not see my screenshot". The
/// attachment index identifies the file without putting a user path in the log.
async fn load_image_attachment(file_path: &str, index: usize) -> Option<ImageUrl> {
    let path = Path::new(file_path);
    let extension = path.extension().and_then(|extension| extension.to_str())?;
    let claimed_media_type = extension_to_image_media_type(extension)?;

    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) => {
            warn!(
                attachment_index = index,
                error = %error,
                "Image attachment could not be read; sending its path only"
            );
            return None;
        }
    };
    if !metadata.is_file() {
        warn!(
            attachment_index = index,
            "Image attachment is not a regular file; sending its path only"
        );
        return None;
    }
    if metadata.len() > MAX_IMAGE_INPUT_BYTES {
        warn!(
            attachment_index = index,
            size_bytes = metadata.len(),
            limit_bytes = MAX_IMAGE_INPUT_BYTES,
            "Image attachment exceeds the model input size limit; sending its path only"
        );
        return None;
    }

    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!(
                attachment_index = index,
                error = %error,
                "Image attachment could not be read; sending its path only"
            );
            return None;
        }
    };
    let Some(media_type) = sniff_image_media_type(&bytes) else {
        warn!(
            attachment_index = index,
            claimed_media_type, "Image attachment content is not a supported image; sending its path only"
        );
        return None;
    };
    if media_type != claimed_media_type {
        warn!(
            attachment_index = index,
            claimed_media_type, actual_media_type = media_type, "Image attachment extension does not match its content; sending its path only"
        );
        return None;
    }

    Some(ImageUrl::from_image_bytes(media_type, &bytes))
}

fn strip_attachment_metadata<'a>(content: &'a str, files: &[String]) -> &'a str {
    if files.is_empty() {
        return content;
    }
    let Some((user_text, metadata)) = content.rsplit_once(FOOL_FILES_MARKER) else {
        return content;
    };
    let metadata_files = metadata.lines().map(str::trim).filter(|line| !line.is_empty());
    if metadata_files.eq(files.iter().map(String::as_str)) {
        user_text
    } else {
        content
    }
}

#[cfg(test)]
#[path = "content_test.rs"]
mod content_test;
