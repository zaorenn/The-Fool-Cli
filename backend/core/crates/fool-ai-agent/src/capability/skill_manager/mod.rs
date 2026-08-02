use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use fool_db::ISkillRepository;
use regex::Regex;
use tokio::sync::RwLock;
use tracing::{debug, warn};

mod prompt_builder;
pub use prompt_builder::*;

static LOAD_SKILL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[LOAD_SKILL:\s*([^\]]+)\]").expect("valid regex"));

/// A discovered skill definition.
#[derive(Debug, Clone)]
pub struct SkillDefinition {
    /// Skill name (directory name or frontmatter `name`).
    pub name: String,
    /// One-line description from SKILL.md frontmatter.
    pub description: String,
    /// File system path to the SKILL.md file (absolute for custom/extension,
    /// or the materialized view path for builtin).
    pub location: PathBuf,
    /// Origin of this skill (builtin/custom/extension).
    pub source: fool_extension::SkillSource,
    /// Relative path inside the builtin skill corpus
    /// (e.g. `auto-inject/cron/SKILL.md`); `None` for non-builtin sources.
    pub relative_location: Option<String>,
    /// Lazily-loaded full content (body after frontmatter).
    pub body: Option<String>,
}

/// Lightweight skill reference for index listings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillIndex {
    pub name: String,
    pub description: String,
}

/// Whether a discovered skill belongs to an agent with this configuration.
///
/// Auto-inject builtins are on for everyone unless the agent names them in its
/// exclusions; everything else — opt-in builtins, custom, cron and extension
/// skills — is off until the agent asks for it. Shared by cache-filling
/// discovery and by directory resolution so a change here reaches both.
fn skill_applies(
    item: &fool_extension::SkillListItem,
    enabled_skills: Option<&[String]>,
    exclude_builtin_skills: Option<&[String]>,
) -> bool {
    let is_auto_inject = item
        .relative_location
        .as_deref()
        .is_some_and(|relative| relative.starts_with("auto-inject/"));
    let enabled = || enabled_skills.is_some_and(|names| names.iter().any(|name| name == &item.name));

    match item.source {
        fool_extension::SkillSource::Builtin if is_auto_inject => {
            !exclude_builtin_skills.is_some_and(|names| names.iter().any(|name| name == &item.name))
        }
        fool_extension::SkillSource::Builtin
        | fool_extension::SkillSource::Custom
        | fool_extension::SkillSource::Cron
        | fool_extension::SkillSource::Extension => enabled(),
    }
}

/// Manages skill discovery, indexing, and on-demand loading.
///
/// Skills are stored in directories containing a `SKILL.md` file.
/// The SKILL.md frontmatter provides `name` and `description`.
/// The body (content after frontmatter) is loaded on demand.
pub struct AcpSkillManager {
    /// Cached skill definitions keyed by skill name.
    cache: RwLock<HashMap<String, SkillDefinition>>,
    /// Whether discovery has been performed.
    discovered: RwLock<bool>,
    /// Resolved skill paths, shared across the app.
    /// Consumed by `discover_skills` / `get_skill` (Task 4 / 5 of the refactor).
    #[allow(dead_code)]
    paths: Arc<fool_extension::SkillPaths>,
    /// User skill state source. When absent, discovery falls back to legacy
    /// path-based listing for unit tests that do not stand up a database.
    skill_repo: Option<Arc<dyn ISkillRepository>>,
}

impl AcpSkillManager {
    pub fn new(paths: Arc<fool_extension::SkillPaths>) -> Arc<Self> {
        Arc::new(Self {
            cache: RwLock::new(HashMap::new()),
            discovered: RwLock::new(false),
            paths,
            skill_repo: None,
        })
    }

    pub fn new_with_repo(paths: Arc<fool_extension::SkillPaths>, skill_repo: Arc<dyn ISkillRepository>) -> Arc<Self> {
        Arc::new(Self {
            cache: RwLock::new(HashMap::new()),
            discovered: RwLock::new(false),
            paths,
            skill_repo: Some(skill_repo),
        })
    }

