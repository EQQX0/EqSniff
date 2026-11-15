//! Small address checks shared by the capture, replay and country-lookup code.
//! No window or driver code here, so the tests can build it on its own.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

pub fn is_local_v4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback() || ip.is_link_local()
}

pub fn is_local_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
}

/// Addresses that stay inside a network have no country.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !(v.is_private() || v.is_loopback() || v.is_link_local() || v.is_multicast() || v.is_broadcast() || v.is_unspecified()),
        IpAddr::V6(v) => {
            let first = v.segments()[0];
            !(v.is_loopback() || v.is_multicast() || v.is_unspecified() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80)
        }
    }
}
