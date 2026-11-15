//! The command-line side of EqNetwork (`eqnet.exe`). It runs the same commands as the window,
//! with no window: it builds the app without any windows and calls the command functions directly,
//! so it reads and writes the same data folder (%APPDATA%\app.networktoolkit.desktop).
//!
//! Everything the window can do through a Tauri command can be done here:
//!   eqnet call <command> '<json arguments>'   any command, by name (see `eqnet commands`)
//! plus short forms for the common jobs (capture, ips, vpn, hotspot, scan, filters, lookup, backup).
//! Accounts, sync and sharing live in the window's TypeScript and are not part of the command line.

use crate::{capture, filters, geo, hotspot, ipinfo, netaddr, scan, settings, update, vpn};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    net::IpAddr,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

type Res = Result<Value, String>;

/// Every command `eqnet call` accepts, with the argument names it reads (camelCase JSON).
pub const COMMANDS: &[(&str, &str)] = &[
    ("list_adapters", "{}"),
    ("start_capture", "{adapter, filter?}"),
    ("poll_capture", "{}"),
    ("stop_capture", "{}"),
    ("replay_packet", "{id}"),
    ("export_pcap", "{ids:[number]} -> base64 pcap"),
    ("import_pcap", "{data: base64 pcap}"),
    ("get_filters", "{}"),
    ("save_filters", "{filters:[...]}"),
    ("get_store", "{name: labels|capture-filter|ip-storage|ip-storage-deleted|vpn-deleted|cloud-session}"),
    ("save_store", "{name, value}"),
    ("geo_lookup", "{ips:[string]}"),
    ("ip_details", "{ips:[string]} (local database, nothing is sent)"),
    ("check_update", "{}"),
    ("install_update", "{}"),
    ("scan_start", "{target: '' for your own network}"),
    ("scan_poll", "{}"),
    ("scan_cancel", "{}"),
    ("vpn_status", "{}"),
    ("vpn_import", "{name, text}"),
    ("vpn_set", "{name, on}"),
    ("vpn_job", "{}"),
    ("vpn_delete", "{name}"),
    ("vpn_update", "{name, text}"),
    ("vpn_read", "{name}"),
    ("vpn_log", "{name}"),
    ("vpn_set_option", "{name, killswitch}"),
    ("vpn_sync_list", "{}"),
    ("vpn_sync_read", "{name}"),
    ("vpn_sync_write", "{name, text}"),
    ("hotspot_status", "{}"),
    ("hotspot_save", "{ssid, password?}"),
    ("hotspot_prefs", "{publicAdapter, autoShare}"),
    ("hotspot_job", "{}"),
    ("hotspot_start", "{}"),
    ("hotspot_stop", "{}"),
    ("hotspot_devices", "{interfaceIp?}"),
    ("sharing_status", "{}"),
    ("sharing_adapters", "{}"),
    ("sharing_apply", "{public, private}"),
    ("sharing_reset", "{}"),
    ("get_settings", "{}"),
    ("set_settings", "{settings:{updateCheck, lastAdapter}}"),
    ("data_folder", "{}"),
];

fn arg<T: DeserializeOwned>(a: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(a.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("Argument `{k}` is missing or wrong: {e}"))
}

