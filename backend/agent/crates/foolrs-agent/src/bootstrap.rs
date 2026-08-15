use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use anyhow::Result;
use foolrs_config::config::{Config, McpServerConfig};
use foolrs_config::shell::{ResolvedShell, resolve_shell_config};
use foolrs_mcp::manager::McpManager;
use foolrs_mcp::tool_proxy::register_mcp_tools;
use foolrs_memory::paths::{ENTRYPOINT_NAME, auto_memory_dir};
use foolrs_providers::{LlmProvider, create_provider};
use foolrs_skills::loader::load_all_skills;
use foolrs_skills::permissions::SkillPermissionChecker;
use foolrs_skills::types::SkillMetadata;
use foolrs_tools::checkpoint::CheckpointStore;
use foolrs_tools::confinement::Confinement;
use foolrs_tools::download::DownloadTool;
use foolrs_tools::edit::EditTool;
use foolrs_tools::exec_command::ExecCommandTool;
use foolrs_tools::file_cache::FileStateCache;
use foolrs_tools::glob::GlobTool;
use foolrs_tools::grep::GrepTool;
use foolrs_tools::read::ReadTool;
use foolrs_tools::registry::ToolRegistry;
use foolrs_tools::tool_search::ToolSearchTool;
use foolrs_tools::view_image::ViewImageTool;
use foolrs_tools::web_fetch::WebFetchTool;
use foolrs_tools::web_search::WebSearchTool;
use foolrs_tools::write::WriteTool;
use tracing::info;

use crate::context::{SystemPromptCache, build_system_prompt_with_shell_and_tool_policy};
use crate::context_usage::PromptUsage;
use crate::engine::AgentEngine;
use crate::output::OutputSink;
use crate::plan::tools::{EnterPlanModeTool, ExitPlanModeTool};
use crate::session::Session;
use crate::skill_tool::SkillTool;
use crate::spawn_tool::SpawnTool;
use crate::spawner::AgentSpawner;
use crate::tool_policy::ToolPolicy;

/// Result of bootstrapping an agent engine with all features initialized.
pub struct BootstrapResult {
    // Fully initialized runtime.
    pub engine: AgentEngine,

    // Shared provider dependency created or reused during bootstrap.
    pub provider: Arc<dyn LlmProvider>,

    // MCP runtime state discovered during bootstrap.
    pub mcp_managers: Vec<Arc<McpManager>>,
    pub has_mcp: bool,
}

/// Builder for creating a fully-initialized `AgentEngine`.
///
/// Encapsulates the complete initialization pipeline so all consumers
/// (CLI, backend, sub-agents) get consistent behavior:
///
/// - System prompt always includes model identity, working directory, date
/// - Tool usage guidance is always injected
/// - AGENTS.md is loaded from the workspace hierarchy
/// - Skills, MCP, plan mode, spawn are enabled based on `Config` fields
pub struct AgentBootstrap {
    // Bootstrap configuration.
    config: Config,
    workspace: PathBuf,
    extra_skill_dirs: Vec<PathBuf>,
    skill_dirs: Vec<PathBuf>,

    // Output integration.
    output: Arc<dyn OutputSink>,

    // Optional externally supplied runtime state.
    provider: Option<Arc<dyn LlmProvider>>,
    resume_session: Option<Session>,
    runtime_env: Vec<(String, String)>,
    tool_policy: ToolPolicy,
    /// Where this conversation may write, when it has been confined.
    ///
    /// A boundary against a mistake rather than an attacker — `confinement`
    /// says so at length, and nothing above it should say more.
    confinement: Confinement,
    /// Where a file's previous contents are kept so a turn can be undone.
    ///
    /// `None` leaves `Write` and `Edit` as they were. An agent that refused to
    /// write because nobody wired a checkpoint would be worse than one that
    /// cannot be undone, so this is added rather than required.
    checkpoints: Option<Arc<Mutex<CheckpointStore>>>,
}

struct BootstrapEnvironment {
    // Workspace context.
    workspace: PathBuf,

    // Prompt context.
    resolved_shell: ResolvedShell,
    memory_dir: Option<PathBuf>,
}

#[derive(Default)]
struct McpBootstrap {
    // Active manager used for MCP-backed skills.
    manager: Option<Arc<McpManager>>,

