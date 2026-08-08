use super::*;
use serde_json::json;

fn descriptor(name: &str) -> ToolDescriptor {
    ToolDescriptor {
        name: name.into(),
        description: "for the test".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }
}

#[test]
fn an_empty_catalogue_advertises_nothing() {
    assert!(Catalogue::new().tools().is_empty());
}

#[test]
fn registering_replaces_rather_than_appends() {
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_theme"), descriptor("app_settings")]);
    catalogue.replace(vec![descriptor("app_theme")]);

    let names: Vec<String> = catalogue.tools().into_iter().map(|tool| tool.name).collect();
    assert_eq!(names, vec!["app_theme".to_string()]);
}

#[test]
fn a_tool_that_was_never_registered_is_not_offered() {
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_theme")]);

    assert!(catalogue.offers("app_theme"));
    assert!(!catalogue.offers("app_delete_everything"));
}