fn ser<T: Serialize>(v: T) -> Res {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// Runs one command by name. Same behaviour as the window calling it.
pub fn call(app: &AppHandle, cmd: &str, a: &Value) -> Res {
    match cmd {
        "list_adapters" => ser(capture::list_adapters()?),
        "start_capture" => ser(capture::start_capture(app.state(), arg(a, "adapter")?, arg(a, "filter")?)?),
        "poll_capture" => ser(capture::poll_capture(app.state())?),
        "stop_capture" => ser(capture::stop_capture(app.state())?),
        "replay_packet" => ser(capture::replay_packet(app.state(), arg(a, "id")?)?),
        "export_pcap" => ser(capture::export_pcap(app.state(), arg(a, "ids")?)?),
        "import_pcap" => ser(capture::import_pcap(app.state(), arg(a, "data")?)?),
        "get_filters" => filters::get_filters(app.clone()),
        "save_filters" => ser(filters::save_filters(app.clone(), arg(a, "filters")?)?),
        "get_store" => filters::get_store(app.clone(), arg(a, "name")?),
        "save_store" => ser(filters::save_store(app.clone(), arg(a, "name")?, arg(a, "value")?)?),
        "geo_lookup" => ser(geo::geo_lookup(arg(a, "ips")?)),
        "ip_details" => ser(ipinfo::ip_details(arg(a, "ips")?)?),
        "check_update" => ser(update::check_update(app.clone())),
        "install_update" => ser(update::install_update(app.clone())?),
        "scan_start" => ser(scan::scan_start(app.state(), arg(a, "target")?)?),
        "scan_poll" => ser(scan::scan_poll(app.state())?),
        "scan_cancel" => ser(scan::scan_cancel(app.state())?),
        "vpn_status" => ser(vpn::vpn_status(app.clone())?),
        "vpn_import" => ser(vpn::vpn_import(app.clone(), arg(a, "name")?, arg(a, "text")?)?),
        "vpn_set" => ser(vpn::vpn_set(app.clone(), app.state(), arg(a, "name")?, arg(a, "on")?)?),
        "vpn_job" => ser(vpn::vpn_job(app.state())),
        "vpn_delete" => ser(vpn::vpn_delete(app.clone(), arg(a, "name")?)?),
        "vpn_update" => ser(vpn::vpn_update(app.clone(), arg(a, "name")?, arg(a, "text")?)?),
        "vpn_read" => ser(vpn::vpn_read(app.clone(), arg(a, "name")?)?),
        "vpn_log" => ser(vpn::vpn_log(app.clone(), arg(a, "name")?)?),
        "vpn_set_option" => ser(vpn::vpn_set_option(app.clone(), arg(a, "name")?, arg(a, "killswitch")?)?),
        "vpn_sync_list" => ser(vpn::vpn_sync_list(app.clone())?),
        "vpn_sync_read" => ser(vpn::vpn_sync_read(app.clone(), arg(a, "name")?)?),
        "vpn_sync_write" => ser(vpn::vpn_sync_write(app.clone(), arg(a, "name")?, arg(a, "text")?)?),
        "hotspot_status" => ser(hotspot::hotspot_status(app.clone())?),
        "hotspot_save" => ser(hotspot::hotspot_save(app.clone(), arg(a, "ssid")?, arg(a, "password")?)?),
        "hotspot_prefs" => ser(hotspot::hotspot_prefs(app.clone(), arg(a, "publicAdapter")?, arg(a, "autoShare")?)?),
        "hotspot_job" => ser(hotspot::hotspot_job(app.state())),
        "hotspot_start" => ser(hotspot::hotspot_start(app.clone(), app.state())?),
        "hotspot_stop" => ser(hotspot::hotspot_stop(app.clone(), app.state())?),
        "hotspot_devices" => ser(hotspot::hotspot_devices(arg(a, "interfaceIp")?)?),
        "sharing_status" => ser(hotspot::sharing_status(app.clone())?),
        "sharing_adapters" => ser(hotspot::sharing_adapters()?),
        "sharing_apply" => ser(hotspot::sharing_apply(app.clone(), app.state(), arg(a, "public")?, arg(a, "private")?)?),
        "sharing_reset" => ser(hotspot::sharing_reset(app.clone(), app.state())?),
        "get_settings" => ser(settings::get_settings(app.clone())),
        "set_settings" => ser(settings::set_settings(app.clone(), arg(a, "settings")?)?),
        "data_folder" => ser(settings::data_folder(app.clone())?),
        other => Err(format!("Unknown command `{other}`. Run `eqnet commands` for the list.")),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn is_local(ip: &str) -> bool {
    match ip.parse::<IpAddr>() {
        Ok(IpAddr::V4(v)) => netaddr::is_local_v4(v),
        Ok(IpAddr::V6(v)) => netaddr::is_local_v6(v),
        Err(_) => false,
    }
}

// ---------- IP Storage (the same files the window uses) ----------

fn load_ips(app: &AppHandle) -> Result<Vec<Value>, String> {
    let v = call(app, "get_store", &json!({ "name": "ip-storage" }))?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

fn save_ips(app: &AppHandle, list: Vec<Value>, removed: &[String]) -> Result<(), String> {
    call(app, "save_store", &json!({ "name": "ip-storage", "value": list }))?;
    if !removed.is_empty() {
        let mut dead = call(app, "get_store", &json!({ "name": "ip-storage-deleted" }))?;
        if !dead.is_object() {
            dead = json!({});
        }
        for a in removed {
            dead[a] = json!(now_ms());
        }
        call(app, "save_store", &json!({ "name": "ip-storage-deleted", "value": dead }))?;
    }
    Ok(())
}

fn ip_labels(app: &AppHandle) -> HashMap<String, String> {
    load_ips(app)
        .unwrap_or_default()
        .iter()
        .filter_map(|e| Some((e.get("address")?.as_str()?.to_string(), e.get("note")?.as_str()?.to_string())))
        .filter(|(_, n)| !n.is_empty())
        .collect()
}

/// One label keeps at most this many addresses; a new one replaces the oldest. Returns the addresses dropped.
const LABEL_IPS_MAX: usize = 3;

fn cap_label(list: &mut Vec<Value>, label: &str, newest: &str) -> Vec<String> {
    if label.is_empty() {
        return vec![];
    }
    let mut same: Vec<(String, u64)> = list
        .iter()
        .filter(|e| e["note"].as_str() == Some(label))
        .filter_map(|e| Some((e["address"].as_str()?.to_string(), if e["address"].as_str()? == newest { u64::MAX } else { e["updatedAt"].as_u64().or(e["createdAt"].as_u64()).unwrap_or(0) })))
        .collect();
    if same.len() <= LABEL_IPS_MAX {
        return vec![];
    }
    same.sort_by(|a, b| b.1.cmp(&a.1));
    let drop: Vec<String> = same.into_iter().skip(LABEL_IPS_MAX).map(|(a, _)| a).collect();
    list.retain(|e| !drop.iter().any(|d| e["address"].as_str() == Some(d)));
    drop
}

/// Adds or relabels one address. Returns "added" or "updated".
fn ip_put(app: &AppHandle, address: &str, label: Option<&str>) -> Result<&'static str, String> {
    if address.parse::<IpAddr>().is_err() {
        return Err(format!("`{address}` is not an IP address."));
    }
    let mut list = load_ips(app)?;
    let t = now_ms();
    if let Some(e) = list.iter_mut().find(|e| e.get("address").and_then(Value::as_str) == Some(address)) {
        if let Some(l) = label {
            e["note"] = json!(l.chars().take(500).collect::<String>());
            e["updatedAt"] = json!(t);
        }
        let removed = cap_label(&mut list, label.unwrap_or(""), address);
        save_ips(app, list, &removed)?;
        return Ok("updated");
    }
    list.push(json!({ "id": format!("cli-{t}-{}", list.len()), "address": address, "note": label.unwrap_or("").chars().take(500).collect::<String>(), "createdAt": t, "updatedAt": t }));
    let removed = cap_label(&mut list, label.unwrap_or(""), address);
    save_ips(app, list, &removed)?;
    Ok("added")
}

// ---------- capture ----------

#[derive(Default)]
struct Seen {
    packets: u64,
    inbound: u64,
    outbound: u64,
    bytes: u64,
    first: f64,
    last: f64,
    protocols: BTreeSet<String>,
    ports: BTreeSet<u16>,
}

/// Runs a capture for `seconds` and lists the addresses that really talked to this computer.
fn capture_ips(app: &AppHandle, o: &Opts) -> Res {
    let seconds: u64 = o.num("seconds", 30);
    let min: u64 = o.num("min", 3);
    let want_port: Option<u16> = o.get("port").and_then(|p| p.parse().ok());
    let adapter = match o.get("adapter") {
        Some(a) => a.to_string(),
        None => {
            let st = settings::get_settings(app.clone());
            let list = capture::list_adapters()?;
            st.last_adapter
                .filter(|n| list.iter().any(|a| &a.name == n))
                .or_else(|| list.iter().find(|a| a.connected).map(|a| a.name.clone()))
                .or_else(|| list.first().map(|a| a.name.clone()))
                .ok_or("No network adapter found. Is Npcap installed?")?
        }
    };
    capture::start_capture(app.state(), adapter.clone(), None)?;
    eprintln!("Capturing on {adapter} for {seconds} s...");
    let mut book: HashMap<String, Seen> = HashMap::new();
    let mut end_time = 0f64;
    let mut take = |rows: Vec<crate::packet::PacketRow>| {
        for r in rows {
            let out = is_local(&r.src);
            let far = if out { &r.dst } else { &r.src };
            let e = book.entry(far.clone()).or_default();
            if e.packets == 0 {
                e.first = r.time;
            }
            e.packets += 1;
            e.bytes += r.length as u64;
            if out {
                e.outbound += 1;
            } else {
                e.inbound += 1;
            }
            e.last = e.last.max(r.time);
            end_time = end_time.max(r.time);
            e.protocols.insert(r.protocol.clone());
            for p in [r.src_port, r.dst_port].into_iter().flatten() {
                if p < 49152 && e.ports.len() < 40 {
                    e.ports.insert(p);
                }
            }
        }
    };
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(seconds) {
        std::thread::sleep(Duration::from_millis(400));
        let p = capture::poll_capture(app.state())?;
        take(p.rows);
        if let Some(e) = p.error {
            let _ = capture::stop_capture(app.state());
            return Err(e);
        }
        if !p.running {
            break;
        }
    }
    take(capture::stop_capture(app.state())?);

    let labels = ip_labels(app);
    let mut rows: Vec<(String, Seen)> = book
        .into_iter()
        .filter(|(a, s)| !is_local(a) && (o.flag("all") || (s.inbound >= min && s.outbound >= min)) && want_port.map_or(true, |p| s.ports.contains(&p)))
        .collect();
    rows.sort_by(|a, b| b.1.packets.cmp(&a.1.packets));
    let addrs: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
    let countries = geo::geo_lookup(addrs.clone());
    let details: HashMap<String, ipinfo::IpDetails> = if o.flag("lookup") && !addrs.is_empty() {
        ipinfo::ip_details(addrs.clone())?.into_iter().map(|d| (d.address.clone(), d)).collect()
    } else {
        HashMap::new()
    };
    let out: Vec<Value> = rows
        .iter()
        .map(|(a, s)| {
            let mut v = json!({
                "address": a,
                "label": labels.get(a).cloned().unwrap_or_default(),
                "country": countries.get(a).map(|c| c.name.clone()).unwrap_or_default(),
                "countryCode": countries.get(a).map(|c| c.code.clone()).unwrap_or_default(),
                "protocols": s.protocols,
                "ports": s.ports,
                "packets": s.packets, "inbound": s.inbound, "outbound": s.outbound, "bytes": s.bytes,
                "online": end_time - s.last <= 15.0,
                "secondsSeen": (s.last - s.first).max(0.0).round(),
            });
            if let Some(d) = details.get(a) {
                v["city"] = json!(d.city);
                v["region"] = json!(d.region);
                v["isp"] = json!(d.isp);
                v["vpn"] = json!(d.vpn);
            }
            v
        })
        .collect();
    Ok(Value::Array(out))
}

fn print_ip_table(rows: &Value) {
    let Some(list) = rows.as_array() else { return };
    if list.is_empty() {
        println!("No active addresses found. Use --all to include addresses that did not talk both ways, or capture longer.");
        return;
    }
    println!("{:<2} {:<40} {:<18} {:<14} {:<8} {:<14} {:>9}  {}", "", "IP", "Label", "Country", "Type", "Port", "In/out", "Details");
    for r in list {
        let s = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let join = |k: &str| r.get(k).and_then(Value::as_array).map(|a| a.iter().map(|x| x.to_string().trim_matches('"').to_string()).take(3).collect::<Vec<_>>().join(",")).unwrap_or_default();
        let dot = if r.get("online").and_then(Value::as_bool).unwrap_or(false) { "+" } else { "-" };
        let mut extra = vec![];
        for k in ["city", "isp"] {
            if !s(k).is_empty() {
                extra.push(s(k));
            }
        }
        if r.get("vpn").and_then(Value::as_bool) == Some(true) {
            extra.push("VPN/hosting".into());
        }
        println!(
            "{:<2} {:<40} {:<18} {:<14} {:<8} {:<14} {:>9}  {}",
            dot,
            s("address"),
            s("label"),
            s("country"),
            join("protocols").replace(',', "/"),
            join("ports"),
            format!("{}/{}", r["inbound"], r["outbound"]),
            extra.join(" | ")
        );
    }
    println!("(+ online = a packet in the last 15 s, - offline)");
}

// ---------- argument handling ----------

pub struct Opts {
    pub pos: Vec<String>,
    flags: HashMap<String, String>,
}

impl Opts {
    fn parse(args: &[String]) -> Opts {
        let mut pos = vec![];
        let mut flags = HashMap::new();
        let mut i = 0;
        while i < args.len() {
            if let Some(k) = args[i].strip_prefix("--") {
                if let Some((k, v)) = k.split_once('=') {
                    flags.insert(k.to_string(), v.to_string());
                } else if i + 1 < args.len() && !args[i + 1].starts_with("--") && !BOOL_FLAGS.contains(&k) {
                    flags.insert(k.to_string(), args[i + 1].clone());
                    i += 1;
                } else {
                    flags.insert(k.to_string(), "true".into());
                }
            } else {
                pos.push(args[i].clone());
            }
            i += 1;
        }
        Opts { pos, flags }
    }
    fn get(&self, k: &str) -> Option<&str> {
        self.flags.get(k).map(String::as_str)
    }
    fn flag(&self, k: &str) -> bool {
        self.flags.get(k).map_or(false, |v| v != "false")
    }
    fn num<T: std::str::FromStr>(&self, k: &str, d: T) -> T {
        self.get(k).and_then(|v| v.parse().ok()).unwrap_or(d)
    }
    fn p(&self, i: usize) -> Result<&str, String> {
        self.pos.get(i).map(String::as_str).ok_or_else(|| "Missing argument. Run `eqnet help`.".to_string())
    }
}

const BOOL_FLAGS: &[&str] = &["json", "all", "lookup", "yes"];

const HELP: &str = "EqNetwork command line (eqnet). Same data and engines as the window.

USAGE: eqnet <command> [arguments] [--json]

Capture and IPs
  capture [--seconds 30] [--adapter NAME] [--port 9305] [--min 5] [--all] [--lookup]
                          Capture, then list the public addresses that talked both ways.
                          --lookup adds city, ISP and VPN flag (from local databases).
  adapters                List capture adapters.
  ips                     List IP Storage.     ips add <ip> [label]   ips label <ip> <label>   ips remove <ip>
  lookup <ip...>          Country (offline) for each address; add --details for city/ISP/VPN (local).
  minecraft-log <file...> Label addresses with player names from a server log (latest.log).

Network and devices
  scan [cidr]             Scan your own network for devices and open ports (blocks until done).
  hotspot status|start|stop|devices|save <ssid> [password]
  sharing status|adapters|apply <public> <private>|reset

VPN (WireGuard)
  vpn list | import <name> <file.conf> | up <name> | down <name> | delete <name>
  vpn log <name> | read <name> | killswitch <name> on|off

Filters, settings, data
  filters list | on <name> | off <name> | set <file.json>
  settings get | update-check on|off
  backup export <file.json> | backup import <file.json>
  update check | update install
  folder                  Print the data folder.

Raw access
  commands                List every command `call` accepts.
  call <command> ['{json}']   Run any command by name; arguments are a JSON object.

Global: --json prints JSON (default is a readable table for capture, JSON elsewhere).
Exit code: 0 ok, 1 error (message on stderr), 2 bad usage.
Not in the command line: account sign-in, sync and the shared library (they live in the window).
Guide for AIs: docs/AI-GUIDE.md in the repository.";

fn wait_job(app: &AppHandle, which: &str, secs: u64) -> Result<(), String> {
    let t = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let job = call(app, which, &json!({}))?;
        if job["running"] != json!(true) {
            if let Some(e) = job["error"].as_str() {
                return Err(e.to_string());
            }
            if let Some(w) = job["warning"].as_str() {
                eprintln!("Warning: {w}");
            }
            if let Some(n) = job["note"].as_str() {
                eprintln!("{n}");
            }
            return Ok(());
        }
        if t.elapsed() > Duration::from_secs(secs) {
            return Err("Timed out waiting for Windows. Check `status` and try again.".into());
        }
    }
}

fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Could not read {path}: {e}"))
}

fn filters_list(app: &AppHandle) -> Result<Vec<Value>, String> {
    Ok(call(app, "get_filters", &json!({}))?.as_array().cloned().unwrap_or_default())
}

/// The dispatcher for the short forms.
fn run_command(app: &AppHandle, cmd: &str, o: &Opts) -> Result<Option<Value>, String> {
    let c = |name: &str, args: Value| call(app, name, &args);
    let some = |v: Value| Ok(Some(v));
    match cmd {
        "commands" => some(json!(COMMANDS.iter().map(|(n, a)| json!({ "command": n, "arguments": a })).collect::<Vec<_>>())),
        "call" => {
            let args: Value = match o.pos.get(1) {
                Some(t) => serde_json::from_str(t).map_err(|e| format!("The arguments are not valid JSON: {e}"))?,
                None => json!({}),
            };
            some(call(app, o.p(0)?, &args)?)
        }
        "folder" => some(c("data_folder", json!({}))?),
        "adapters" => some(c("list_adapters", json!({}))?),
        "capture" => some(capture_ips(app, o)?),
        "ips" => match o.pos.first().map(String::as_str) {
            None | Some("list") => some(Value::Array(load_ips(app)?)),
            Some("add") => some(json!({ "result": ip_put(app, o.p(1)?, o.pos.get(2).map(String::as_str))? })),
            Some("label") => some(json!({ "result": ip_put(app, o.p(1)?, Some(o.p(2)?))? })),
            Some("remove") => {
                let a = o.p(1)?.to_string();
                let list = load_ips(app)?;
                let keep: Vec<Value> = list.iter().filter(|e| e["address"].as_str() != Some(&a)).cloned().collect();
                if keep.len() == list.len() {
                    return Err(format!("{a} is not in IP Storage."));
                }
                save_ips(app, keep, &[a.clone()])?;
                some(json!({ "result": "removed", "address": a }))
            }
            _ => Err("Use: ips [list] | add <ip> [label] | label <ip> <label> | remove <ip>".into()),
        },
        "lookup" => {
            let ips: Vec<String> = o.pos.clone();
            if ips.is_empty() {
                return Err("Give at least one IP address.".into());
            }
            let geo = geo::geo_lookup(ips.clone());
            let mut out = vec![];
            let details: HashMap<String, ipinfo::IpDetails> =
                if o.flag("details") { ipinfo::ip_details(ips.clone())?.into_iter().map(|d| (d.address.clone(), d)).collect() } else { HashMap::new() };
            let labels = ip_labels(app);
            for ip in ips {
                let mut v = json!({ "address": ip, "label": labels.get(&ip).cloned().unwrap_or_default(), "country": geo.get(&ip).map(|c| c.name.clone()), "countryCode": geo.get(&ip).map(|c| c.code.clone()) });
                if let Some(d) = details.get(&ip) {
                    v["city"] = json!(d.city);
                    v["region"] = json!(d.region);
                    v["isp"] = json!(d.isp);
                    v["vpn"] = json!(d.vpn);
                }
                out.push(v);
            }
            some(Value::Array(out))
        }
        "minecraft-log" => {
            if o.pos.is_empty() {
                return Err("Give the path of latest.log (or several logs).".into());
            }
            let mut merged: std::collections::BTreeMap<String, BTreeSet<String>> = Default::default();
            for f in &o.pos {
                for (ip, name) in parse_minecraft(&read_file(f)?) {
                    merged.entry(ip).or_default().insert(name);
                }
            }
            let (mut added, mut labelled, mut kept) = (0, 0, 0);
            let mut list = load_ips(app)?;
            let t = now_ms();
            let mut dropped: Vec<String> = vec![];
            for (ip, names) in &merged {
                let label = names.iter().cloned().collect::<Vec<_>>().join(" / ");
                match list.iter_mut().find(|e| e["address"].as_str() == Some(ip)) {
                    None => {
                        list.push(json!({ "id": format!("cli-{t}-{}", list.len()), "address": ip, "note": label, "createdAt": t, "updatedAt": t }));
                        added += 1;
                    }
                    Some(e) if e["note"].as_str().unwrap_or("").is_empty() => {
                        e["note"] = json!(label);
                        e["updatedAt"] = json!(t);
                        labelled += 1;
                    }
                    Some(_) => kept += 1,
                }
                dropped.extend(cap_label(&mut list, &label, ip));
            }
            save_ips(app, list, &dropped)?;
            some(json!({ "replacedOldest": dropped.len(), "addresses": merged.len(), "added": added, "labelled": labelled, "keptExistingLabel": kept }))
        }
        "scan" => {
            c("scan_start", json!({ "target": o.pos.first().cloned().unwrap_or_default() }))?;
            loop {
                std::thread::sleep(Duration::from_millis(700));
                let p = c("scan_poll", json!({}))?;
                if p["running"] != json!(true) {
                    return some(p);
                }
            }
        }
        "hotspot" => match o.pos.first().map(String::as_str) {
            Some("status") | None => some(c("hotspot_status", json!({}))?),
            Some("start") => {
                c("hotspot_start", json!({}))?;
                wait_job(app, "hotspot_job", 180)?;
                some(c("hotspot_status", json!({}))?)
            }
            Some("stop") => {
                c("hotspot_stop", json!({}))?;
                wait_job(app, "hotspot_job", 120)?;
                some(c("hotspot_status", json!({}))?)
            }
            Some("devices") => some(c("hotspot_devices", json!({ "interfaceIp": o.pos.get(1) }))?),
            Some("save") => some(c("hotspot_save", json!({ "ssid": o.p(1)?, "password": o.pos.get(2) }))?),
            _ => Err("Use: hotspot status | start | stop | devices | save <ssid> [password]".into()),
        },
        "sharing" => match o.pos.first().map(String::as_str) {
            Some("status") | None => some(c("sharing_status", json!({}))?),
            Some("adapters") => some(c("sharing_adapters", json!({}))?),
            Some("apply") => {
                c("sharing_apply", json!({ "public": o.p(1)?, "private": o.p(2)? }))?;
                wait_job(app, "hotspot_job", 120)?;
                some(c("sharing_status", json!({}))?)
            }
            Some("reset") => {
                c("sharing_reset", json!({}))?;
                wait_job(app, "hotspot_job", 120)?;
                some(c("sharing_status", json!({}))?)
            }
            _ => Err("Use: sharing status | adapters | apply <public> <private> | reset".into()),
        },
        "vpn" => match o.pos.first().map(String::as_str) {
            Some("list") | Some("status") | None => some(c("vpn_status", json!({}))?),
            Some("import") => some(c("vpn_import", json!({ "name": o.p(1)?, "text": read_file(o.p(2)?)? }))?),
            Some(w @ ("up" | "down")) => {
                c("vpn_set", json!({ "name": o.p(1)?, "on": w == "up" }))?;
                wait_job(app, "vpn_job", 90)?;
                some(c("vpn_status", json!({}))?)
            }
            Some("delete") => some(c("vpn_delete", json!({ "name": o.p(1)? }))?),
            Some("log") => some(c("vpn_log", json!({ "name": o.p(1)? }))?),
            Some("read") => some(c("vpn_read", json!({ "name": o.p(1)? }))?),
            Some("killswitch") => some(c("vpn_set_option", json!({ "name": o.p(1)?, "killswitch": o.p(2)? == "on" }))?),
            _ => Err("Use: vpn list | import <name> <file> | up <name> | down <name> | delete <name> | log <name> | read <name> | killswitch <name> on|off".into()),
        },
        "filters" => match o.pos.first().map(String::as_str) {
            Some("list") | None => some(Value::Array(filters_list(app)?)),
            Some(w @ ("on" | "off")) => {
                let name = o.p(1)?;
                let mut list = filters_list(app)?;
                let f = list.iter_mut().find(|f| f["name"].as_str() == Some(name)).ok_or_else(|| format!("No filter named `{name}`."))?;
                f["enabled"] = json!(w == "on");
                c("save_filters", json!({ "filters": list }))?;
                some(json!({ "filter": name, "enabled": w == "on" }))
            }
            Some("set") => {
                let v: Value = serde_json::from_str(&read_file(o.p(1)?)?).map_err(|e| format!("Not valid JSON: {e}"))?;
                some(c("save_filters", json!({ "filters": v }))?)
            }
            _ => Err("Use: filters list | on <name> | off <name> | set <file.json>".into()),
        },
        "settings" => match o.pos.first().map(String::as_str) {
            Some("get") | None => some(c("get_settings", json!({}))?),
            Some("update-check") => {
                let mut s = c("get_settings", json!({}))?;
                s["updateCheck"] = json!(o.p(1)? == "on");
                some(c("set_settings", json!({ "settings": s }))?)
            }
            _ => Err("Use: settings get | update-check on|off".into()),
        },
        "update" => match o.pos.first().map(String::as_str) {
            Some("install") => some(c("install_update", json!({}))?),
            _ => some(c("check_update", json!({}))?),
        },
        "backup" => match o.pos.first().map(String::as_str) {
            Some("export") => {
                let mut tunnels = vec![];
                for t in vpn::vpn_sync_list(app.clone())? {
                    tunnels.push(json!({ "name": t.name, "text": vpn::vpn_sync_read(app.clone(), t.name.clone())? }));
                }
                let doc = json!({ "kind": "eqnetwork-backup", "version": 1, "exportedAt": now_ms(), "ips": load_ips(app)?, "filters": filters_list(app)?, "tunnels": tunnels });
                std::fs::write(o.p(1)?, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                some(json!({ "wrote": o.p(1)?, "ips": doc["ips"].as_array().map(Vec::len), "filters": doc["filters"].as_array().map(Vec::len), "tunnels": doc["tunnels"].as_array().map(Vec::len) }))
            }
            Some("import") => {
                let doc: Value = serde_json::from_str(&read_file(o.p(1)?)?).map_err(|_| "That file is not an EqNetwork backup.".to_string())?;
                if doc["kind"] != json!("eqnetwork-backup") {
                    return Err("That file is not an EqNetwork backup.".into());
                }
                let t = now_ms();
                let (mut ips, mut flt, mut tun, mut skipped) = (0, 0, 0, 0);
                let mut list = load_ips(app)?;
                for e in doc["ips"].as_array().cloned().unwrap_or_default() {
                    let Some(a) = e["address"].as_str() else { continue };
                    if list.iter().any(|x| x["address"].as_str() == Some(a)) {
                        skipped += 1;
                    } else {
                        list.push(json!({ "id": format!("cli-{t}-{}", list.len()), "address": a, "note": e["note"].as_str().unwrap_or(""), "createdAt": e["createdAt"].as_u64().unwrap_or(t), "updatedAt": t }));
                        ips += 1;
                    }
                }
                save_ips(app, list, &[])?;
                let mut have = filters_list(app)?;
                for (i, mut f) in doc["filters"].as_array().cloned().unwrap_or_default().into_iter().enumerate() {
                    if have.iter().any(|x| x["name"] == f["name"]) {
                        skipped += 1;
                        continue;
                    }
                    f["id"] = json!(format!("cli-{t}-f{i}"));
                    f["enabled"] = json!(false);
                    have.push(f);
                    flt += 1;
                }
                c("save_filters", json!({ "filters": have }))?;
                let names: BTreeSet<String> = vpn::vpn_sync_list(app.clone())?.into_iter().map(|t| t.name).collect();
                for tn in doc["tunnels"].as_array().cloned().unwrap_or_default() {
                    let (Some(n), Some(text)) = (tn["name"].as_str(), tn["text"].as_str()) else { continue };
                    if names.contains(n) {
                        skipped += 1;
                    } else if vpn::vpn_sync_write(app.clone(), n.to_string(), text.to_string()).is_ok() {
                        tun += 1;
                    }
                }
                some(json!({ "ipsAdded": ips, "filtersAdded": flt, "tunnelsAdded": tun, "alreadyHere": skipped }))
            }
            _ => Err("Use: backup export <file.json> | backup import <file.json>".into()),
        },
        _ => Ok(None),
    }
}

/// `Name[/1.2.3.4:5555] logged in` style lines from a Java server log. Local addresses are skipped.
fn parse_minecraft(text: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    for line in text.lines() {
        let mut rest = line;
        while let Some(i) = rest.find("[/") {
            let before = &rest[..i];
            let name: String = before.chars().rev().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
            let after = &rest[i + 2..];
            let Some(j) = after.find(']') else { break };
            let inner = &after[..j];
            if let Some((addr, port)) = inner.rsplit_once(':') {
                if !name.is_empty() && name.len() <= 32 && port.chars().all(|c| c.is_ascii_digit()) && !is_local(addr) && addr.parse::<IpAddr>().is_ok() {
                    out.push((addr.to_string(), name));
                }
            }
            rest = &after[j..];
        }
    }
    out
}

/// Entry point for `eqnet.exe`. Returns the process exit code.
pub fn main(args: Vec<String>) -> i32 {
    if args.len() == 3 && args[0] == "--vpn-run" {
        return crate::vpnengine::run(&args[1], &args[2]);
    }
    let json_out = args.iter().any(|a| a == "--json");
    let args: Vec<String> = args.into_iter().filter(|a| a != "--json").collect();
    let Some(cmd) = args.first().cloned() else {
        println!("{HELP}");
        return 2;
    };
    if matches!(cmd.as_str(), "help" | "--help" | "-h") {
        println!("{HELP}");
        return 0;
    }
    if matches!(cmd.as_str(), "version" | "--version") {
        println!("eqnet {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
    ctx.config_mut().identifier = "app.networktoolkit.desktop".into();
    let built = crate::manage_state(tauri::Builder::<tauri::Wry>::new()).build(ctx);
    let app = match built {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Could not start: {e}");
            return 1;
        }
    };
    let handle = app.handle().clone();
    if let Ok(dir) = handle.path().app_data_dir() {
        ipinfo::init(dir.join("ipdb"), false);
    }
    let opts = Opts::parse(&args[1..]);
    match run_command(&handle, &cmd, &opts) {
        Ok(Some(v)) => {
            if cmd == "capture" && !json_out {
                print_ip_table(&v);
            } else {
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            }
            0
        }
        Ok(None) => {
            eprintln!("Unknown command `{cmd}`. Run `eqnet help`.");
            2
        }
        Err(e) => {
            eprintln!("Error: {e}");
            1
        }
    }
}
