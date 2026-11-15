//! City, ISP and "VPN or hosting" details for addresses, worked out on this computer. Nothing is sent anywhere
//! when an address is looked up, so it is instant and works offline.
//!
//! - ISP comes from the DB-IP "IP to ASN Lite" database built into the app (CC BY 4.0). The ISP is the name of
//!   the network (autonomous system) that owns the address.
//! - City and region come from the DB-IP "IP to City Lite" database. It is large, so the app downloads it once
//!   in the background (first start, then again when it is older than 40 days) into the data folder. Until it is
//!   there, city stays empty.
//! - "VPN or hosting" is a guess from the network's name: data centres, cloud hosts and VPN companies. It is not a
//!   list of every VPN, so a home connection used as a VPN will not be flagged.

use crate::netaddr::is_public;
use maxminddb::{geoip2, Mmap, Reader};
use serde::Serialize;
use std::{
    fs,
    net::IpAddr,
    path::PathBuf,
    sync::{Arc, OnceLock, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static ASN_DB: &[u8] = include_bytes!("../resources/asn.mmdb");
static DIR: OnceLock<PathBuf> = OnceLock::new();
static CITY: RwLock<Option<Arc<Reader<Mmap>>>> = RwLock::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpDetails {
    pub address: String,
    pub city: String,
    pub region: String,
    pub isp: String,
    /// A known VPN, proxy or data-centre network.
    pub vpn: bool,
    pub mobile: bool,
}

fn asn_reader() -> Option<&'static Reader<&'static [u8]>> {
    static READER: OnceLock<Option<Reader<&'static [u8]>>> = OnceLock::new();
    READER.get_or_init(|| Reader::from_source(ASN_DB).ok()).as_ref()
}

fn city_path() -> Option<PathBuf> {
    DIR.get().map(|d| d.join("city.mmdb"))
}

/// The city database, opened on first use once the file exists.
fn city_reader() -> Option<Arc<Reader<Mmap>>> {
    if let Some(r) = CITY.read().ok()?.as_ref() {
        return Some(r.clone());
    }
    let path = city_path()?;
    if !path.exists() {
        return None;
    }
    let r = Arc::new(Reader::open_mmap(&path).ok()?);
    *CITY.write().ok()? = Some(r.clone());
    Some(r)
}

const HOSTING_WORDS: &[&str] = &[
    "amazon", "aws", "microsoft", "azure", "google", "digitalocean", "digital ocean", "ovh", "hetzner", "linode", "akamai", "vultr", "choopa", "m247",
    "leaseweb", "contabo", "oracle", "cloudflare", "datacamp", "nordvpn", "expressvpn", "proton", "mullvad", "private internet access", "surfshark",
    "cyberghost", "tefincom", "packethub", "quadranet", "colocrossing", "psychz", "frantech", "hostinger", "scaleway", "alibaba", "tencent", "hosting",
    "vpn", "proxy", "datacenter", "data center", "datacentre", "cloud", "server", "colo", "dedicated", "vps", "online s.a.s", "ionos", "godaddy",
    "rackspace", "softlayer", "ibm", "packet host", "equinix", "zenlayer", "cdn77", "gcore", "fastly", "limelight", "internap", "serverius", "worldstream",
    "hostwinds", "hivelocity", "interserver", "bluehost", "dreamhost", "namecheap", "terrahost", "g-core", "ipxo", "ipvolume", "xtom", "tzulo", "clouvider",
];

fn looks_like_hosting(org: &str) -> bool {
    let o = org.to_lowercase();
    HOSTING_WORDS.iter().any(|w| o.contains(w))
}

fn looks_mobile(org: &str) -> bool {
    let o = org.to_lowercase();
    ["mobile", "wireless", "cellular", "lte"].iter().any(|w| o.contains(w))
}

fn one(text: &str, city: &Option<Arc<Reader<Mmap>>>) -> Option<IpDetails> {
    let ip: IpAddr = text.parse().ok()?;
    if !is_public(ip) {
        return None;
    }
    let mut d = IpDetails { address: text.to_string(), city: String::new(), region: String::new(), isp: String::new(), vpn: false, mobile: false };
    if let Some(r) = asn_reader() {
        if let Ok(a) = r.lookup::<geoip2::Asn>(ip) {
            if let Some(org) = a.autonomous_system_organization {
                d.isp = org.to_string();
                d.vpn = looks_like_hosting(org);
                d.mobile = looks_mobile(org);
            }
        }
    }
    if let Some(r) = city {
        if let Ok(c) = r.lookup::<geoip2::City>(ip) {
            d.city = c.city.and_then(|x| x.names).and_then(|n| n.get("en").map(|s| s.to_string())).unwrap_or_default();
            d.region = c
                .subdivisions
                .and_then(|v| v.into_iter().next())
                .and_then(|x| x.names)
                .and_then(|n| n.get("en").map(|s| s.to_string()))
                .unwrap_or_default();
        }
    }
    if d.isp.is_empty() && d.city.is_empty() {
        return None;
    }
    Some(d)
}

/// Looks up to 2000 addresses at once. Local and unknown addresses are left out.
#[tauri::command]
pub fn ip_details(ips: Vec<String>) -> Result<Vec<IpDetails>, String> {
    let city = city_reader();
    Ok(ips.iter().take(2000).filter_map(|t| one(t, &city)).collect())
}

/// Tells the module where the data folder's `ipdb` directory is. With `download`, starts fetching the city
/// database in the background when it is missing or old. The command line passes false and only reads.
pub fn init(dir: PathBuf, download: bool) {
    let _ = fs::create_dir_all(&dir);
    let _ = DIR.set(dir);
    if download {
        std::thread::spawn(|| {
            let _ = refresh_city();
        });
    }
}

/// The year and month (UTC) `back` months ago, from the system clock.
fn year_month(back: u32) -> (i64, u32) {
    let days = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() / 86400).unwrap_or(0) as i64;
    // civil-from-days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as i64;
    if m <= 2 {
        y += 1;
    }
    let total = y * 12 + (m - 1) - back as i64;
    (total.div_euclid(12), (total.rem_euclid(12) + 1) as u32)
}

fn refresh_city() -> Result<(), String> {
    let path = city_path().ok_or("no data folder")?;
    if let Ok(meta) = fs::metadata(&path) {
        let age = meta.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok()).unwrap_or(Duration::MAX);
        if age < Duration::from_secs(40 * 86400) {
            return Ok(());
        }
    }
    let part = path.with_extension("part");
    let mut last_err = String::new();
    for back in 0..2 {
        let (y, m) = year_month(back);
        let url = format!("https://download.db-ip.com/free/dbip-city-lite-{y}-{m:02}.mmdb.gz");
        match ureq::get(&url).timeout(Duration::from_secs(900)).call() {
            Ok(res) => {
                let mut gz = flate2::read::GzDecoder::new(res.into_reader());
                let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
                std::io::copy(&mut gz, &mut out).map_err(|e| {
                    let _ = fs::remove_file(&part);
                    e.to_string()
                })?;
                drop(out);
                // An open map of the old file would block the replacement on Windows.
                if let Ok(mut g) = CITY.write() {
                    *g = None;
                }
                fs::rename(&part, &path).map_err(|e| e.to_string())?;
                return Ok(());
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}
