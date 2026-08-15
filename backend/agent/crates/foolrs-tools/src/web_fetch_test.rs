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

/// Where a redirect actually points.
///
/// Servers answer `Location` with all three shapes and the difference matters:
/// a path-relative hop resolved as absolute silently changes host, which is the
/// exact move an SSRF check exists to catch.
#[test]
fn a_redirect_target_is_resolved_against_the_page_it_came_from() {
    assert_eq!(
        resolve_relative("https://arxiv.org/abs/1706.03762", "https://arxiv.org/pdf/1706.03762v7"),
        Ok("https://arxiv.org/pdf/1706.03762v7".to_string())
    );
    assert_eq!(
        resolve_relative("https://arxiv.org/abs/1706.03762", "/pdf/1706.03762v7"),
        Ok("https://arxiv.org/pdf/1706.03762v7".to_string())
    );
    assert_eq!(
        resolve_relative("https://arxiv.org/abs/1706.03762", "1706.03762v7.pdf"),
        Ok("https://arxiv.org/abs/1706.03762v7.pdf".to_string())
    );
}

#[test]
fn a_redirect_with_nowhere_to_go_is_refused_rather_than_guessed() {
    assert!(resolve_relative("not a url", "/somewhere").is_err());
    assert!(resolve_relative("https://example.com/a", "").is_err());
}

/// A redirect that leaves the public web is still refused.
///
/// The check is per hop rather than on the address the model supplied, because
/// somebody else's server chooses the second one. `https://example.com/go`
/// answering `Location: http://169.254.169.254/latest/meta-data/` is the whole
/// attack, and following redirects at all is only safe because of this.
#[test]
fn every_hop_is_checked_not_only_the_first() {
    assert_eq!(
        check_url(&resolve_relative("https://example.com/go", "http://169.254.169.254/latest/").unwrap()),
        Err(UrlRefusal::Private)
    );
    // A hop into a scheme that is not the web is refused before it resolves —
    // there is nowhere to follow it to.
    assert_eq!(
        resolve_relative("https://example.com/go", "file:///etc/passwd"),
        Err(UrlRefusal::NotWeb)
    );
}

/// What may be read as text, and what must not be.
///
/// `response.text()` runs any body through a lossy UTF-8 conversion, so a PDF
/// arrives as mojibake and the model reports it as the document's contents.
/// That is worse than a refusal: it is a confident answer about a file nobody
/// read.
#[test]
fn only_text_shaped_bodies_are_read_as_text() {
    assert!(is_readable_text("text/html; charset=utf-8"));
    assert!(is_readable_text("text/plain"));
    assert!(is_readable_text("application/json"));
    assert!(is_readable_text("application/xhtml+xml"));
    // Absent is treated as readable: plenty of plain pages send no type at all,
    // and refusing them would break the ordinary case to guard the rare one.
    assert!(is_readable_text(""));

    assert!(!is_readable_text("application/pdf"));
    assert!(!is_readable_text("application/octet-stream"));
    assert!(!is_readable_text("image/png"));
    assert!(!is_readable_text(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ));
}
