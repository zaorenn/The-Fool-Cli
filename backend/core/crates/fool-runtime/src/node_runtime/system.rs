use std::path::{Path, PathBuf};

use super::types::{NodeRuntimeError, NodeTool, ResolvedCommand, ResolvedNodeRuntime};

pub fn derive_runtime_root(node: &Path, windows: bool) -> Option<PathBuf> {
    if windows {
        if node.file_name()?.to_str()? == "node.exe" {
            return node.parent().map(Path::to_path_buf);
        }
        return None;
    }

    let bin = node.parent()?;
    let root = bin.parent()?;
    (bin.file_name()?.to_str()? == "bin" && node.file_name()?.to_str()? == "node").then(|| root.to_path_buf())
}

pub fn validate_same_root(node: &Path, npm: &Path, npx: &Path) -> Result<(), NodeRuntimeError> {
    let canonical_node = std::fs::canonicalize(node).map_err(NodeRuntimeError::io_system)?;
    let canonical_npm = std::fs::canonicalize(npm).map_err(NodeRuntimeError::io_system)?;
    let canonical_npx = std::fs::canonicalize(npx).map_err(NodeRuntimeError::io_system)?;

    let node_root = derive_runtime_root(&canonical_node, cfg!(windows))
        .ok_or_else(|| NodeRuntimeError::system_invalid("cannot derive runtime root from node path"))?;

    if !canonical_npm.starts_with(&node_root) || !canonical_npx.starts_with(&node_root) {
        return Err(NodeRuntimeError::system_invalid(
            "npm/npx do not belong to the same runtime root as node",
        ));
    }

    Ok(())
}

pub fn tool_command(tool: NodeTool, runtime: &ResolvedNodeRuntime) -> ResolvedCommand {
    match tool {
        NodeTool::Node => ResolvedCommand::plain(runtime.node_path.clone()),
        NodeTool::Npm => runtime.npm_command(),
        NodeTool::Npx => runtime.npx_command(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_root_from_unix_bin_node() {
        let node = PathBuf::from("/opt/node-v24/bin/node");
        let root = derive_runtime_root(&node, false).expect("root");
        assert_eq!(root, PathBuf::from("/opt/node-v24"));
    }

    /// Where each tool sits differs per platform, and `validate_same_root`
    /// reads the real one through `cfg!(windows)`.
    ///
    /// The fixture used to be the Unix layout unconditionally, so on Windows
    /// `derive_runtime_root` saw a file called `node` where it wanted
    /// `node.exe`, gave up before the comparison, and this asserted against
    /// the wrong error. It was not testing mixed roots there at all.
    fn layout_for_host(root: &std::path::Path, tool: &str) -> PathBuf {
        if cfg!(windows) {
            match tool {
                "node" => root.join("node.exe"),
                other => root.join(format!("{other}.cmd")),
            }
        } else {
            root.join("bin").join(tool)
        }
    }

    #[test]
    fn mixed_roots_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let node_root = root.path().join("node-a");
        let npm_root = root.path().join("node-b");

        for (base, tools) in [
            (&node_root, ["node", "npx"].as_slice()),
            (&npm_root, ["npm"].as_slice()),
        ] {
            for tool in tools {
                let path = layout_for_host(base, tool);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(&path, b"").unwrap();
            }
        }

        let err = validate_same_root(
            &layout_for_host(&node_root, "node"),
            &layout_for_host(&npm_root, "npm"),
            &layout_for_host(&node_root, "npx"),
        )
        .unwrap_err();

        assert!(err.to_string().contains("same runtime root"), "{err}");
    }
}
