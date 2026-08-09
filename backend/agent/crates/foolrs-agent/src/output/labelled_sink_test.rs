use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct Spy {
    lines: Mutex<Vec<String>>,
}

impl Spy {
    fn lines(&self) -> Vec<String> {
        self.lines.lock().expect("spy").clone()
    }
}

impl OutputSink for Spy {
    fn emit_text_delta(&self, text: &str, _msg_id: &str) {
        self.lines.lock().expect("spy").push(format!("text:{text}"));
    }
    fn emit_thinking(&self, text: &str, _msg_id: &str) {
        self.lines.lock().expect("spy").push(format!("thinking:{text}"));
    }
    fn emit_tool_call(&self, _id: &str, name: &str, _input: &str) {
        self.lines.lock().expect("spy").push(format!("call:{name}"));
    }
    fn emit_tool_result(&self, _id: &str, name: &str, is_error: bool, _content: &str) {
        self.lines
            .lock()
            .expect("spy")
            .push(format!("result:{name}:{is_error}"));
    }
    fn emit_stream_start(&self, _msg_id: &str) {
        self.lines.lock().expect("spy").push("start".into());
    }
    fn emit_stream_end(&self, _msg_id: &str, _turns: usize, _i: u64, _o: u64, _cc: u64, _cr: u64) {
        self.lines.lock().expect("spy").push("end".into());
    }
    fn emit_error(&self, msg: &str) {
        self.lines.lock().expect("spy").push(format!("error:{msg}"));
    }
    fn emit_info(&self, msg: &str) {
        self.lines.lock().expect("spy").push(format!("info:{msg}"));
    }
}

#[test]
fn a_childs_tools_are_forwarded_with_its_name() {
    // Five children streaming into one transcript without saying who is
    // speaking is worse than silence: a person reading it believes it is one
    // train of thought.
    let spy = Arc::new(Spy::default());
    let sink = LabelledSink::new(spy.clone(), "search-docs");

    sink.emit_tool_call("t1", "Grep", "{}");
    sink.emit_tool_result("t1", "Grep", false, "12 matches");

    assert_eq!(
        spy.lines(),
        vec![
            "call:[search-docs] Grep".to_string(),
            "result:[search-docs] Grep:false".to_string()
        ]
    );
}

#[test]
fn a_childs_failure_is_never_anonymous() {
    let spy = Arc::new(Spy::default());
    LabelledSink::new(spy.clone(), "build").emit_error("cargo exited 101");

    assert_eq!(spy.lines(), vec!["error:[build] cargo exited 101".to_string()]);
}

#[test]
fn a_childs_prose_does_not_overwrite_the_parents_answer() {
    // The child's text comes back to the parent as its result. Streaming it here
    // as well would put five replies on top of the parent's own, interleaved.
    let spy = Arc::new(Spy::default());
    let sink = LabelledSink::new(spy.clone(), "child");

    sink.emit_text_delta("half a sentence", "m1");
    sink.emit_thinking("a long deliberation", "m1");
    sink.emit_stream_start("m1");
    sink.emit_stream_end("m1", 3, 10, 20, 0, 0);

    assert!(spy.lines().is_empty());
}