    // Managers retained by the caller for lifecycle ownership.
    managers: Vec<Arc<McpManager>>,
}

impl McpBootstrap {
    fn has_mcp(&self) -> bool {
        self.manager.is_some()
    }
}

impl AgentBootstrap {
    pub fn new(config: Config, workspace: impl Into<String>, output: Arc<dyn OutputSink>) -> Self {
        Self {
            config,
            workspace: PathBuf::from(workspace.into()),
            extra_skill_dirs: Vec::new(),
            skill_dirs: Vec::new(),
            output,
            provider: None,
            resume_session: None,
            runtime_env: Vec::new(),
            tool_policy: ToolPolicy::default(),
            checkpoints: None,
            confinement: Confinement::None,
        }
    }

    /// Refuse writes outside one directory, for this conversation.
    pub fn confined_to(mut self, confinement: Confinement) -> Self {
        self.confinement = confinement;
        self
    }

    /// Keep a copy of every file a turn changes, so the turn can be undone.
    pub fn checkpoints(mut self, checkpoints: Arc<Mutex<CheckpointStore>>) -> Self {
        self.checkpoints = Some(checkpoints);
        self
    }

    /// Use a pre-created provider instead of creating one from config.
    pub fn provider(mut self, provider: Arc<dyn LlmProvider>) -> Self {
        self.provider = Some(provider);
        self
    }

    /// Resume from a previously saved session.
    pub fn resume(mut self, session: Session) -> Self {
        self.resume_session = Some(session);
        self
    }

    /// Inject process environment for tools/hooks/MCP subprocesses owned by this engine.
    pub fn runtime_env(mut self, runtime_env: Vec<(String, String)>) -> Self {
        self.runtime_env = runtime_env;
        self
    }

    /// Restrict which registered tools can be advertised and executed.
    pub fn tool_policy(mut self, tool_policy: ToolPolicy) -> Self {
        self.tool_policy = tool_policy;
        self
    }

    /// Add extra project roots to scan for a `.foolrs/skills` subdirectory.
    pub fn extra_skill_dirs(mut self, dirs: Vec<PathBuf>) -> Self {
        self.extra_skill_dirs = dirs;
        self
    }

    /// Load these specific skills, one directory per skill.
    ///
    /// For a host that already knows exactly which skills this agent should
    /// have — The Fool resolves them from the assistant's configuration — and
    /// would otherwise have to copy them into a directory just so a scan could
    /// find them again. Each is named by its own directory, so where it happens
    /// to sit in a corpus does not leak into its name.
    pub fn skill_dirs(mut self, dirs: Vec<PathBuf>) -> Self {
        self.skill_dirs = dirs;
        self
    }

    /// Read-only access to the config (for session management before build).
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Build the fully-initialized engine.
    pub async fn build(mut self) -> Result<BootstrapResult> {
        let workspace = self.resolve_workspace_path();
        let provider = self.resolve_provider();
        let environment = self.resolve_environment(workspace)?;
        let mut registry = self.build_builtin_registry(&environment.workspace);

        // A model served from this machine is sent every schema in full.
        //
        // Deferring is a trade: a smaller prompt, paid for with a round trip
        // through `ToolSearch` before a tool with a large schema can be called.
        // A frontier model makes that trade well. A local 9B does not — seen
        // calling `Spawn` with `{}`, being told to load the schema, and getting
        // it wrong twice more after that. A tool it cannot call is worth more
        // than the tokens the stub saved.
        if foolrs_config::context_window::is_local_endpoint(&self.config.base_url) {
            registry.send_every_schema();
        }

        let builtin_names = registry.tool_names();
        let mcp = self.connect_mcp(&mut registry, &builtin_names).await;

        let skills = self.load_skills(&environment.workspace, mcp.manager.as_deref()).await;
        let prompt_usage = self.configure_system_prompt(&environment, &skills);

        self.register_agent_tools(&mut registry, &provider, &environment.workspace, skills);
        let plan_active_flag = self.register_plan_tools(&mut registry);
        self.register_tool_search(&mut registry);

        let has_mcp = mcp.has_mcp();
        let mcp_managers = mcp.managers;
        let engine = self.into_engine(
            provider.clone(),
            registry,
            plan_active_flag,
            environment.workspace,
            prompt_usage,
        );

        Ok(BootstrapResult {
            engine,
            provider,
            mcp_managers,
            has_mcp,
        })
    }

