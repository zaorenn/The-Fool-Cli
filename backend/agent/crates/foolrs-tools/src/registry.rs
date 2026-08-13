use foolrs_types::tool::ToolDef;

use crate::Tool;

pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
    /// Whether a tool with a large schema may be advertised as a name-only stub.
    ///
    /// Deferring keeps the prompt small: the model is shown the name, and calls
    /// `ToolSearch` to load the parameters before it can use the tool. That is
    /// a good trade against a frontier model and a bad one against a small
    /// local one, which fumbles the extra step — observed calling `Spawn` with
    /// `{}`, being told to load the schema, and getting it wrong twice more.
    ///
    /// So it is a choice rather than a constant, made where the model is known.
    defer_schemas: bool,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Vec::new(),
            defer_schemas: true,
        }
    }

    /// Send every schema in full, however large.
    ///
    /// For a model that cannot be relied on to complete the two-step dance a
    /// deferred tool requires. Costs prompt tokens and buys tools that work on
    /// the first call.
    pub fn send_every_schema(&mut self) {
        self.defer_schemas = false;
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    /// Find a tool by name
    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }

    /// Get all registered tool names
    pub fn tool_names(&self) -> Vec<String> {
        self.tools.iter().map(|t| t.name().to_string()).collect()
    }

    /// Generate API tool definitions for all registered tools
    pub fn to_tool_defs(&self) -> Vec<ToolDef> {
        self.tools
            .iter()
            .map(|t| ToolDef {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
                deferred: self.defer_schemas && t.is_deferred(),
            })
            .collect()
    }

    /// Generate API tool definitions for tools matching a predicate.
    ///
    /// Used by plan mode to restrict the tool set sent to the LLM.
    pub fn to_tool_defs_filtered<F>(&self, filter: F) -> Vec<ToolDef>
    where
        F: Fn(&dyn Tool) -> bool,
    {
        self.tools
            .iter()
            .filter(|t| filter(t.as_ref()))
            .map(|t| ToolDef {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.input_schema(),
                deferred: self.defer_schemas && t.is_deferred(),
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "registry_test.rs"]
mod registry_test;