    /// Discover skills via `fool_extension::list_available_skills`.
    ///
    /// Filtering rules:
    /// - Auto-inject builtin skills (under `auto-inject/` in the corpus) are
    ///   always included unless listed in `exclude_builtin_skills`.
    /// - Opt-in builtin skills (siblings of `auto-inject/`) and custom/cron/
    ///   extension skills are included only if `enabled_skills` contains their
    ///   name.
    ///
    /// Populates the cache; subsequent `get_skill(name)` calls read body lazily.
    pub async fn discover_skills(
        &self,
        enabled_skills: Option<&[String]>,
        exclude_builtin_skills: Option<&[String]>,
    ) -> Vec<SkillIndex> {
        self.discover_skills_for_user("system_default_user", enabled_skills, exclude_builtin_skills)
            .await
    }

    pub async fn discover_skills_for_user(
        &self,
        user_id: &str,
        enabled_skills: Option<&[String]>,
        exclude_builtin_skills: Option<&[String]>,
    ) -> Vec<SkillIndex> {
        let items = match self.list_available_skills_for_user(user_id).await {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Failed to list skills via extension service");
                Vec::new()
            }
        };

        let mut cache = self.cache.write().await;
        cache.clear();

        for item in items {
            if !skill_applies(&item, enabled_skills, exclude_builtin_skills) {
                continue;
            }

            cache.insert(
                item.name.clone(),
                SkillDefinition {
                    name: item.name.clone(),
                    description: item.description.clone(),
                    location: std::path::PathBuf::from(&item.location),
                    source: item.source,
                    relative_location: item.relative_location.clone(),
                    body: None,
                },
            );
        }

        let mut discovered = self.discovered.write().await;
        *discovered = true;

        let index: Vec<SkillIndex> = cache
            .values()
            .map(|d| SkillIndex {
                name: d.name.clone(),
                description: d.description.clone(),
            })
            .collect();