    fn resolve_workspace_path(&self) -> PathBuf {
        info!(
            target: "foolrs_agent",
            workspace = %self.workspace.display(),
            "agent bootstrap: workspace cwd resolved",
        );

        self.workspace.clone()
    }

    fn resolve_environment(&self, workspace_path: PathBuf) -> Result<BootstrapEnvironment> {
        Ok(BootstrapEnvironment {
            resolved_shell: resolve_shell_config(&self.config.shell)?,
            memory_dir: auto_memory_dir(&workspace_path),
            workspace: workspace_path,
        })
    }

    fn resolve_provider(&mut self) -> Arc<dyn LlmProvider> {
        self.provider.take().unwrap_or_else(|| create_provider(&self.config))
    }

    fn build_builtin_registry(&self, workspace_path: &Path) -> ToolRegistry {
        let file_cache = self.build_file_cache();
        let mut registry = ToolRegistry::new();

        registry.register(Box::new(ReadTool::new(file_cache.clone())));

        let write = WriteTool::new(file_cache.clone()).confined_to(self.confinement.clone());
        let edit = EditTool::new(file_cache).confined_to(self.confinement.clone());
        match &self.checkpoints {
            Some(store) => {
                registry.register(Box::new(write.with_checkpoints(store.clone())));
                registry.register(Box::new(edit.with_checkpoints(store.clone())));
            }
            None => {
                registry.register(Box::new(write));
                registry.register(Box::new(edit));
            }
        }
        registry.register(Box::new(
            ExecCommandTool::new_with_env(workspace_path.to_path_buf(), self.runtime_env.clone())
                // Not to restrict what may be run — a shell in a confined
                // session still runs anything. It is so a delete aimed outside
                // the workspace is recognised as one, which is the only kind
                // there is no checkpoint for.
                .confined_to(self.confinement.clone()),
        ));
        registry.register(Box::new(GrepTool::new(workspace_path.to_path_buf())));
        registry.register(Box::new(GlobTool::new(workspace_path.to_path_buf())));
        registry.register(Box::new(ViewImageTool::new()));
        // Reading a public page. Nothing inside this machine or this network —
        // see `web_fetch::check_url`, which refuses before a request is made.
        registry.register(Box::new(WebFetchTool::new()));
        registry.register(Box::new(WebSearchTool::new()));
        // Saving what the other two found. Without it the agent could
        // locate a document and then had no way to obtain one: a PDF read
        // through WebFetch arrives as the result of a lossy UTF-8
        // conversion, which the model reports as the paper's contents.
        registry.register(Box::new(DownloadTool::new(workspace_path.to_path_buf())));

        registry
    }

    fn build_file_cache(&self) -> Option<Arc<RwLock<FileStateCache>>> {
        self.config
            .file_cache
            .enabled
            .then(|| Arc::new(RwLock::new(FileStateCache::new(&self.config.file_cache))))
    }

    async fn connect_mcp(&self, registry: &mut ToolRegistry, builtin_names: &[String]) -> McpBootstrap {
        let server_configs = self.mcp_servers_with_runtime_env();
        if server_configs.is_empty() {
            return McpBootstrap::default();
        }

        let manager = match McpManager::connect_all(&server_configs).await {
            Ok(manager) => Arc::new(manager),
            Err(err) => {
                self.output.emit_error(&format!("MCP initialization error: {err}"));
                return McpBootstrap::default();
            }
        };

        register_mcp_tools(registry, &manager, builtin_names, &server_configs);

        McpBootstrap {
            manager: Some(Arc::clone(&manager)),
            managers: vec![manager],
        }
    }

    fn mcp_servers_with_runtime_env(&self) -> HashMap<String, McpServerConfig> {
        let mut servers = self.config.mcp.servers.clone();
        if self.runtime_env.is_empty() {
            return servers;
        }

        for server in servers.values_mut() {
            let mut env: HashMap<String, String> = self.runtime_env.clone().into_iter().collect();
            if let Some(server_env) = server.env.take() {
                env.extend(server_env);
            }
            server.env = Some(env);
        }

        servers
    }

    async fn load_skills(&self, workspace: &Path, mcp_manager: Option<&McpManager>) -> Vec<SkillMetadata> {
        load_all_skills(workspace, &self.extra_skill_dirs, &self.skill_dirs, false, mcp_manager).await
    }

