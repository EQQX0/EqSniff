//! A tunnel manager in the style of the WireGuard app, with its own WireGuard engine built in (see vpnengine.rs).
//! The private key stays in the saved file and is never sent back to the window or written to a log.

use crate::vpnconf::{self, Config};
use crate::vpnengine;
use serde::Serialize;
use std::{
    fs,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    time::Duration,
};
use std::sync::{Arc, Mutex};
use std::thread;
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
    pub killswitch: bool,
    pub peers: Vec<PeerView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnStatus {
    pub installed: bool,
    pub tunnels: Vec<Tunnel>,
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

/// The process id the engine wrote to its state file, if the file says it is starting or up.
fn engine_pid(dir: &std::path::Path, name: &str) -> Option<u32> {
    let t = fs::read_to_string(vpnengine::state_path(dir, name)).ok()?;
    let (word, rest) = t.split_once(' ')?;
    if word != "up" && word != "starting" {
        return None;
    }
    rest.trim().parse().ok()
}

/// True when that process exists and is this program (so a recycled process id does not fool us).
fn is_our_process(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW};
    let Ok(me) = std::env::current_exe() else { return false };
    // SAFETY: plain Win32 calls on a handle we open and close here.
    unsafe {
        let h = OpenProcess(0x1000, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let alive = GetExitCodeProcess(h, &mut code) != 0 && code == 259;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let same = alive && QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0 && {
            let img = String::from_utf16_lossy(&buf[..len as usize]);
            img.eq_ignore_ascii_case(&me.display().to_string())
        };
        CloseHandle(h);
        same
    }
}

fn is_running(dir: &std::path::Path, name: &str) -> bool {
    engine_pid(dir, name).map(is_our_process).unwrap_or(false)
}

fn public_key(private: &str) -> Option<String> {
    vpnengine::public_key_of(private)
}

fn view(dir: &std::path::Path, name: &str, c: &Config) -> Tunnel {
    Tunnel {
        name: name.to_string(),
        active: is_running(dir, name),
        public_key: public_key(&c.private_key),
        addresses: c.addresses.clone(),
        dns: c.dns.clone(),
        mtu: c.mtu,
        listen_port: c.listen_port,
        killswitch: vpnengine::read_options(dir, name).killswitch,
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

fn status_blocking(app: &AppHandle) -> Result<VpnStatus, String> {
    let dir = folder(app)?;
    let mut tunnels = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let Some(name) = p.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if p.extension().and_then(|s| s.to_str()) != Some("conf") || !vpnconf::valid_name(&name) {
            continue;
        }
        if let Ok(c) = fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|t| vpnconf::parse(&t)) {
            tunnels.push(view(&dir, &name, &c));
        }
    }
    tunnels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(VpnStatus { installed: true, tunnels })
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
    save_conf(&path, &cfg)
}

/// Starts the engine in a second copy of this program with administrator rights. Windows shows its own prompt.
fn launch_elevated(dir: &std::path::Path, name: &str) -> Result<(), String> {
    let q = |s: &str| s.replace('\'', "''");
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = format!("--vpn-run \"{}\" {}", dir.display(), name);
    let script = format!(
        "Start-Process -FilePath '{}' -ArgumentList '{}' -Verb RunAs -WindowStyle Hidden",
        q(&exe.display().to_string()),
        q(&args)
    );
    let out = Command::new(vpnengine::powershell_exe())
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err("Windows did not give permission. Press Yes on the Windows prompt and try again.".into())
    }
}

