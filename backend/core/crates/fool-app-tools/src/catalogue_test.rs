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

#[test]
fn nothing_split_means_everything_is_core() {
    // A catalogue that quietly advertised nothing would be an application that
    // can suddenly do nothing.
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_theme"), descriptor("app_look_at_screen")]);

    assert_eq!(catalogue.tools_in(CataloguePart::Core).len(), 2);
    assert!(catalogue.tools_in(CataloguePart::Rest).is_empty());
}

#[test]
fn the_split_puts_each_tool_on_exactly_one_side() {
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_look_at_screen"), descriptor("app_theme")]);
    catalogue.set_core(vec!["app_look_at_screen".to_string()]);

    let core: Vec<String> = catalogue
        .tools_in(CataloguePart::Core)
        .into_iter()
        .map(|tool| tool.name)
        .collect();
    let rest: Vec<String> = catalogue
        .tools_in(CataloguePart::Rest)
        .into_iter()
        .map(|tool| tool.name)
        .collect();

    assert_eq!(core, vec!["app_look_at_screen".to_string()]);
    assert_eq!(rest, vec!["app_theme".to_string()]);
}

#[test]
fn a_core_name_for_a_tool_that_does_not_exist_changes_nothing() {
    let catalogue = Catalogue::new();
    catalogue.replace(vec![descriptor("app_theme")]);
    catalogue.set_core(vec!["app_gone".to_string()]);

    assert!(catalogue.tools_in(CataloguePart::Core).is_empty());
    assert_eq!(catalogue.tools_in(CataloguePart::Rest).len(), 1);
}
