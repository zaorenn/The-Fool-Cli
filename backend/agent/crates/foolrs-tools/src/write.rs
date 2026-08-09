use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use async_trait::async_trait;
use serde_json::{Value, json};

use foolrs_protocol::events::ToolCategory;
use foolrs_types::tool::{JsonSchema, ToolResult};

use crate::Tool;
use crate::checkpoint::CheckpointStore;
use crate::confinement::Confinement;
use crate::file_cache::{FileStateCache, update_cache_after_write};

pub struct WriteTool {
    file_cache: Option<Arc<RwLock<FileStateCache>>>,
    checkpoints: Option<Arc<Mutex<CheckpointStore>>>,
    confinement: Confinement,
}

impl WriteTool {
    /// Create a WriteTool with optional file state cache.
    ///
    /// When cache is `Some`, the tool updates the cache after each successful
    /// write so that subsequent Edit/Read calls see the latest content and mtime.
    ///
    /// No "must Read first" guard: Write is intended for creating new files
    /// or complete rewrites.
    ///
    /// Pass `None` to disable cache integration (legacy behavior).
    pub fn new(file_cache: Option<Arc<RwLock<FileStateCache>>>) -> Self {
        Self {
            file_cache,
            checkpoints: None,
            confinement: Confinement::None,
        }
    }

    /// Refuses to write outside one directory.
    ///
    /// A boundary against a mistake rather than against an attacker — see
    /// `confinement`, which says so at length and is the only place that
    /// should.
    pub fn confined_to(mut self, confinement: Confinement) -> Self {
        self.confinement = confinement;
        self
    }

    /// Copies a file aside before overwriting it, so the turn can be undone.
    ///
    /// Optional, like the cache above: the CLI and the tests run without one.
    pub fn with_checkpoints(mut self, checkpoints: Arc<Mutex<CheckpointStore>>) -> Self {
        self.checkpoints = Some(checkpoints);
        self
    }
}

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &str {
        "Write"
    }

    fn description(&self) -> &str {
        "Writes content to a file, creating parent directories if needed.\n\n\
         Usage:\n\
         - This tool overwrites the existing file completely (not append).\n\
         - If the file already exists, you must use Read first to see its current content.\n\
         - Prefer Edit over Write for modifying existing files — Edit only sends the diff.\n\
         - Use Write only for creating new files or complete rewrites."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the file to write"
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file"
                }
            },
            "required": ["file_path", "content"]
        })
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        false
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let Some(file_path) = input["file_path"].as_str() else {
            return ToolResult {
                content: "Missing required parameter: file_path".to_string(),
                is_error: true,
            };
        };
        let Some(content) = input["content"].as_str() else {
            return ToolResult {
                content: "Missing required parameter: content".to_string(),
                is_error: true,
            };
        };

        let path = Path::new(file_path);
        let existed = path.exists();

        // Create parent directories
        if let Some(parent) = path.parent().filter(|p| !p.exists()) {
            match std::fs::create_dir_all(parent) {
                Ok(()) => {}
                Err(e) => {
                    return ToolResult {
                        content: format!("Failed to create directories: {}", e),
                        is_error: true,
                    };
                }
            }
        }

        if !self.confinement.allows_write(path) {
            return ToolResult {
                content: self.confinement.refusal(path),
                is_error: true,
            };
        }

        // Before anything is changed, and refusing if it cannot be done. A
        // checkpoint that silently did not happen is worse than none at all,
        // because the user believes there is a way back.
        if let Some(store) = &self.checkpoints
            && let Err(error) = store.lock().expect("checkpoint store").take_current(path)
        {
            return ToolResult {
                content: format!("{error}; nothing was written"),
                is_error: true,
            };
        }

        // Write atomically: write to temp file, then rename
        let tmp_path = format!("{}.tmp.{}", file_path, std::process::id());
        if let Err(e) = std::fs::write(&tmp_path, content) {
            return ToolResult {
                content: format!("Failed to write file: {}", e),
                is_error: true,
            };
        }

        if let Err(e) = std::fs::rename(&tmp_path, file_path) {
            // Fallback: direct write if rename fails (cross-device)
            let _ = std::fs::remove_file(&tmp_path);
            if let Err(e) = std::fs::write(file_path, content) {
                return ToolResult {
                    content: format!("Failed to write file: {}", e),
                    is_error: true,
                };
            }
            if let Some(cache_arc) = &self.file_cache {
                update_cache_after_write(cache_arc, path, content);
            }

            return ToolResult {
                content: format!("Updated {} (rename failed: {}, used direct write)", file_path, e),
                is_error: false,
            };
        }

        if let Some(cache_arc) = &self.file_cache {
            update_cache_after_write(cache_arc, path, content);
        }

        let line_count = content.lines().count();
        let action = if existed { "Updated" } else { "Created" };
        ToolResult {
            content: format!("{} {} ({} lines)", action, file_path, line_count),
            is_error: false,
        }
    }

    fn max_result_size(&self) -> usize {
        10_000
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Edit
    }

    fn describe(&self, input: &Value) -> String {
        let path = input.get("file_path").and_then(|v| v.as_str()).unwrap_or("unknown");
        format!("Write to {}", path)
    }
}

#[cfg(test)]
#[path = "write_test.rs"]
mod write_test;