        debug!(count = index.len(), "Skills discovered");
        index
    }

    /// The directories of the skills this agent should load, one per skill.
    ///
    /// Same selection as [`Self::discover_skills_for_user`] — the rule lives in
    /// [`skill_applies`] so the two cannot drift — but it touches no cache. The
    /// manager is shared app-wide, and a per-conversation call that rewrote the
    /// cache would answer for whichever conversation asked last.
    ///
    /// Each path is the directory holding the skill's `SKILL.md`, which is what
    /// an embedded agent needs to load it in place rather than have it copied
    /// somewhere first.
    pub async fn resolve_skill_dirs_for_user(
        &self,
        user_id: &str,
        enabled_skills: Option<&[String]>,
        exclude_builtin_skills: Option<&[String]>,
    ) -> Vec<PathBuf> {
        let items = match self.list_available_skills_for_user(user_id).await {
            Ok(items) => items,
            Err(error) => {
                warn!(error = %error, "resolve_skill_dirs: listing skills failed");
                return Vec::new();
            }
        };

        let mut dirs: Vec<PathBuf> = items
            .into_iter()
            .filter(|item| skill_applies(item, enabled_skills, exclude_builtin_skills))
            .filter_map(|item| PathBuf::from(&item.location).parent().map(Path::to_path_buf))
            .collect();
        dirs.sort();
        dirs.dedup();
        dirs
    }

    /// Populate the cache with only the named skills (no filtering by
    /// auto-inject/opt-in). Returns the resulting index. Used by the
    /// snapshot-driven first-message injector.
    pub async fn discover_by_names(&self, names: &[String]) -> Vec<SkillIndex> {
        self.discover_by_names_for_user("system_default_user", names).await
    }

    pub async fn discover_by_names_for_user(&self, user_id: &str, names: &[String]) -> Vec<SkillIndex> {
        // Always reset state so repeated calls produce a deterministic cache.
        if names.is_empty() {
            let mut cache = self.cache.write().await;
            cache.clear();
            let mut discovered = self.discovered.write().await;
            *discovered = true;
            return Vec::new();
        }
        let items = match self.list_available_skills_for_user(user_id).await {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "discover_by_names: list_available_skills failed");
                Vec::new()
            }
        };

        let wanted: std::collections::HashSet<&String> = names.iter().collect();
        let mut cache = self.cache.write().await;
        cache.clear();
        for item in items {
            if !wanted.contains(&item.name) {
                continue;
            }
            cache.insert(
                item.name.clone(),
                SkillDefinition {
                    name: item.name.clone(),
                    description: item.description.clone(),
                    location: std::path::PathBuf::from(&item.location),
                    source: item.source,
                    relative_location: item.relative_location.clone(),
                    body: None,
                },
            );
        }
        let mut discovered = self.discovered.write().await;
        *discovered = true;
        cache
            .values()
            .map(|d| SkillIndex {
                name: d.name.clone(),
                description: d.description.clone(),
            })
            .collect()
    }

    async fn list_available_skills_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<fool_extension::SkillListItem>, fool_extension::ExtensionError> {
        if let Some(repo) = &self.skill_repo {
            fool_extension::list_available_skills_with_repo_for_user(&self.paths, repo.as_ref(), user_id).await
        } else {
            // No skill repo → fall back to unscoped on-disk discovery. This
            // path is NOT per-user isolated (it scans every user's dir) and is
            // only meant for dev / no-DB test setups; production always injects
            // the repo. Warn so a production hit is diagnosable.
            tracing::warn!(
                user_id,
                "skill_repo not configured; using unscoped on-disk skill discovery fallback (must not happen in production)"
            );
            fool_extension::list_available_skills(&self.paths).await
        }
    }

    /// Return the current skill index without re-scanning.
    pub async fn get_skills_index(&self) -> Vec<SkillIndex> {
        let cache = self.cache.read().await;
        cache
            .values()
            .map(|d| SkillIndex {
                name: d.name.clone(),
                description: d.description.clone(),
            })
            .collect()
    }

    /// Load a skill's full content by name.
    ///
    /// Returns `None` if the skill is unknown. On first access the body is
    /// read via the appropriate channel based on `source`:
    /// - `Builtin` → `fool_extension::read_builtin_skill(&paths, relative)`
    /// - `Custom` / `Cron` / `Extension` → direct `tokio::fs::read_to_string(location/SKILL.md)`
    pub async fn get_skill(&self, name: &str) -> Option<SkillDefinition> {
        // Fast path: check if body is already cached
        {
            let cache = self.cache.read().await;
            match cache.get(name) {
                Some(def) if def.body.is_some() => return Some(def.clone()),
                None => return None,
                _ => {} // known, body absent — fall through
            }
        }

        // Slow path: read body per source and cache it
        let mut cache = self.cache.write().await;
        let def = cache.get_mut(name)?;
        if def.body.is_some() {
            return Some(def.clone());
        }

        let content = match def.source {
            fool_extension::SkillSource::Builtin => {
                if let Some(rel) = def.relative_location.as_deref() {
                    match fool_extension::read_builtin_skill(&self.paths, rel).await {
                        Ok(s) => s,
                        Err(e) => {
                            warn!(skill = name, error = %e, "Failed to read builtin skill");
                            String::new()
                        }
                    }
                } else {
                    warn!(skill = name, "Builtin skill missing relative_location");
                    String::new()
                }
            }
            fool_extension::SkillSource::Custom
            | fool_extension::SkillSource::Cron
            | fool_extension::SkillSource::Extension => {
                // `location` for scanned user skills is the directory; append SKILL.md.
                let skill_file = if def.location.is_dir() {
                    def.location.join("SKILL.md")
                } else {
                    def.location.clone()
                };
                match tokio::fs::read_to_string(&skill_file).await {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(skill = name, path = %skill_file.display(), error = %e, "Failed to read skill file");
                        String::new()
                    }
                }
            }
        };

        if content.is_empty() {
            return None;
        }

        def.body = Some(extract_body(&content));
        Some(def.clone())
    }

    /// Check whether discovery has been performed.
    pub async fn is_discovered(&self) -> bool {
        *self.discovered.read().await
    }
}

