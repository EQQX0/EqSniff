//! Country lookup for the far end of a connection. The database is built into the app
//! (DB-IP Lite, CC BY 4.0), so nothing is sent anywhere. Country level only.

use maxminddb::{geoip2, Reader};
use serde::Serialize;
use std::{collections::HashMap, net::IpAddr, sync::OnceLock};

static DB: &[u8] = include_bytes!("../resources/country.mmdb");

fn reader() -> Option<&'static Reader<&'static [u8]>> {
    static READER: OnceLock<Option<Reader<&'static [u8]>>> = OnceLock::new();
    READER.get_or_init(|| Reader::from_source(DB).ok()).as_ref()
}

#[derive(Serialize, Clone)]
pub struct Country {
    pub code: String,
    pub name: String,
}

/// Addresses that stay inside a network have no country.
fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !(v.is_private() || v.is_loopback() || v.is_link_local() || v.is_multicast() || v.is_broadcast() || v.is_unspecified()),
        IpAddr::V6(v) => {
            let first = v.segments()[0];
            !(v.is_loopback() || v.is_multicast() || v.is_unspecified() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80)
        }
    }
}

fn lookup_one(r: &Reader<&'static [u8]>, ip: IpAddr) -> Option<Country> {
    let rec: geoip2::Country = r.lookup(ip).ok()?;
    let c = rec.country?;
    let code = c.iso_code?.to_string();
    let name = c.names.as_ref().and_then(|n| n.get("en")).map(|s| s.to_string()).unwrap_or_else(|| code.clone());
    Some(Country { code, name })
}

/// Looks up up to 500 addresses at once. Private and unknown addresses are left out.
#[tauri::command]
pub fn geo_lookup(ips: Vec<String>) -> HashMap<String, Country> {
    let mut out = HashMap::new();
    let Some(r) = reader() else { return out };
    for text in ips.into_iter().take(500) {
        if let Ok(ip) = text.parse::<IpAddr>() {
            if is_public(ip) {
                if let Some(c) = lookup_one(r, ip) {
                    out.insert(text, c);
                }
            }
        }
    }
    out
}
