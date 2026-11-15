//! City, ISP and "VPN or hosting" details for addresses, from the free ip-api.com batch service.
//! This is the only place the app sends addresses to a third party, and only when the user presses
//! "Look up ISP and city" in Capture. Only the public addresses in the list are sent, nothing else.

use crate::netaddr::is_public;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, time::Duration};

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Raw {
    query: String,
    status: String,
    city: String,
    region_name: String,
    isp: String,
    proxy: bool,
    hosting: bool,
    mobile: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpDetails {
    pub address: String,
    pub city: String,
    pub region: String,
    pub isp: String,
    /// A known VPN, proxy or data-centre address.
    pub vpn: bool,
    pub mobile: bool,
}

/// The service's batch limit is 100 addresses per request and 15 requests a minute.
const BATCH: usize = 100;

#[tauri::command(async)]
pub fn ip_details(ips: Vec<String>) -> Result<Vec<IpDetails>, String> {
    let list: Vec<String> = ips
        .into_iter()
        .filter(|t| t.parse::<IpAddr>().map(is_public).unwrap_or(false))
        .take(BATCH * 3)
        .collect();
    let mut out = Vec::new();
    for chunk in list.chunks(BATCH) {
        let res = ureq::post("http://ip-api.com/batch?fields=status,query,city,regionName,isp,proxy,hosting,mobile")
            .timeout(Duration::from_secs(12))
            .set("Content-Type", "application/json")
            .send_string(&serde_json::to_string(chunk).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Could not reach the lookup service: {e}"))?;
        let text = res.into_string().map_err(|e| format!("Could not read the lookup answer: {e}"))?;
        let rows: Vec<Raw> = serde_json::from_str(&text).map_err(|_| "The lookup service gave an answer this app could not read.".to_string())?;
        for r in rows.into_iter().filter(|r| r.status == "success") {
            out.push(IpDetails { address: r.query, city: r.city, region: r.region_name, isp: r.isp, vpn: r.proxy || r.hosting, mobile: r.mobile });
        }
    }
    Ok(out)
}
