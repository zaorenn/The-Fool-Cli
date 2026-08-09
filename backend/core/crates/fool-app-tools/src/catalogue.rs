use std::sync::RwLock;

use fool_mcp_server::ToolDescriptor;

/// Which half of the catalogue is being asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CataloguePart {
    /// Always in the prompt.
    Core,
    /// Advertised by a deferred server: name and stub until asked for.
    Rest,
}

/// What the application says it can do.
///
/// Registered by the renderer at startup rather than written here, because the
/// schemas live in TypeScript beside the handlers that implement them. Copying
/// them into Rust would create a second definition of the same tool, and the
/// two would disagree on the first edit.
pub struct Catalogue {
    tools: RwLock<Vec<ToolDescriptor>>,
    /// The few a spoken conversation reaches for on almost every turn.
    ///
    /// Everything else is advertised through a *deferred* server, so its schema
    /// is not in the prompt until the model asks for it. Measured on this
    /// machine: the eighteen application tools are 19 KB of schema against a
    /// persona of 18 KB — more than half of what a small model reads before it
    /// can answer "what is the weather" is the description of tools it will not
    /// call.
    core: RwLock<Vec<String>>,
}

impl Catalogue {
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(Vec::new()),
            core: RwLock::new(Vec::new()),
        }
    }

    /// Names the handful that stay in the prompt.
    pub fn set_core(&self, names: Vec<String>) {
        *self.core.write().expect("catalogue lock") = names;
    }

    /// The tools in one half of the split.
    ///
    /// An empty core list means nothing has been split, and everything is
    /// treated as core: a catalogue that quietly advertised nothing would be an
    /// application that can suddenly do nothing.
    pub fn tools_in(&self, part: CataloguePart) -> Vec<ToolDescriptor> {
        let core = self.core.read().expect("catalogue lock");
        let tools = self.tools.read().expect("catalogue lock");
        if core.is_empty() {
            return match part {
                CataloguePart::Core => tools.clone(),
                CataloguePart::Rest => Vec::new(),
            };
        }
        tools
            .iter()
            .filter(|tool| core.contains(&tool.name) == matches!(part, CataloguePart::Core))
            .cloned()
            .collect()
    }

    /// Replaces the whole catalogue.
    ///
    /// Replace rather than merge: a renderer that reloads registers again, and
    /// appending would advertise every tool twice.
    pub fn replace(&self, tools: Vec<ToolDescriptor>) {
        *self.tools.write().expect("catalogue lock") = tools;
    }

    pub fn tools(&self) -> Vec<ToolDescriptor> {
        self.tools.read().expect("catalogue lock").clone()
    }

    /// Whether a name is one the application actually offers.
    ///
    /// The wire cannot be trusted to only ask for advertised tools, and a call
    /// that reaches the renderer for a tool nobody registered would be answered
    /// by whatever the handler's fall-through happens to do.
    pub fn offers(&self, name: &str) -> bool {
        self.tools
            .read()
            .expect("catalogue lock")
            .iter()
            .any(|tool| tool.name == name)
    }
}

impl Default for Catalogue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "catalogue_test.rs"]
mod catalogue_test;
