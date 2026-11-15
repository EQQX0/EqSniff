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
    let peer = "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=";
    let psk = "Xf7pR25LCodwdtCnMYpX08FsFyUbJmRd9ML4frwJkqs=";
    let conf = format!("[Interface]
PrivateKey = {key}
Address = 10.0.0.2/32
[Peer]
PublicKey = {peer}
PresharedKey = {psk}
AllowedIPs = 0.0.0.0/0
");
    let stored = parse_for_tests(&conf).unwrap();
    let text = "[Interface]
PrivateKey = <unchanged>
Address = 10.0.0.2/32
# <unchanged>
DNS = <unchanged>
";
    let out = fill_placeholders(text, &stored);
    assert!(out.contains(&format!("PrivateKey = {key}")));
    assert!(out.contains("# <unchanged>"));
    assert!(out.contains("DNS = <unchanged>"));
    assert_eq!(fill_placeholders("PrivateKey = other", &stored), "PrivateKey = other");
    // A PresharedKey placeholder outside any known peer is left alone (and then fails to parse).
    assert_eq!(fill_placeholders("[Peer]
PublicKey = nope
PresharedKey = <unchanged>", &stored), "[Peer]
PublicKey = nope
PresharedKey = <unchanged>");
}

#[test]
fn preshared_keys_are_hidden_and_restored_by_peer_public_key() {
    let key = "dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=";
    let p1 = "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=";
    let p2 = "Xf7pR25LCodwdtCnMYpX08FsFyUbJmRd9ML4frwJkqs=";
    let psk1 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
    let psk2 = "HwAeAB0AHAAbABoAGQAYABcAFgAVABQAEwASABEAEAA=";
    let conf = format!(
        "[Interface]
PrivateKey = {key}
Address = 10.0.0.2/32
[Peer]
PublicKey = {p1}
PresharedKey = {psk1}
AllowedIPs = 10.1.0.0/16
[Peer]
PresharedKey = {psk2}
PublicKey = {p2}
AllowedIPs = 10.2.0.0/16
[Peer]
PublicKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
AllowedIPs = 10.3.0.0/16
"
    );
    let cfg = parse_for_tests(&conf).unwrap();
    let shown = render_for_edit(&cfg);
    assert!(!shown.contains(psk1) && !shown.contains(psk2) && !shown.contains(key));
    assert_eq!(shown.matches("PresharedKey = <unchanged>").count(), 2);
    let back = parse_for_tests(&fill_placeholders(&shown, &cfg)).unwrap();
    assert_eq!(back, cfg);
    // Peers swapped in the editor: each key follows its own public key, not its position.
    let swapped = shown.replace(p1, "@@1").replace(p2, p1).replace("@@1", p2);
    let back = parse_for_tests(&fill_placeholders(&swapped, &cfg)).unwrap();
    assert_eq!(back.peers[0].public_key, p2);
    assert_eq!(back.peers[0].preshared_key.as_deref(), Some(psk2));
    assert_eq!(back.peers[1].preshared_key.as_deref(), Some(psk1));
    assert_eq!(back.peers[2].preshared_key, None);
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
    let back = parse_for_tests(&fill_placeholders(&shown, &cfg)).unwrap();
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
