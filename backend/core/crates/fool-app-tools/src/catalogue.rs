use std::sync::RwLock;

use fool_mcp_server::ToolDescriptor;

/// What the application says it can do.
///
/// Registered by the renderer at startup rather than written here, because the
/// schemas live in TypeScript beside the handlers that implement them. Copying
/// them into Rust would create a second definition of the same tool, and the
/// two would disagree on the first edit.
pub struct Catalogue {
    tools: RwLock<Vec<ToolDescriptor>>,
}

impl Catalogue {
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(Vec::new()),
        }
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
