use network_toolkit_lib::hotspot::*;

#[test]
fn ssid_rules() {
    assert!(validate_ssid("Console Wi-Fi").is_ok());
    assert!(validate_ssid("").is_err());
    assert!(validate_ssid(&"a".repeat(32)).is_ok());
    assert!(validate_ssid(&"a".repeat(33)).is_err());
    assert!(validate_ssid("bad\nname").is_err());
    // 17 two-byte characters fit the 32 character rule but not the 32 byte limit.
    assert!(validate_ssid(&"é".repeat(17)).is_err());
}

#[test]
fn password_rules() {
    assert!(validate_password("12345678").is_ok());
    assert!(validate_password("1234567").is_err());
    assert!(validate_password(&"x".repeat(63)).is_ok());
    assert!(validate_password(&"x".repeat(64)).is_err());
    assert!(validate_password("pass word! ok").is_ok());
    assert!(validate_password("passwörd123").is_err());
    assert!(validate_password("tab\there123").is_err());
}

const ARP: &str = "
Interface: 192.168.1.20 --- 0x4
  Internet Address      Physical Address      Type
  192.168.1.1           aa-bb-cc-00-11-22     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static

Interface: 192.168.137.1 --- 0x9
  Internet Address      Physical Address      Type
  192.168.137.1         00-11-22-33-44-55     dynamic
  192.168.137.12        0a-1b-2c-3d-4e-5f     dynamic
  192.168.137.77        ff-ff-ff-ff-ff-ff     dynamic
  192.168.137.255       ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
  239.255.255.250       01-00-5e-7f-ff-fa     static
";

#[test]
fn arp_reads_only_the_chosen_interface() {
    let r = parse_arp(ARP, "192.168.137.1");
    assert_eq!(r, vec![Neighbor { ip: "192.168.137.12".into(), mac: "0A:1B:2C:3D:4E:5F".into() }]);
    let other = parse_arp(ARP, "192.168.1.20");
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].ip, "192.168.1.1");
    assert!(parse_arp(ARP, "10.0.0.1").is_empty());
    assert!(parse_arp("", "192.168.137.1").is_empty());
}

#[test]
fn mac_normalising() {
    assert_eq!(normalize_mac("aa-bb-cc-dd-ee-ff").as_deref(), Some("AA:BB:CC:DD:EE:FF"));
    assert_eq!(normalize_mac("aa:bb:cc:dd:ee:0f").as_deref(), Some("AA:BB:CC:DD:EE:0F"));
    assert_eq!(normalize_mac("aa-bb-cc"), None);
    assert_eq!(normalize_mac("gg-bb-cc-dd-ee-ff"), None);
}

#[test]
fn adapter_list_parses_one_many_or_none() {
    let one = r#"{"name":"Ethernet","description":"Realtek","connected":true,"virtual":false,"ipv4":"192.168.1.20"}"#;
    let a = parse_adapters(one).unwrap();
    assert_eq!(a.len(), 1);
    assert!(a[0].connected && !a[0].is_virtual);
    assert_eq!(a[0].ipv4.as_deref(), Some("192.168.1.20"));

    let many = r#"[{"name":"vEthernet","description":"Hyper-V","connected":true,"virtual":true,"ipv4":null},
                   {"name":"Ethernet","description":"Realtek","connected":false,"virtual":false,"ipv4":null}]"#;
    let m = parse_adapters(many).unwrap();
    assert_eq!(m.len(), 2);
    assert_eq!(m[0].name, "Ethernet"); // sorted by name
    assert!(m[1].is_virtual);

    assert!(parse_adapters("").unwrap().is_empty());
    assert!(parse_adapters("[]").unwrap().is_empty());
    assert!(parse_adapters("not json").is_err());
    assert_eq!(parse_adapters("\u{feff}[]").unwrap().len(), 0);
}