    fn configure_system_prompt(&mut self, environment: &BootstrapEnvironment, skills: &[SkillMetadata]) -> PromptUsage {
        let mut prompt_cache = SystemPromptCache::new();
        let workspace = self.workspace.to_string_lossy();
        let system_prompt = build_system_prompt_with_shell_and_tool_policy(
            &mut prompt_cache,
            self.config.system_prompt.as_deref(),
            &workspace,
            &self.config.model,
            &environment.resolved_shell,
            skills,
            None,
            environment.memory_dir.as_deref(),
            false,
            self.config.compact.toon,
            &self.tool_policy,
        );
        let memory_prompt = prompt_cache.sections.get("memory").map(String::as_str);
        let skills_prompt = prompt_cache.sections.get("skills").map(String::as_str);
        let memory_files = if memory_prompt.is_some() {
            environment
                .memory_dir
                .as_ref()
                .map(|directory| directory.join(ENTRYPOINT_NAME))
                .filter(|path| path.is_file())
                .map(|path| path.display().to_string())
                .into_iter()
                .collect()
        } else {
            Vec::new()
        };
        let visible_skills = skills
            .iter()
            .filter(|skill| self.tool_policy.allows("Skill") && !skill.disable_model_invocation)
            .map(|skill| skill.name.clone())
            .collect();
        let prompt_usage = PromptUsage::from_sections(
            &system_prompt,
            memory_prompt,
            skills_prompt,
            memory_files,
            visible_skills,
        );
        self.config.system_prompt = Some(system_prompt);
        prompt_usage
    }

    fn register_agent_tools(
        &self,
        registry: &mut ToolRegistry,
        provider: &Arc<dyn LlmProvider>,
        workspace: &Path,
        skills: Vec<SkillMetadata>,
    ) {
        let skill_checker = SkillPermissionChecker::new(
            self.config.tools.skills.deny.clone(),
            self.config.tools.skills.allow.clone(),
            self.config.tools.auto_approve,
        );
        registry.register(Box::new(SkillTool::new(
            Arc::new(skills),
            self.workspace.to_path_buf(),
            skill_checker,
        )));

        let spawner = AgentSpawner::new_with_env(
            Arc::clone(provider),
            self.config.clone(),
            workspace.to_path_buf(),
            self.runtime_env.clone(),
            self.tool_policy.clone(),
        )
        // Onto the same sink the parent writes to, which is the only one that
        // reaches a screen.
        .watched_by(Arc::clone(&self.output));
        registry.register(Box::new(SpawnTool::new(Arc::new(spawner))));
    }

    fn register_plan_tools(&self, registry: &mut ToolRegistry) -> Arc<AtomicBool> {
        let plan_active_flag = Arc::new(AtomicBool::new(false));

        if self.config.plan.enabled {
            registry.register(Box::new(EnterPlanModeTool::new(Arc::clone(&plan_active_flag))));
            registry.register(Box::new(ExitPlanModeTool::new(Arc::clone(&plan_active_flag))));
        }

        plan_active_flag
    }

    fn register_tool_search(&self, registry: &mut ToolRegistry) {
        let tool_defs_snapshot = registry.to_tool_defs_filtered(|tool| self.tool_policy.allows(tool.name()));
        registry.register(Box::new(ToolSearchTool::new(tool_defs_snapshot)));
    }

    fn into_engine(
        self,
        provider: Arc<dyn LlmProvider>,
        registry: ToolRegistry,
        plan_active_flag: Arc<AtomicBool>,
        workspace: PathBuf,
        prompt_usage: PromptUsage,
    ) -> AgentEngine {
        let runtime_env = self.runtime_env.clone();
        let mut engine = if let Some(session) = self.resume_session {
            AgentEngine::resume_with_provider_and_env(
                provider,
                self.config,
                registry,
                self.output,
                session,
                workspace,
                runtime_env,
            )
        } else {
            AgentEngine::new_with_provider_and_env(provider, self.config, registry, self.output, workspace, runtime_env)
        };
        engine.set_plan_active_flag(plan_active_flag);
        engine.set_tool_policy(self.tool_policy);
        engine.set_prompt_usage(prompt_usage);
        engine
    }
}

#[cfg(test)]
#[path = "bootstrap_test.rs"]
mod bootstrap_test;
