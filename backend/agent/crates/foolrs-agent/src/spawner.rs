use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;

use foolrs_config::config::Config;
use foolrs_providers::LlmProvider;
use foolrs_tools::edit::EditTool;
use foolrs_tools::exec_command::ExecCommandTool;
use foolrs_tools::glob::GlobTool;
use foolrs_tools::grep::GrepTool;
use foolrs_tools::read::ReadTool;
use foolrs_tools::registry::ToolRegistry;
use foolrs_tools::write::WriteTool;
use foolrs_types::message::TokenUsage;

use crate::engine::AgentEngine;
use crate::output::OutputSink;
use crate::output::labelled_sink::LabelledSink;
use crate::output::null_sink::NullSink;
use crate::tool_policy::ToolPolicy;

// Re-export from foolrs-types — single source of truth
pub use foolrs_types::spawner::{ForkOverrides, Spawner, SubAgentConfig, SubAgentResult};

/// Spawns independent child agents that share the parent's LLM provider.
///
/// A child's result comes back to the parent, which returns it as a single
/// `tool_result`; that has not changed. What has changed is that the work
/// leading up to it is no longer invisible. Children used to run against a
/// [`NullSink`], so a request split into five left the user watching a spinner
/// for a minute with no way to tell a slow search from a stuck one.
///
/// Each child now reports through a [`LabelledSink`] onto the parent's own
/// output, so its tools and failures appear under its name. Its prose does not:
/// see that type for why.
///
/// Children inherit the parent's runtime tool policy. Fork overrides can
/// further narrow that policy, but cannot restore tools denied to the parent.
pub struct AgentSpawner {
    provider: Arc<dyn LlmProvider>,
    base_config: Config,
    cwd: PathBuf,
    runtime_env: Vec<(String, String)>,
    tool_policy: ToolPolicy,
    /// Where children are watched. Silent unless a caller supplies one, so a
    /// spawner built for a test does not need a screen to run against.
    output: Arc<dyn OutputSink>,
}

impl AgentSpawner {
    pub fn new(provider: Arc<dyn LlmProvider>, config: Config, cwd: PathBuf, tool_policy: ToolPolicy) -> Self {
        Self::new_with_env(provider, config, cwd, Vec::new(), tool_policy)
    }

    pub fn new_with_env(
        provider: Arc<dyn LlmProvider>,
        config: Config,
        cwd: PathBuf,
        runtime_env: Vec<(String, String)>,
        tool_policy: ToolPolicy,
    ) -> Self {
        Self {
            provider,
            base_config: config,
            cwd,
            runtime_env,
            tool_policy,
            output: Arc::new(NullSink),
        }
    }

    /// Streams the children's work onto the sink the parent is already using.
    #[must_use]
    pub fn watched_by(mut self, output: Arc<dyn OutputSink>) -> Self {
        self.output = output;
        self
    }

    /// Spawn a single sub-agent and wait for result.
    pub async fn spawn_one(&self, sub_config: SubAgentConfig) -> SubAgentResult {
        let mut config = self.base_config.clone();
        config.max_turns = Some(sub_config.max_turns);
        config.max_tokens = Some(sub_config.max_tokens);
        if let Some(sp) = sub_config.system_prompt.clone() {
            config.system_prompt = Some(sp);
        }
        config.session.enabled = false;
        config.tools.auto_approve = true;

        tracing::info!(target: "foolrs_agent", cwd = %self.cwd.display(), "sub-agent spawned with workspace cwd");

        let child_policy = effective_child_tool_policy(&self.tool_policy, &[]);
        let tools = build_tool_registry(&child_policy, &self.cwd, &self.runtime_env);
        let output = self.watch(&sub_config.name);
        let mut engine = AgentEngine::new_with_provider_and_env(
            self.provider.clone(),
            config,
            tools,
            output,
            self.cwd.clone(),
            self.runtime_env.clone(),
        );
        engine.set_tool_policy(child_policy);

        match engine.run(&sub_config.prompt, "").await {
            Ok(result) => {
                self.settled(&sub_config.name, result.turns);
                SubAgentResult {
                    name: sub_config.name,
                    text: result.text,
                    usage: result.usage,
                    turns: result.turns,
                    is_error: false,
                }
            }
            Err(e) => {
                self.output.emit_error(&format!("[{}] {e}", sub_config.name));
                SubAgentResult {
                    name: sub_config.name,
                    text: format!("Sub-agent error: {}", e),
                    usage: TokenUsage::default(),
                    turns: 0,
                    is_error: true,
                }
            }
        }
    }

