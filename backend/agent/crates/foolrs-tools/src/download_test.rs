use super::*;

/// The name is chosen from strings a stranger wrote.
///
/// Both the address and any `filename` the model passes came, ultimately, from
/// a page somebody else controls. Every case here is a real shape those arrive
/// in rather than an imagined one.
#[test]
fn a_name_is_taken_from_the_address_when_none_was_given() {
    assert_eq!(
        chosen_filename("https://arxiv.org/pdf/1706.03762v7.pdf", None),
        Ok("1706.03762v7.pdf".to_string())
    );
    assert_eq!(
        chosen_filename("https://example.com/files/report.xlsx?token=abc#page=2", None),
        Ok("report.xlsx".to_string())
    );
}

#[test]
fn an_address_with_no_name_in_it_asks_for_one_rather_than_inventing_one() {
    assert_eq!(
        chosen_filename("https://example.com/", None),
        Err(DownloadRefusal::Unnamed)
    );
}

#[test]
fn directories_in_a_name_are_thrown_away_rather_than_followed() {
    // A `Content-Disposition` of `../../autorun.inf` is describing a file
    // called `autorun.inf`. The interesting half of that header is the half
    // this drops.
    assert_eq!(
        chosen_filename("https://example.com/x", Some("../../notes.pdf")),
        Ok("notes.pdf".to_string())
    );
    assert_eq!(
        chosen_filename("https://example.com/x", Some("C:\\Windows\\System32\\notes.pdf")),
        Ok("notes.pdf".to_string())
    );
}

#[test]
fn a_name_that_is_only_a_way_out_is_refused() {
    assert_eq!(
        chosen_filename("https://example.com/x", Some("../..")),
        Err(DownloadRefusal::Escapes)
    );
    assert_eq!(
        chosen_filename("https://example.com/x", Some("/")),
        Err(DownloadRefusal::Escapes)
    );
}

#[test]
fn a_blank_name_falls_back_to_the_address_rather_than_failing() {
    // Models send an empty string for an optional field about as often as they
    // omit it. Both mean "you choose", and refusing one of them would fail a
    // download over a formatting habit.
    assert_eq!(
        chosen_filename("https://example.com/paper.pdf", Some("   ")),
        Ok("paper.pdf".to_string())
    );
}

/// A downloaded program is an object somebody double-clicks months later.
#[test]
fn programs_and_scripts_are_never_given_a_name_to_land_under() {
    for name in [
        "setup.exe",
        "run.BAT",
        "payload.ps1",
        "helper.dll",
        "install.sh",
        "x.jar",
    ] {
        assert!(
            matches!(
                chosen_filename("https://example.com/x", Some(name)),
                Err(DownloadRefusal::Executable(_))
            ),
            "{name} must be refused"
        );
    }
}

#[test]
fn ordinary_documents_keep_their_names() {
    for name in [
        "paper.pdf",
        "budget.xlsx",
        "notes.docx",
        "slides.pptx",
        "photo.png",
        "data.csv",
    ] {
        assert_eq!(
            chosen_filename("https://example.com/x", Some(name)),
            Ok(name.to_string())
        );
    }
}

/// The bytes are looked at because the headers are a claim.
#[test]
fn a_body_is_recognised_from_its_first_bytes() {
    assert_eq!(sniff(b"%PDF-1.7\nstuff"), Some("pdf"));
    assert_eq!(sniff(b"PK\x03\x04rest"), Some("zip"));
    assert_eq!(sniff(b"\x7fELF\x02\x01"), Some("elf"));
    assert_eq!(sniff(b"MZ\x90\x00"), Some("exe"));
    assert_eq!(sniff(b"plain text"), None);
    assert_eq!(sniff(b""), None);
}

#[test]
fn a_server_that_says_pdf_and_sends_a_program_is_refused() {
    assert_eq!(
        body_agrees("application/pdf", sniff(b"\x7fELF\x02\x01")),
        Err(DownloadRefusal::Mismatched {
            declared: "application/pdf".to_string(),
            actual: "elf".to_string(),
        })
    );
    assert_eq!(
        body_agrees("application/pdf", sniff(b"MZ\x90\x00")),
        Err(DownloadRefusal::Mismatched {
            declared: "application/pdf".to_string(),
            actual: "exe".to_string(),
        })
    );
}

#[test]
fn a_body_that_matches_its_headers_is_allowed_through() {
    assert_eq!(
        body_agrees("application/pdf; charset=binary", sniff(b"%PDF-1.4")),
        Ok(())
    );
    assert_eq!(
        body_agrees(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sniff(b"PK\x03\x04")
        ),
        Ok(())
    );
    // Nothing recognised is not a contradiction. Refusing here would refuse
    // every format this short list does not model, which is most of them.
    assert_eq!(body_agrees("application/pdf", None), Ok(()));
    assert_eq!(body_agrees("text/csv", sniff(b"a,b,c")), Ok(()));
}

#[test]
fn a_path_is_proved_to_be_inside_the_folder_it_claims() {
    let folder = Path::new("/ws/downloads");
    assert!(inside(folder, Path::new("/ws/downloads/paper.pdf")));
    assert!(!inside(folder, Path::new("/ws/notes.txt")));
    assert!(!inside(folder, Path::new("/ws/downloads/../secrets")));
}

/// The tool's own contract, checked without a network.
#[tokio::test]
async fn a_call_with_no_address_says_so_rather_than_doing_nothing() {
    let tool = DownloadTool::new(std::env::temp_dir());
    let result = tool.execute(serde_json::json!({})).await;
    assert!(result.is_error);
    assert!(result.content.contains("url"));
}

#[tokio::test]
async fn an_address_inside_this_machine_is_refused_before_a_request_is_made() {
    let tool = DownloadTool::new(std::env::temp_dir());
    let result = tool
        .execute(serde_json::json!({ "url": "http://169.254.169.254/latest/meta-data/" }))
        .await;
    assert!(result.is_error);
    assert!(
        result.content.contains("inside this machine or this network"),
        "got: {}",
        result.content
    );
}

#[test]
fn writing_a_file_counts_as_editing_rather_than_reading() {
    // The permission layer reads this. A tool that creates a file on somebody's
    // disk must not be classified beside the ones that only look things up.
    let tool = DownloadTool::new(std::env::temp_dir());
    assert_eq!(tool.category(), ToolCategory::Edit);
}
