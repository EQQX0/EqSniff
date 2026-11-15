use network_toolkit_lib::vpnengine::{exclude_routes, public_key_of};

#[test]
fn public_key_matches_rfc7748_vector() {
    assert_eq!(public_key_of("dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=").as_deref(), Some("hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo="));
    assert_eq!(public_key_of("not a key"), None);
}

#[test]
fn hole_in_the_default_route_leaves_every_other_address_covered() {
    let r = exclude_routes("0.0.0.0/0", "1.2.3.4").unwrap();
    assert_eq!(r.len(), 32);
    assert!(r.contains(&"1.2.3.5/32".to_string()));
    assert!(r.contains(&"128.0.0.0/1".to_string()));
    assert!(!r.iter().any(|x| x == "1.2.3.4/32"));
    // Each range must not contain the hole.
    for x in &r {
        let (ip, len) = x.split_once('/').unwrap();
        let ip: std::net::Ipv4Addr = ip.parse().unwrap();
        let len: u32 = len.parse().unwrap();
        let mask = if len == 0 { 0 } else { u32::MAX << (32 - len) };
        assert_ne!(u32::from(ip) & mask, u32::from(std::net::Ipv4Addr::new(1, 2, 3, 4)) & mask, "{x}");
    }
}

#[test]
fn no_hole_when_the_address_is_outside() {
    assert_eq!(exclude_routes("10.0.0.0/8", "192.168.1.1"), None);
}
