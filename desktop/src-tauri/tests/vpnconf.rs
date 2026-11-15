#[path = "../src/vpnconf.rs"]
mod vpnconf;

const K1: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const K2: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=";

fn good() -> String {
    format!("[Interface]\nPrivateKey = {K1}\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1, 8.8.8.8\nMTU = 1420\n\n[Peer]\nPublicKey = {K2}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example.com:51820\nPersistentKeepalive = 25\n")
}

#[test]
fn reads_a_normal_file_and_round_trips() {
    let c = vpnconf::parse(&good()).unwrap();
    assert_eq!(c.addresses, ["10.0.0.2/32"]);
    assert_eq!(c.dns.len(), 2);
    assert_eq!(c.peers[0].keepalive, Some(25));
    assert_eq!(vpnconf::parse(&vpnconf::render(&c)).unwrap(), c);
}

#[test]
fn refuses_commands_and_unknown_settings() {
    for bad in ["PostUp = calc.exe", "preup = x", "PostDown = y", "Table = off"] {
        let t = good().replace("MTU = 1420", bad);
        assert!(vpnconf::parse(&t).is_err(), "{bad}");
    }
}

#[test]
fn refuses_bad_values() {
    for (from, to) in [
        (K1, "short"),
        ("10.0.0.2/32", "10.0.0.2/99"),
        ("10.0.0.2/32", "not-an-ip"),
        ("vpn.example.com:51820", "vpn.example.com"),
        ("vpn.example.com:51820", "a b:51820"),
        ("vpn.example.com:51820", "x;calc:51820"),
        ("MTU = 1420", "MTU = 12"),
        ("PersistentKeepalive = 25", "PersistentKeepalive = soon"),
    ] {
        assert!(vpnconf::parse(&good().replace(from, to)).is_err(), "{from} -> {to}");
    }
}

#[test]
fn needs_the_basics() {
    assert!(vpnconf::parse("").is_err());
    assert!(vpnconf::parse(&good().replace("[Peer]", "[Other]")).is_err());
    assert!(vpnconf::parse(&format!("[Interface]\nPrivateKey = {K1}\n[Peer]\nPublicKey = {K2}\n")).is_err());
    assert!(vpnconf::parse(&"x".repeat(20_000)).is_err());
}

#[test]
fn rendered_file_has_nothing_extra() {
    let t = format!("{}\n# comment\n", good());
    let out = vpnconf::render(&vpnconf::parse(&t).unwrap());
    assert!(!out.contains("comment"));
    assert!(out.starts_with("[Interface]\nPrivateKey"));
}

#[test]
fn names() {
    assert!(vpnconf::valid_name("Frankfurt-wireguard"));
    for bad in ["", "a b", "a/b", r"a\b", "x\"y", &"n".repeat(33)] {
        assert!(!vpnconf::valid_name(bad), "{bad}");
    }
}

#[test]
fn windows_device_names_are_refused() {
    for bad in ["con", "CON", "Prn", "aux", "NUL", "com1", "COM9", "lpt1", "LPT9", "nul.txt", "con.conf", "Aux.x.y"] {
        assert!(!vpnconf::valid_name(bad), "{bad}");
    }
    for ok in ["com0", "com10", "lpt", "console", "mycon", "com1x", "a.con", "Frankfurt"] {
        assert!(vpnconf::valid_name(ok), "{ok}");
    }
}