fn adapters() -> Vec<AdapterInfo> {
    parse_adapters(
        r#"[{"name":"Ethernet","description":"a","connected":true,"virtual":false},
            {"name":"Ethernet 2","description":"b","connected":true,"virtual":false}]"#,
    )
    .unwrap()
}

#[test]
fn sharing_request_checks() {
    let a = adapters();
    assert!(check_apply("Ethernet", "Ethernet 2", &a, false).is_ok());
    assert!(check_apply("Ethernet", "Ethernet", &a, false).is_err());
    assert!(check_apply("", "Ethernet 2", &a, false).is_err());
    assert!(check_apply("Ethernet", "Nope", &a, false).is_err());
    let on = check_apply("Ethernet", "Ethernet 2", &a, true).unwrap_err();
    assert!(on.contains("Reset"));
}

fn ad(name: &str, desc: &str, up: bool, virt: bool, ip: Option<&str>) -> AdapterInfo {
    AdapterInfo { name: name.into(), description: desc.into(), connected: up, is_virtual: virt, ipv4: ip.map(str::to_string) }
}

#[test]
fn adapters_are_ordered_connected_real_first() {
    let mut l = vec![
        ad("vEthernet (Default Switch)", "Hyper-V", true, true, None),
        ad("Wi-Fi", "MediaTek", false, false, None),
        ad("Ethernet", "Realtek", true, false, Some("192.168.1.20")),
        ad("Bluetooth Network Connection", "Bluetooth", false, true, None),
        ad("Ethernet 2", "Intel", true, false, None),
    ];
    order_adapters(&mut l);
    let names: Vec<&str> = l.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, ["Ethernet", "Ethernet 2", "vEthernet (Default Switch)", "Wi-Fi", "Bluetooth Network Connection"]);
}

#[test]
fn picks_the_new_hotspot_adapter() {
    let before = vec![
        ad("Ethernet", "Realtek", true, false, Some("192.168.1.20")),
        ad("Wi-Fi", "MediaTek", false, false, None),
        ad("Local Area Connection* 9", "Microsoft Wi-Fi Direct Virtual Adapter", false, true, None),
    ];
    let mut after = before.clone();
    after[2].connected = true;
    after[2].ipv4 = Some("192.168.137.1".into());
    assert_eq!(pick_hotspot_adapter(&before, &after, "Ethernet").as_deref(), Some("Local Area Connection* 9"));

    // brand new adapter name
    let mut after2 = before.clone();
    after2.push(ad("Local Area Connection* 12", "Microsoft Wi-Fi Direct Virtual Adapter #2", true, true, None));
    assert_eq!(pick_hotspot_adapter(&before, &after2, "Ethernet").as_deref(), Some("Local Area Connection* 12"));
}

#[test]
fn does_not_guess_the_hotspot_adapter() {
    let before = vec![ad("Ethernet", "Realtek", true, false, Some("192.168.1.20")), ad("Wi-Fi", "MediaTek", false, false, None)];
    // nothing changed
    assert_eq!(pick_hotspot_adapter(&before, &before, "Ethernet"), None);
    // a new adapter without hotspot traits is not enough
    let mut other = before.clone();
    other.push(ad("Ethernet 3", "USB NIC", true, false, None));
    assert_eq!(pick_hotspot_adapter(&before, &other, "Ethernet"), None);
    // the public adapter is never the answer
    let mut pubchange = before.clone();
    pubchange[0].ipv4 = Some("192.168.137.1".into());
    pubchange[0].description = "Wi-Fi Direct Virtual".into();
    assert_eq!(pick_hotspot_adapter(&before, &pubchange, "Ethernet"), None);
    assert_eq!(pick_hotspot_adapter(&[], &[], "Ethernet"), None);
}

#[test]
fn public_pref_checks() {
    assert!(check_public_pref("").is_ok());
    assert!(check_public_pref("Ethernet").is_ok());
    assert!(check_public_pref("bad\nname").is_err());
    assert!(check_public_pref(&"x".repeat(300)).is_err());
}
