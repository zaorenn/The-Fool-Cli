use super::*;
use fool_api_types::AppToolResult;
use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Default)]
struct SpyBroadcaster {
    sent: Mutex<Vec<WebSocketMessage<Value>>>,
}

impl EventBroadcaster for SpyBroadcaster {
    fn broadcast(&self, event: WebSocketMessage<Value>) {
        self.sent.lock().expect("spy lock").push(event);
    }
}

impl SpyBroadcaster {
    fn first(&self) -> WebSocketMessage<Value> {
        self.sent
            .lock()
            .expect("spy lock")
            .first()
            .cloned()
            .expect("nothing sent")
    }

    fn count(&self) -> usize {
        self.sent.lock().expect("spy lock").len()
    }
}

fn descriptor(name: &str) -> ToolDescriptor {
    ToolDescriptor {
        name: name.into(),
        description: "for the test".into(),
        input_schema: json!({"type": "object", "properties": {}}),
    }
}

fn catalogue_offering(name: &str) -> Arc<Catalogue> {
    let catalogue = Arc::new(Catalogue::new());
    catalogue.replace(vec![descriptor(name)]);
    catalogue
}

async fn once_sent(spy: &SpyBroadcaster) {
    for _ in 0..1000 {
        if spy.count() > 0 {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("nothing was ever broadcast");
}

#[tokio::test]
async fn calling_a_tool_broadcasts_a_request_and_returns_the_answer() {
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let spy = Arc::new(SpyBroadcaster::default());
    let host = AppToolHost::new(
        catalogue_offering("app_look_at_screen"),
        pending.clone(),
        spy.clone(),
        "c1".into(),
    );

    let call = tokio::spawn(async move { host.call_tool("app_look_at_screen", json!({})).await });
    once_sent(&spy).await;

    let sent = spy.first();
    assert_eq!(sent.name, APP_TOOL_REQUEST_EVENT);
    assert_eq!(sent.data["conversation_id"], "c1");
    let call_id = sent.data["call_id"].as_str().expect("a call id").to_string();

    // The waiter may not have registered yet even though the broadcast landed.
    for _ in 0..1000 {
        if pending.outstanding() > 0 {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(pending.resolve(AppToolResult {
        call_id,
        ok: true,
        content: "a browser".into(),
    }));

    assert_eq!(call.await.unwrap(), Ok("a browser".to_string()));
}

#[tokio::test]
async fn a_tool_that_fails_hands_back_its_own_message() {
    let pending = Arc::new(PendingCalls::new(Duration::from_secs(5)));
    let spy = Arc::new(SpyBroadcaster::default());
    let host = AppToolHost::new(
        catalogue_offering("app_theme"),
        pending.clone(),
        spy.clone(),
        "c1".into(),
    );

    let call = tokio::spawn(async move { host.call_tool("app_theme", json!({"action": "set"})).await });
    once_sent(&spy).await;
    let call_id = spy.first().data["call_id"].as_str().expect("a call id").to_string();

    for _ in 0..1000 {
        if pending.outstanding() > 0 {
            break;
        }
        tokio::task::yield_now().await;
    }
    pending.resolve(AppToolResult {
        call_id,
        ok: false,
        content: "no colour was given".into(),
    });

    assert_eq!(call.await.unwrap(), Err("no colour was given".to_string()));
}

#[tokio::test]
async fn a_tool_nobody_answers_returns_a_sentence_the_model_can_say() {
    let host = AppToolHost::new(
        catalogue_offering("app_look_at_screen"),
        Arc::new(PendingCalls::new(Duration::from_millis(20))),
        Arc::new(SpyBroadcaster::default()),
        "c1".into(),
    );
    assert_eq!(
        host.call_tool("app_look_at_screen", json!({})).await,
        Err(NO_ANSWER.to_string())
    );
}

#[tokio::test]
async fn an_unadvertised_tool_never_reaches_the_renderer() {
    let spy = Arc::new(SpyBroadcaster::default());
    let host = AppToolHost::new(
        catalogue_offering("app_theme"),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        spy.clone(),
        "c1".into(),
    );

    assert_eq!(
        host.call_tool("app_delete_everything", json!({})).await,
        Err(NOT_OFFERED.to_string())
    );
    assert_eq!(spy.count(), 0);
}

#[tokio::test]
async fn the_advertised_tools_are_the_registered_ones() {
    let host = AppToolHost::new(
        catalogue_offering("app_theme"),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
        "c1".into(),
    );
    assert_eq!(host.list_tools().await[0].name, "app_theme");
}

#[test]
fn the_conversation_id_comes_from_the_path() {
    let hosts = AppToolHosts::new(
        Arc::new(Catalogue::new()),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
    );
    assert!(hosts.resolve("/mcp/conversation-7").is_some());
    assert!(hosts.resolve("/mcp/conversation-7/").is_some());
}

#[test]
fn a_path_without_a_conversation_resolves_to_nothing() {
    let hosts = AppToolHosts::new(
        Arc::new(Catalogue::new()),
        Arc::new(PendingCalls::new(Duration::from_secs(5))),
        Arc::new(SpyBroadcaster::default()),
    );
    assert!(hosts.resolve("/mcp/").is_none());
    assert!(hosts.resolve("/mcp").is_none());
    assert!(hosts.resolve("/health").is_none());
}
