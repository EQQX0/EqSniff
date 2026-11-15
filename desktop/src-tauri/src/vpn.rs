//! A tunnel manager in the style of the WireGuard app. It does not carry traffic itself: it keeps your tunnel
//! files and starts and stops them through the official WireGuard for Windows, which must be installed.
//! The private key stays in the saved file and is never sent back to the window or written to a log.

use crate::vpnconf::{self, Config};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerView {
    pub public_key: String,
    pub has_preshared_key: bool,
    pub allowed_ips: Vec<String>,
    pub endpoint: Option<String>,
    pub keepalive: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub name: String,
    pub active: bool,
    pub public_key: Option<String>,
    pub addresses: Vec<String>,
    pub dns: Vec<String>,
    pub mtu: Option<u16>,
    pub listen_port: Option<u16>,
    pub full_tunnel: bool,
    pub peers: Vec<PeerView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnStatus {
    pub installed: bool,
    pub tunnels: Vec<Tunnel>,
}

fn wireguard_dir() -> Option<PathBuf> {
    ["ProgramFiles", "ProgramW6432"]
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .map(|p| PathBuf::from(p).join("WireGuard"))
        .find(|d| d.join("wireguard.exe").is_file() && d.join("wg.exe").is_file())
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vpn");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !vpnconf::valid_name(name) {
        return Err("Tunnel names use letters, numbers and _ = + . - only, up to 32 characters.".into());
    }
    Ok(folder(app)?.join(format!("{name}.conf")))
}

fn is_running(name: &str) -> bool {
    Command::new("sc.exe")
        .args(["query", &format!("WireGuardTunnel${name}")])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
        .unwrap_or(false)
}

/// Asks WireGuard's own tool for the public key that belongs to the private key. The key goes in on stdin only.
fn public_key(dir: &Path, private: &str) -> Option<String> {
    let mut child = Command::new(dir.join("wg.exe"))
        .arg("pubkey")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
        .ok()?;
    child.stdin.take()?.write_all(private.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    let k = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (k.len() == 44).then_some(k)
}

fn view(name: &str, c: &Config, wg: Option<&Path>) -> Tunnel {
    Tunnel {
        name: name.to_string(),
        active: is_running(name),
        public_key: wg.and_then(|d| public_key(d, &c.private_key)),
        addresses: c.addresses.clone(),
        dns: c.dns.clone(),
        mtu: c.mtu,
        listen_port: c.listen_port,
        full_tunnel: c.peers.iter().any(|p| p.allowed_ips.iter().any(|a| a == "0.0.0.0/0" || a == "::/0")),
        peers: c
            .peers
            .iter()
            .map(|p| PeerView {
                public_key: p.public_key.clone(),
                has_preshared_key: p.preshared_key.is_some(),
                allowed_ips: p.allowed_ips.clone(),
                endpoint: p.endpoint.clone(),
                keepalive: p.keepalive,
            })
            .collect(),
    }
}

/// Runs a WireGuard command with administrator rights. Windows shows its own permission prompt.
fn elevated(wireguard: &Path, verb: &str, target: &str) -> Result<(), String> {
    let q = |s: &str| s.replace('\'', "''");
    let script = format!(
        "$p = Start-Process -FilePath '{}' -ArgumentList '{} \"{}\"' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode",
        q(&wireguard.display().to_string()),
        verb,
        q(target)
    );
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err("Windows did not give permission, or WireGuard refused the request. Press Allow on the Windows prompt and try again.".into())
    }
}

fn wait_for(name: &str, want: bool) -> bool {
    for _ in 0..25 {
        if is_running(name) == want {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn status_blocking(app: &AppHandle) -> Result<VpnStatus, String> {
    let wg = wireguard_dir();
    let mut tunnels = Vec::new();
    for e in fs::read_dir(folder(app)?).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let Some(name) = p.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if p.extension().and_then(|s| s.to_str()) != Some("conf") || !vpnconf::valid_name(&name) {
            continue;
        }
        if let Ok(c) = fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|t| vpnconf::parse(&t)) {
            tunnels.push(view(&name, &c, wg.as_deref()));
        }
    }
    tunnels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(VpnStatus { installed: wg.is_some(), tunnels })
}

/// The start or stop that is running in the background (it waits for the Windows permission prompt).
#[derive(Default, Clone)]
pub struct VpnState(Arc<Mutex<Job>>);

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub running: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn vpn_status(app: AppHandle) -> Result<VpnStatus, String> {
    status_blocking(&app)
}

#[tauri::command]
pub fn vpn_import(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = file(&app, &name)?;
    if path.exists() {
        return Err(format!("A tunnel named {name} already exists. Delete it first or choose another name."));
    }
    let cfg = vpnconf::parse(&text)?;
    let tmp = path.with_extension("conf.tmp");
    fs::write(&tmp, vpnconf::render(&cfg)).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn switch(path: PathBuf, name: String, on: bool) -> Result<(), String> {
    let wg = wireguard_dir().ok_or("WireGuard for Windows is not installed.")?;
    if on {
        if !path.exists() {
            return Err("That tunnel no longer exists.".into());
        }
        if is_running(&name) {
            return Ok(());
        }
        elevated(&wg.join("wireguard.exe"), "/installtunnelservice", &path.display().to_string())?;
        if !wait_for(&name, true) {
            return Err("WireGuard was asked to start the tunnel but it did not come up. Check the tunnel in the WireGuard app for details.".into());
        }
    } else {
        if !is_running(&name) {
            return Ok(());
        }
        elevated(&wg.join("wireguard.exe"), "/uninstalltunnelservice", &name)?;
        if !wait_for(&name, false) {
            return Err("The tunnel did not stop. Try again or stop it in the WireGuard app.".into());
        }
    }
    Ok(())
}

/// Returns at once. The work runs on its own thread; the window asks `vpn_job` how it is going.
#[tauri::command]
pub fn vpn_set(app: AppHandle, state: State<VpnState>, name: String, on: bool) -> Result<(), String> {
    let path = file(&app, &name)?;
    let job = state.0.clone();
    {
        let mut j = job.lock().map_err(|_| "busy")?;
        if j.running {
            return Err("Another change is still waiting for Windows permission.".into());
        }
        *j = Job { running: true, error: None };
    }
    std::thread::spawn(move || {
        let result = switch(path, name, on);
        if let Ok(mut j) = job.lock() {
            *j = Job { running: false, error: result.err() };
        }
    });
    Ok(())
}

#[tauri::command]
pub fn vpn_job(state: State<VpnState>) -> Job {
    state.0.lock().map(|j| j.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn vpn_delete(app: AppHandle, name: String) -> Result<(), String> {
    let path = file(&app, &name)?;
    if is_running(&name) {
        return Err("Turn the tunnel off before deleting it.".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}