/// Detect `[LOAD_SKILL: ...]` requests in agent output content.
///
/// Returns a list of requested skill names.
pub fn detect_skill_load_request(content: &str) -> Vec<String> {
    LOAD_SKILL_RE
        .captures_iter(content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().trim().to_string()))
        .filter(|name| !name.is_empty())
        .collect()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Extract the body content after YAML frontmatter.
fn extract_body(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }

    let after_open = &trimmed[3..];
    if let Some(close_idx) = after_open.find("---") {
        let after_close = &after_open[close_idx + 3..];
        after_close.trim_start_matches('\n').to_string()
    } else {
        content.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn new_accepts_skill_paths() {
        let tmp = TempDir::new().unwrap();
        let paths = std::sync::Arc::new(fool_extension::resolve_skill_paths(tmp.path(), tmp.path()));
        let mgr = AcpSkillManager::new(paths.clone());
        assert!(!mgr.is_discovered().await);
    }

    #[test]
    fn skill_definition_has_source_and_relative_location() {
        let def = SkillDefinition {
            name: "x".into(),
            description: "d".into(),
            location: PathBuf::from("/tmp/x"),
            source: fool_extension::SkillSource::Builtin,
            relative_location: Some("auto-inject/x/SKILL.md".into()),
            body: None,
        };
        assert_eq!(def.source, fool_extension::SkillSource::Builtin);
        assert_eq!(def.relative_location.as_deref(), Some("auto-inject/x/SKILL.md"));
    }

    // Frontmatter parsing tests live in fool-extension (covers
    // parse_frontmatter_fields there); removed from here when
    // skill_manager stopped owning that helper.

    // -----------------------------------------------------------------------
    // Body extraction
    // -----------------------------------------------------------------------

    #[test]
    fn extract_body_with_frontmatter() {
        let content = "---\nname: test\ndescription: desc\n---\nBody content\nMore lines";
        let body = extract_body(content);
        assert_eq!(body, "Body content\nMore lines");
    }

    #[test]
    fn extract_body_no_frontmatter() {
        let content = "Just plain text";
        assert_eq!(extract_body(content), "Just plain text");
    }

    #[test]
    fn extract_body_no_closing_delimiter() {
        let content = "---\nname: test\nno closing";
        assert_eq!(extract_body(content), content);
    }

    // -----------------------------------------------------------------------
    // LOAD_SKILL detection
    // -----------------------------------------------------------------------

    #[test]
    fn detect_single_skill_request() {
        let content = "Let me use [LOAD_SKILL: security-review] for this.";
        let skills = detect_skill_load_request(content);
        assert_eq!(skills, vec!["security-review"]);
    }

    #[test]
    fn detect_multiple_skill_requests() {
        let content = "[LOAD_SKILL: a] some text [LOAD_SKILL: b]";
        let skills = detect_skill_load_request(content);
        assert_eq!(skills, vec!["a", "b"]);
    }

    #[test]
    fn detect_skill_request_with_spaces() {
        let content = "[LOAD_SKILL:   padded-name   ]";
        let skills = detect_skill_load_request(content);
        assert_eq!(skills, vec!["padded-name"]);
    }

    #[test]
    fn detect_no_skill_request() {
        let content = "Just regular text with no commands.";
        let skills = detect_skill_load_request(content);
        assert!(skills.is_empty());
    }

    #[test]
    fn detect_skill_request_empty_name_ignored() {
        let content = "[LOAD_SKILL:  ]";
        let skills = detect_skill_load_request(content);
        assert!(skills.is_empty());
    }

    // -----------------------------------------------------------------------
    // AcpSkillManager async tests
    //
    // Discovery-layout tests moved to `tests/skill_manager_integration.rs`
    // because they now need `fool_extension::BUILTIN_SKILLS_ENV_VAR` to
    // point the extension service at a tempdir corpus. Only the tests that
    // don't require a skill corpus remain here.
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn get_skill_unknown_returns_none() {
        let tmp = TempDir::new().unwrap();
        let mgr = AcpSkillManager::new(std::sync::Arc::new(fool_extension::resolve_skill_paths(
            tmp.path(),
            tmp.path(),
        )));
        assert!(mgr.get_skill("nonexistent").await.is_none());
    }

    // -----------------------------------------------------------------------
    // skill_applies: which skills belong to an agent
    //
    // The rule behind both `discover_skills_for_user` and
    // `resolve_skill_dirs_for_user`. Tested here rather than through either,
    // because the interesting part is the rule and it has to stay the same
    // rule for both.
    // -----------------------------------------------------------------------

    fn builtin_item(name: &str, relative: &str, location: &str) -> fool_extension::SkillListItem {
        fool_extension::SkillListItem {
            name: name.to_owned(),
            description: format!("{name} description"),
            location: location.to_owned(),
            relative_location: Some(relative.to_owned()),
            is_custom: false,
            source: fool_extension::SkillSource::Builtin,
        }
    }

    fn custom_item(name: &str, location: &str) -> fool_extension::SkillListItem {
        fool_extension::SkillListItem {
            name: name.to_owned(),
            description: format!("{name} description"),
            location: location.to_owned(),
            relative_location: None,
            is_custom: true,
            source: fool_extension::SkillSource::Custom,
        }
    }

    /// The shared set: on for every agent, whatever it enabled.
    #[test]
    fn auto_inject_builtins_apply_without_being_enabled() {
        let item = builtin_item("cron", "auto-inject/cron/SKILL.md", "/corpus/auto-inject/cron/SKILL.md");

        assert!(skill_applies(&item, None, None));
        assert!(skill_applies(&item, Some(&[]), None));
    }

    #[test]
    fn an_agent_can_exclude_an_auto_inject_builtin() {
        let item = builtin_item("cron", "auto-inject/cron/SKILL.md", "/corpus/auto-inject/cron/SKILL.md");

        assert!(!skill_applies(&item, None, Some(&["cron".to_owned()])));
    }

    #[test]
    fn opt_in_builtins_apply_only_when_enabled() {
        let item = builtin_item(
            "officecli-docx",
            "officecli-docx/SKILL.md",
            "/corpus/officecli-docx/SKILL.md",
        );

        assert!(!skill_applies(&item, None, None));
        assert!(!skill_applies(&item, Some(&["something-else".to_owned()]), None));
        assert!(skill_applies(&item, Some(&["officecli-docx".to_owned()]), None));
    }

    /// Exclusions name auto-inject skills; an enabled opt-in skill is not
    /// silently dropped by an unrelated exclusion list.
    #[test]
    fn excluding_a_builtin_does_not_disable_an_enabled_opt_in() {
        let item = builtin_item(
            "officecli-docx",
            "officecli-docx/SKILL.md",
            "/corpus/officecli-docx/SKILL.md",
        );

        assert!(skill_applies(
            &item,
            Some(&["officecli-docx".to_owned()]),
            Some(&["cron".to_owned()])
        ));
    }

    #[test]
    fn custom_skills_apply_only_when_enabled() {
        let item = custom_item("my-skill", "/home/user/skills/my-skill/SKILL.md");

        assert!(!skill_applies(&item, None, None));
        assert!(skill_applies(&item, Some(&["my-skill".to_owned()]), None));
    }
}
