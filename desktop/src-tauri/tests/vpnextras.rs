use network_toolkit_lib::killswitch::{permit_rules, Cond};
use network_toolkit_lib::vpnengine::*;

#[test]
fn options_parse_and_round_trip() {
    assert_eq!(parse_options(""), Options { killswitch: false });
    assert_eq!(parse_options("garbage"), Options { killswitch: false });
    assert_eq!(parse_options("{\"killswitch\":\"yes\"}"), Options { killswitch: false });
    let on = Options { killswitch: true };
    assert_eq!(parse_options(&render_options(on)), on);
    assert_eq!(parse_options(&render_options(Options::default())), Options::default());
}

#[test]
fn log_tail_keeps_the_last_lines() {
    let text: String = (1..=300).map(|i| format!("line {i}\n")).collect();
    let t = tail_lines(&text, 200);
    assert_eq!(t.lines().count(), 200);
    assert!(t.starts_with("line 101"));
    assert!(t.ends_with("line 300"));
    assert_eq!(tail_lines("a\nb", 200), "a\nb");
    assert_eq!(tail_lines("", 5), "");
}

#[test]
fn placeholder_is_replaced_only_on_the_private_key_line() {
    let key = "dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=";
    let text = "[Interface]\nPrivateKey = <unchanged>\nAddress = 10.0.0.2/32\n# <unchanged>\n[Peer]\nPresharedKey = <unchanged>\n";
    let out = fill_placeholder(text, key);
    assert!(out.contains(&format!("PrivateKey = {key}")));
    assert!(out.contains("PresharedKey = <unchanged>"));
    assert!(out.contains("# <unchanged>"));
    assert_eq!(fill_placeholder("PrivateKey = other", key), "PrivateKey = other");
}

#[test]
fn edit_view_never_holds_the_private_key() {
    let key = "dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=";
    let peer = "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=";
    let conf = format!("[Interface]\nPrivateKey = {key}\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = {peer}\nAllowedIPs = 0.0.0.0/0\nEndpoint = 1.2.3.4:51820\n");
    let cfg = parse_for_tests(&conf).unwrap();
    let shown = render_for_edit(&cfg);
    assert!(!shown.contains(key));
    assert!(shown.contains("PrivateKey = <unchanged>"));
    let back = parse_for_tests(&fill_placeholder(&shown, key)).unwrap();
    assert_eq!(back.private_key, key);
}

#[test]
fn prefix_is_optional() {
    assert_eq!(net_parts("10.0.0.2"), Some(("10.0.0.2".into(), 32)));
    assert_eq!(net_parts("fd00::2"), Some(("fd00::2".into(), 128)));
    assert_eq!(net_parts("10.0.0.0/8"), Some(("10.0.0.0".into(), 8)));
    assert_eq!(net_parts("10.0.0.0/33"), None);
    assert_eq!(net_parts("nonsense"), None);
}

#[test]
fn kill_switch_rules_cover_loopback_adapter_server_and_lan() {
    let ep: std::net::SocketAddr = "1.2.3.4:51820".parse().unwrap();
    let r = permit_rules(77, &[ep]);
    assert!(r.iter().any(|x| !x.v6 && !x.recv && x.conds == vec![Cond::Loopback]));
    assert!(r.iter().any(|x| x.v6 && x.recv && x.conds == vec![Cond::LocalInterface(77)]));
    let server = vec![Cond::RemoteV4 { addr: u32::from_be_bytes([1, 2, 3, 4]), mask: u32::MAX }, Cond::Udp, Cond::RemotePort(51820)];
    assert!(r.iter().any(|x| !x.v6 && !x.recv && x.conds == server));
    assert!(r.iter().any(|x| !x.v6 && x.conds == vec![Cond::RemoteV4 { addr: u32::from_be_bytes([192, 168, 0, 0]), mask: 0xFFFF_0000 }]));
    // A v4 server gets no v6 rule.
    assert!(!r.iter().any(|x| x.v6 && x.conds.contains(&Cond::RemotePort(51820))));
}

#[test]
fn links_in_the_folder_path_are_refused() {
    let base = std::env::temp_dir().join(format!("nt-reparse-{}", std::process::id()));
    let real = base.join("real");
    std::fs::create_dir_all(&real).unwrap();
    assert!(!has_reparse_point(&real));
    let link = base.join("link");
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&real).output().map(|o| o.status.success()).unwrap_or(false);
    if ok {
        assert!(has_reparse_point(&link));
        let _ = std::fs::remove_dir(&link);
    }
    let _ = std::fs::remove_dir_all(&base);
}