    /// Spawn multiple sub-agents in parallel.
    pub async fn spawn_parallel(&self, sub_configs: Vec<SubAgentConfig>) -> Vec<SubAgentResult> {
        let futures: Vec<_> = sub_configs
            .into_iter()
            .map(|config| {
                let spawner = self.clone_for_spawn();
                tokio::spawn(async move { spawner.spawn_one(config).await })
            })
            .collect();

        let mut results = Vec::new();
        for future in futures {
            match future.await {
                Ok(result) => results.push(result),
                Err(e) => results.push(SubAgentResult {
                    name: "unknown".to_string(),
                    text: format!("Task join error: {}", e),
                    usage: TokenUsage::default(),
                    turns: 0,
                    is_error: true,
                }),
            }
        }
        results
    }

    /// Announces a child and hands it somewhere to report.
    ///
    /// The announcement is here rather than in the sink because it belongs to
    /// starting a child, not to anything the child says — a child that dies
    /// before its first tool call has still been seen to start.
    fn watch(&self, name: &str) -> Arc<dyn OutputSink> {
        self.output.emit_info(&format!("[{name}] started"));
        Arc::new(LabelledSink::new(Arc::clone(&self.output), name))
    }

    /// Says a child is done, and in how many turns.
    ///
    /// The turn count is the honest measure of how much a child did; a person
    /// watching five of them wants to know which one is doing the work.
    fn settled(&self, name: &str, turns: usize) {
        self.output.emit_info(&format!("[{name}] finished after {turns} turns"));
    }

    fn clone_for_spawn(&self) -> Self {
        Self {
            provider: self.provider.clone(),
            base_config: self.base_config.clone(),
            cwd: self.cwd.clone(),
            runtime_env: self.runtime_env.clone(),
            tool_policy: self.tool_policy.clone(),
            output: Arc::clone(&self.output),
        }
    }
}

#[async_trait]
impl Spawner for AgentSpawner {
    async fn spawn_fork(&self, sub_config: SubAgentConfig, overrides: ForkOverrides) -> SubAgentResult {
        let mut config = self.base_config.clone();
        config.max_turns = Some(sub_config.max_turns);
        config.max_tokens = Some(sub_config.max_tokens);
        if let Some(sp) = sub_config.system_prompt.clone() {
            config.system_prompt = Some(sp);
        }
        config.session.enabled = false;
        config.tools.auto_approve = true;
        if let Some(model) = overrides.model.clone() {
            config.model = model;
        }

        let child_policy = effective_child_tool_policy(&self.tool_policy, &overrides.allowed_tools);
        let tools = build_tool_registry(&child_policy, &self.cwd, &self.runtime_env);
        let output = self.watch(&sub_config.name);
        let mut engine = AgentEngine::new_with_provider_and_env(
            self.provider.clone(),
            config,
            tools,
            output,
            self.cwd.clone(),
            self.runtime_env.clone(),
        );
        engine.set_initial_reasoning_effort(overrides.effort.clone());
        engine.set_tool_policy(child_policy);

        match engine.run(&sub_config.prompt, "").await {
            Ok(result) => {
                self.settled(&sub_config.name, result.turns);
                SubAgentResult {
                    name: sub_config.name,
                    text: result.text,
                    usage: result.usage,
                    turns: result.turns,
                    is_error: false,
                }
            }
            Err(e) => {
                self.output.emit_error(&format!("[{}] {e}", sub_config.name));
                SubAgentResult {
                    name: sub_config.name,
                    text: format!("Sub-agent error: {}", e),
                    usage: TokenUsage::default(),
                    turns: 0,
                    is_error: true,
                }
            }
        }
    }
}

fn effective_child_tool_policy(parent: &ToolPolicy, allowed_tools: &[String]) -> ToolPolicy {
    if allowed_tools.is_empty() {
        return parent.clone();
    }

    ToolPolicy::allow_only(
        allowed_tools
            .iter()
            .filter(|tool_name| parent.allows(tool_name))
            .cloned(),
    )
}

fn build_tool_registry(policy: &ToolPolicy, cwd: &Path, runtime_env: &[(String, String)]) -> ToolRegistry {
    let all_tools: Vec<(&str, Box<dyn foolrs_tools::Tool>)> = vec![
        ("Read", Box::new(ReadTool::new(None))),
        ("Write", Box::new(WriteTool::new(None))),
        ("Edit", Box::new(EditTool::new(None))),
        (
            "ExecCommand",
            Box::new(ExecCommandTool::new_with_env(cwd.to_path_buf(), runtime_env.to_vec())),
        ),
        ("Grep", Box::new(GrepTool::new(cwd.to_path_buf()))),
        ("Glob", Box::new(GlobTool::new(cwd.to_path_buf()))),
    ];

    let mut registry = ToolRegistry::new();
    for (name, tool) in all_tools {
        if policy.allows(name) {
            registry.register(tool);
        }
    }
    registry
}

#[cfg(test)]
#[path = "spawner_test.rs"]
mod spawner_test;
