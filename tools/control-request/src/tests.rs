use super::*;

fn args(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_string).collect()
}

#[test]
fn an_origin_is_https_and_its_host_is_the_audience() {
    let c = control("https://Work.Avarok.net").expect("an origin");
    assert_eq!(c.audience, "work.avarok.net");
    assert_eq!(c.origin, "https://Work.Avarok.net");
    for bad in [
        "http://work.avarok.net",
        "https://",
        "https://work.avarok.net/api",
        "https://work.avarok.net:8443",
        "work.avarok.net",
    ] {
        assert!(control(bad).is_err(), "{bad}");
    }
}

#[test]
fn flags_are_taken_once_and_leftovers_are_refused() {
    let mut flags = Flags::parse(&args("--a 1 --yes --b 2"), &["--yes"]).expect("parses");
    assert_eq!(flags.take("--a").as_deref(), Some("1"));
    assert!(flags.switch("--yes"));
    assert!(!flags.switch("--yes"), "a switch is used once");
    assert_eq!(
        flags.finish("cmd"),
        Err("cmd does not take --b".to_string())
    );

    let mut flags = Flags::parse(&args("--yes"), &["--yes"]).expect("parses");
    assert_eq!(
        flags.finish("cmd"),
        Err("cmd does not take --yes".to_string())
    );
    assert!(
        Flags::parse(&args("--yes"), &[]).is_err(),
        "not a switch: needs a value"
    );
    flags = Flags::parse(&[], &["--yes"]).expect("parses");
    assert!(!flags.switch("--yes"));
    for bad in ["--a 1 --a 2", "--yes --yes", "stray", "--a"] {
        assert!(Flags::parse(&args(bad), &["--yes"]).is_err(), "{bad}");
    }
}

#[test]
fn numbers_name_their_flag() {
    assert_eq!(number::<u32>("--n", "7"), Ok(7));
    assert_eq!(
        number::<u32>("--n", "-1"),
        Err("--n \"-1\" is not a whole number".to_string())
    );
}
