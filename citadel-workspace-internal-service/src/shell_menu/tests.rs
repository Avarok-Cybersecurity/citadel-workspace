use super::*;

fn titles(menu: &[Entry]) -> Vec<&'static str> {
    menu.iter()
        .map(|e| match e {
            Entry::Action { title, .. } => *title,
            Entry::Separator => "-",
        })
        .collect()
}

#[test]
fn the_menu_is_the_mac_menu_bars_item_for_item() {
    assert_eq!(
        titles(&entries(Some("https://work.avarok.net"), false)),
        [
            "Open Citadel Workspaces",
            "Create a Workspace\u{2026}",
            "-",
            "Start at Login",
            "Show Log",
            "-",
            "About Citadel Agent",
            "Check for Updates\u{2026}",
            "-",
            "Quit Citadel Agent"
        ]
    );
}

#[test]
fn the_titles_match_the_mac_source() {
    // Tray.swift is the other half of "parity": a title edited on one side only fails here.
    let swift = include_str!("../../../apps/macos-agent/Tray.swift");
    for entry in entries(Some("https://work.avarok.net"), false) {
        if let Entry::Action { title, .. } = entry {
            assert!(
                swift.contains(&format!("\"{title}\"")),
                "{title} is not in Tray.swift"
            );
        }
    }
}

#[test]
fn without_a_site_the_menu_does_not_offer_to_open_it() {
    assert_eq!(
        titles(&entries(None, true)),
        ["Start at Login", "Show Log", "-", "Quit Citadel Agent"]
    );
}

#[test]
fn the_agent_pages_are_under_the_site() {
    assert_eq!(
        agent_page_url("https://work.avarok.net", "about"),
        "https://work.avarok.net/agent#about"
    );
    assert_eq!(
        agent_page_url("https://work.avarok.net:8443", "updates"),
        "https://work.avarok.net:8443/agent#updates"
    );
}

#[test]
fn the_pages_the_menus_open_are_the_same_on_the_mac() {
    // main.swift names the sections; a section renamed on one side only fails here.
    let swift = include_str!("../../../apps/macos-agent/main.swift");
    for section in ["about", "updates"] {
        assert!(
            swift.contains(&format!("openAgentPage(\"{section}\"")),
            "{section} is not opened by main.swift"
        );
    }
}

#[test]
fn the_login_item_carries_the_current_state() {
    for on in [true, false] {
        let checked = entries(None, on).into_iter().find_map(|e| match e {
            Entry::Action {
                action: MenuAction::ToggleLogin,
                checked,
                ..
            } => checked,
            _ => None,
        });
        assert_eq!(checked, Some(on));
    }
}

#[test]
fn every_action_survives_the_trip_through_its_id() {
    for entry in entries(Some("https://work.avarok.net"), false) {
        if let Entry::Action { action, .. } = entry {
            assert_eq!(MenuAction::from_id(action.id()), Some(action));
        }
    }
    assert_eq!(MenuAction::from_id("nothing"), None);
}

#[test]
fn the_site_is_the_first_https_origin() {
    let found =
        workspace_origin("http://localhost:5291, https://work.avarok.net:8443,https://b.example");
    assert_eq!(found.as_deref(), Some("https://work.avarok.net:8443"));
}

#[test]
fn a_wildcard_plain_or_malformed_origin_names_no_site() {
    for spec in [
        "*",
        "http://localhost:5291",
        "https://",
        "https://a b",
        "https://host:99999",
        "https://evil.example/path",
        "",
    ] {
        assert_eq!(workspace_origin(spec), None, "{spec}");
    }
}

#[test]
fn the_create_page_is_under_the_site() {
    assert_eq!(
        create_url("https://work.avarok.net"),
        "https://work.avarok.net/create"
    );
}

#[test]
fn the_log_lives_under_local_app_data() {
    let path = log_file(Some(PathBuf::from("/data"))).unwrap();
    assert_eq!(
        path,
        PathBuf::from("/data")
            .join("Citadel Agent")
            .join("agent.log")
    );
    assert!(log_file(None).is_err());
}

#[test]
fn only_a_log_past_the_limit_starts_over() {
    assert!(!starts_over(None));
    assert!(!starts_over(Some(LOG_LIMIT_BYTES)));
    assert!(starts_over(Some(LOG_LIMIT_BYTES + 1)));
}

#[test]
fn a_taken_port_says_an_agent_is_already_running() {
    let taken = std::io::Error::from(ErrorKind::AddrInUse);
    let message = failure_message(&taken, Some(Path::new("agent.log")));
    assert!(message.contains("already running"), "{message}");
    assert!(!message.contains("agent.log"));
}

#[test]
fn any_other_failure_is_reported_with_where_the_log_is() {
    let other = std::io::Error::other("the origin list is wrong");
    let message = failure_message(&other, Some(Path::new("C:/x/agent.log")));
    assert!(message.contains("the origin list is wrong") && message.contains("agent.log"));
    assert_eq!(failure_message(&other, None), "the origin list is wrong");
}