fn switch(dir: PathBuf, name: String, on: bool) -> Result<(), String> {
    let state = vpnengine::state_path(&dir, &name);
    if on {
        if !dir.join(format!("{name}.conf")).exists() {
            return Err("That tunnel no longer exists.".into());
        }
        if is_running(&dir, &name) {
            return Ok(());
        }
        let _ = fs::remove_file(&state);
        launch_elevated(&dir, &name)?;
        for _ in 0..120 {
            if let Ok(t) = fs::read_to_string(&state) {
                if t.starts_with("up ") {
                    return Ok(());
                }
                if let Some(e) = t.strip_prefix("error ") {
                    let _ = fs::remove_file(&state);
                    return Err(e.to_string());
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
        Err("The tunnel did not come up in time. Check the log in the tunnel folder.".into())
    } else {
        if !is_running(&dir, &name) {
            let _ = fs::remove_file(&state);
            return Ok(());
        }
        fs::write(vpnengine::stop_path(&dir, &name), "stop").map_err(|e| e.to_string())?;
        for _ in 0..40 {
            if !is_running(&dir, &name) {
                let _ = fs::remove_file(vpnengine::stop_path(&dir, &name));
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }
        // Do not leave the stop file behind: the next Activate would see it and stop at once.
        let _ = fs::remove_file(vpnengine::stop_path(&dir, &name));
        Err("The tunnel did not stop. Try again.".into())
    }
}

/// Returns at once. The work runs on its own thread; the window asks `vpn_job` how it is going.
#[tauri::command]
pub fn vpn_set(app: AppHandle, state: State<VpnState>, name: String, on: bool) -> Result<(), String> {
    file(&app, &name)?;
    let dir = folder(&app)?;
    let job = state.0.clone();
    {
        let mut j = job.lock().map_err(|_| "busy")?;
        if j.running {
            return Err("Another change is still waiting for Windows permission.".into());
        }
        *j = Job { running: true, error: None };
    }
    std::thread::spawn(move || {
        let result = switch(dir, name, on);
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
    let dir = folder(&app)?;
    if is_running(&dir, &name) {
        return Err("Turn the tunnel off before deleting it.".into());
    }
    for ext in ["state", "stop", "log", "options"] {
        let _ = fs::remove_file(dir.join(format!("{name}.{ext}")));
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Writes the checked config to `path` through a temporary file.
fn save_conf(path: &std::path::Path, cfg: &Config) -> Result<(), String> {
    let tmp = path.with_extension("conf.tmp");
    fs::write(&tmp, vpnconf::render(cfg)).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The saved config for the edit box. The private key and preshared keys are replaced by a placeholder and never leaves this process.
#[tauri::command]
pub fn vpn_read(app: AppHandle, name: String) -> Result<String, String> {
    let path = file(&app, &name)?;
    let text = fs::read_to_string(&path).map_err(|_| "That tunnel no longer exists.".to_string())?;
    Ok(vpnengine::render_for_edit(&vpnconf::parse(&text)?))
}

/// Replaces the saved config of a tunnel that is off. If a key is still the placeholder, the stored key stays (preshared keys are matched by peer public key).
#[tauri::command]
pub fn vpn_update(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = file(&app, &name)?;
    let dir = folder(&app)?;
    if is_running(&dir, &name) {
        return Err("Turn the tunnel off before editing it.".into());
    }
    if text.len() > vpnconf::MAX_CONF_BYTES {
        return Err("That text is too large to be a WireGuard tunnel.".into());
    }
    let old = fs::read_to_string(&path).map_err(|_| "That tunnel no longer exists.".to_string())?;
    let stored = vpnconf::parse(&old)?;
    let cfg = vpnconf::parse(&vpnengine::fill_placeholders(&text, &stored))?;
    save_conf(&path, &cfg)
}

/// The last lines of the engine's log for this tunnel. The engine never writes keys to it.
#[tauri::command]
pub fn vpn_log(app: AppHandle, name: String) -> Result<String, String> {
    file(&app, &name)?;
    let dir = folder(&app)?;
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = fs::File::open(vpnengine::log_path(&dir, &name)) else { return Ok(String::new()) };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let take = len.min(64 * 1024);
    f.seek(SeekFrom::Start(len - take)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(take).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(vpnengine::tail_lines(&String::from_utf8_lossy(&buf), 200))
}

/// Saves per-tunnel options. They live in their own file, so a .conf can never switch them on or off.
#[tauri::command]
pub fn vpn_set_option(app: AppHandle, name: String, killswitch: bool) -> Result<(), String> {
    let path = file(&app, &name)?;
    let dir = folder(&app)?;
    if !path.exists() {
        return Err("That tunnel no longer exists.".into());
    }
    if is_running(&dir, &name) {
        return Err("Turn the tunnel off before changing this setting.".into());
    }
    fs::write(vpnengine::options_path(&dir, &name), vpnengine::render_options(vpnengine::Options { killswitch })).map_err(|e| e.to_string())
}
