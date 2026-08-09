use super::*;

#[test]
fn a_public_page_is_allowed() {
    assert_eq!(check_url("https://example.com/article"), Ok(()));
    assert_eq!(check_url("http://example.com"), Ok(()));
    assert_eq!(check_url("  https://example.com/x?y=1#z  "), Ok(()));
}

#[test]
fn only_the_web_is_the_web() {
    // `file:` would read the disk through a tool the rules treat as reading a
    // web page, which is a way around every path rule there is.
    assert_eq!(check_url("file:///C:/Windows/system32/config"), Err(UrlRefusal::NotWeb));
    assert_eq!(check_url("data:text/html,<script>"), Err(UrlRefusal::NotWeb));
    assert_eq!(check_url("ftp://example.com"), Err(UrlRefusal::NotWeb));
    assert_eq!(check_url("example.com"), Err(UrlRefusal::Malformed));
}

#[test]
fn this_machine_is_refused_by_name() {
    assert_eq!(check_url("http://localhost:1234/v1/models"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://printer.local/admin"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://api.internal/secrets"), Err(UrlRefusal::Private));
}

#[test]
fn this_machine_is_refused_by_address() {
    assert_eq!(check_url("http://127.0.0.1:1234/v1/models"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://0.0.0.0/"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://[::1]:8080/"), Err(UrlRefusal::Private));
}

#[test]
fn this_network_is_refused() {
    assert_eq!(check_url("http://192.168.1.1/admin"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://10.0.0.5/"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://172.16.4.4/"), Err(UrlRefusal::Private));
}

#[test]
fn the_cloud_metadata_address_is_refused() {
    // The one address that hands out credentials to anybody who asks. It is
    // link-local, and it is the reason this check exists at all.
    assert_eq!(
        check_url("http://169.254.169.254/latest/meta-data/"),
        Err(UrlRefusal::Private)
    );
}

#[test]
fn credentials_cannot_disguise_a_private_host() {
    // `http://example.com@127.0.0.1/` is a request to 127.0.0.1. Reading the
    // host as everything before the slash is how this check gets fooled.
    assert_eq!(check_url("http://example.com@127.0.0.1/"), Err(UrlRefusal::Private));
    assert_eq!(check_url("http://user:pass@192.168.0.1/"), Err(UrlRefusal::Private));
}

#[test]
fn a_public_host_with_credentials_is_still_public() {
    assert_eq!(check_url("https://user:pass@example.com/x"), Ok(()));
}

#[test]
fn scripts_and_styles_never_reach_the_model() {
    let html = "<html><head><style>body{color:red}</style><script>alert('x')</script></head>\
                <body><h1>Title</h1><p>Some words.</p></body></html>";
    let text = to_text(html);

    assert!(text.contains("Title"));
    assert!(text.contains("Some words."));
    assert!(!text.contains("alert"));
    assert!(!text.contains("color:red"));
}

#[test]
fn markup_is_removed_and_entities_are_readable() {
    assert_eq!(to_text("<p>Tom &amp; Jerry</p>"), "Tom & Jerry");
    assert_eq!(to_text("<p>a &lt;b&gt; c</p>"), "a <b> c");
}

#[test]
fn an_unclosed_script_swallows_the_rest_rather_than_leaking_it() {
    // Erring towards dropping content: a page that opens a script and never
    // closes it is malformed, and returning its innards to the model is the
    // outcome worth avoiding.
    let text = to_text("<p>before</p><script>var x = '<p>after</p>';");
    assert!(text.contains("before"));
    assert!(!text.contains("after"));
}

#[test]
fn whitespace_is_collapsed_so_a_page_is_readable() {
    // One blank line between blocks, however many the markup had. Paragraphs
    // that run together read worse than paragraphs with a gap, and a page
    // carrying forty blank lines wastes the context it is being read into.
    let text = to_text("<div>\n\n  <p>one</p>\n\n\n  <p>two</p>\n\n</div>");
    assert_eq!(text, "one\n\ntwo");
}
