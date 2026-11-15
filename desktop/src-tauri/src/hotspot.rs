//! Share this PC's internet with your own console or device.
//! Two ways: the Windows Mobile Hotspot (needs a Wi-Fi radio) and Windows internet connection sharing between two
//! adapters (works over Ethernet). Windows does the work; this file drives it through PowerShell 5.1.
//! The SSID and password reach PowerShell through environment variables, never inside the script text.
//! The password is stored in the app data folder and is never sent back to the window.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

const NO_WINDOW: u32 = 0x0800_0000;
/// Windows gives the private side of connection sharing and the Mobile Hotspot this address.
pub const DEFAULT_PRIVATE_IP: &str = "192.168.137.1";
pub const NO_WIFI_MESSAGE: &str = "This PC has no Wi-Fi adapter, so Windows cannot host a hotspot. You can still share internet over Ethernet with Sharing / Bridge.";

// ---------- pure logic (tested in tests/hotspot.rs) ----------

/// An SSID is 1 to 32 characters, no control characters, and at most 32 bytes on the air.
pub fn validate_ssid(s: &str) -> Result<(), String> {
    let n = s.chars().count();
    if n == 0 || n > 32 || s.len() > 32 {
        return Err("The hotspot name must be 1 to 32 characters.".into());
    }
    if s.chars().any(|c| c.is_control()) {
        return Err("The hotspot name cannot contain control characters.".into());
    }
    Ok(())
}

/// A WPA2 password is 8 to 63 printable ASCII characters.
pub fn validate_password(p: &str) -> Result<(), String> {
    if p.len() < 8 || p.len() > 63 {
        return Err("The password must be 8 to 63 characters.".into());
    }
    if !p.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Err("The password can use letters, numbers, spaces and common symbols only (no accents).".into());
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Neighbor {
    pub ip: String,
    pub mac: String,
}

/// Devices in the `arp -a` table that were learned on the interface with address `interface_ip`.
/// Skips static entries (broadcast, multicast), all-ones and multicast hardware addresses, and the interface's own address.
pub fn parse_arp(text: &str, interface_ip: &str) -> Vec<Neighbor> {
    let mut out = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Interface:") {
            inside = rest.split_whitespace().next() == Some(interface_ip);
            continue;
        }
        if !inside {
            continue;
        }
        let mut it = t.split_whitespace();
        let (Some(ip), Some(mac), Some(kind)) = (it.next(), it.next(), it.next()) else { continue };
        if !kind.eq_ignore_ascii_case("dynamic") || ip == interface_ip || ip.parse::<std::net::Ipv4Addr>().is_err() {
            continue;
        }
        let Some(mac) = normalize_mac(mac) else { continue };
        if mac == "FF:FF:FF:FF:FF:FF" || mac.starts_with("01:00:5E") || mac.starts_with("33:33") {
            continue;
        }
        out.push(Neighbor { ip: ip.to_string(), mac });
    }
    out
}

/// "aa-bb-cc-dd-ee-ff" or "aa:bb:..." to "AA:BB:CC:DD:EE:FF". None if it is not six pairs of hex digits.
pub fn normalize_mac(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split(|c| c == '-' || c == ':').collect();
    if parts.len() != 6 || parts.iter().any(|p| p.len() != 2 || !p.bytes().all(|b| b.is_ascii_hexdigit())) {
        return None;
    }
    Some(parts.iter().map(|p| p.to_ascii_uppercase()).collect::<Vec<_>>().join(":"))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    pub name: String,
    pub description: String,
    pub connected: bool,
    pub is_virtual: bool,
    pub ipv4: Option<String>,
}

/// PowerShell's ConvertTo-Json writes a single item as an object, several as an array, none as nothing.
pub fn json_items(text: &str) -> Result<Vec<Value>, String> {
    let t = text.trim().trim_start_matches('\u{feff}');
    if t.is_empty() {
        return Ok(vec![]);
    }
    match serde_json::from_str::<Value>(t).map_err(|_| "Windows gave an answer this app could not read.".to_string())? {
        Value::Array(a) => Ok(a),
        Value::Null => Ok(vec![]),
        v => Ok(vec![v]),
    }
}

pub fn parse_adapters(text: &str) -> Result<Vec<AdapterInfo>, String> {
    let mut out = Vec::new();
    for v in json_items(text)? {
        let Some(name) = v.get("name").and_then(Value::as_str) else { continue };
        out.push(AdapterInfo {
            name: name.to_string(),
            description: v.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
            connected: v.get("connected").and_then(Value::as_bool).unwrap_or(false),
            is_virtual: v.get("virtual").and_then(Value::as_bool).unwrap_or(false),
            ipv4: v.get("ipv4").and_then(Value::as_str).map(str::to_string),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Checks a request to share one adapter's internet through another. `sharing_on` is true when any connection already shares.
pub fn check_apply(public: &str, private: &str, adapters: &[AdapterInfo], sharing_on: bool) -> Result<(), String> {
    if public.is_empty() || private.is_empty() {
        return Err("Choose both a public and a private adapter.".into());
    }
    if public == private {
        return Err("The public and private adapter must be different.".into());
    }
    for n in [public, private] {
        if !adapters.iter().any(|a| a.name == n) {
            return Err(format!("The adapter \"{n}\" was not found. Refresh the list."));
        }
    }
    if sharing_on {
        return Err("Internet sharing is already on. Press Reset (or turn it off in Windows) before changing adapters.".into());
    }
    Ok(())
}

/// Adapter names go into a PowerShell script only after base64, but keep them sane anyway.
fn name_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 256 && !s.chars().any(|c| c.is_control())
}

// ---------- PowerShell plumbing ----------

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

fn encode_script(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Runs a script in PowerShell 5.1 and returns what it printed. `env` is for values that must not sit in the script text.
fn run_ps(script: &str, env: &[(&str, &str)]) -> Result<String, String> {
    let full = format!("$ProgressPreference='SilentlyContinue'\n$ErrorActionPreference='Stop'\n{script}");
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encode_script(&full)])
        .stdin(Stdio::null())
        .creation_flags(NO_WINDOW);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().map_err(|e| format!("Could not run PowerShell: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(text)
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        let first = err.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("#<")).unwrap_or("PowerShell failed.");
        Err(first.chars().take(300).collect())
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hotspot");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Common start of every elevated script: helpers to decode arguments and write the result file.
const ELEVATED_PRELUDE: &str = r#"
function D($s){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))}
function Done($o){[IO.File]::WriteAllText($out,($o|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))}
"#;

/// Runs `body` as administrator (Windows shows its own prompt) and returns the JSON the script wrote to `result`.
/// The script travels on the command line, not in a file, so there is nothing on disk to swap.
fn run_elevated(body: &str, result: &Path, args: &[(&str, String)]) -> Result<Value, String> {
    let _ = fs::remove_file(result);
    let mut script = String::from("$ErrorActionPreference='Stop'\n");
    script.push_str(&format!("$out=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))\n", b64(&result.display().to_string())));
    for (k, v) in args {
        script.push_str(&format!("${k}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))\n", b64(v)));
    }
    script.push_str(ELEVATED_PRELUDE);
    script.push_str(body);
    let outer = format!(
        "Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{}' -Verb RunAs -WindowStyle Hidden",
        encode_script(&script)
    );
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encode_script(&outer)])
        .stdin(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Windows did not give permission. Press Yes on the Windows prompt and try again.".into());
    }
    for _ in 0..200 {
        if let Ok(t) = fs::read_to_string(result) {
            if let Ok(v) = serde_json::from_str::<Value>(t.trim().trim_start_matches('\u{feff}')) {
                let _ = fs::remove_file(result);
                return Ok(v);
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err("Windows did not answer in time. Check the adapters in Windows network settings and try again.".into())
}

fn elevated_outcome(v: Value) -> Result<(), String> {
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(v.get("error").and_then(Value::as_str).unwrap_or("Windows refused the change.").to_string())
    }
}

// ---------- Windows Mobile Hotspot ----------

/// Loads the Windows Runtime types and defines `Await` for IAsyncOperation and `AwaitAction` for IAsyncAction.
const WINRT: &str = r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
$null=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
$null=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]
$ext=[System.WindowsRuntimeSystemExtensions]
$asOp=($ext.GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
$asAct=($ext.GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'})[0]
function Await($op,$type){$t=$asOp.MakeGenericMethod($type).Invoke($null,@($op));[void]$t.Wait(-1);$t.Result}
function AwaitAction($op){$t=$asAct.Invoke($null,@($op));[void]$t.Wait(-1)}
function WifiCount{@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue|Where-Object{$_.PhysicalMediaType -match '802\.11'}).Count}
function Mgr{
  $p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if(-not $p){throw 'This PC is not connected to the internet, so there is nothing to share.'}
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($p)
}
"#;

const STATUS_SCRIPT: &str = r#"
$wifi=(WifiCount) -gt 0
$state='unavailable';$clients=0;$note=''
if($wifi){
  try{
    $m=Mgr
    $state=([string]$m.TetheringOperationalState).ToLower()
    $clients=[int]$m.ClientCount
  }catch{$state='off';$note=$_.Exception.Message}
}
@{wifi=$wifi;state=$state;clients=$clients;note=$note}|ConvertTo-Json -Compress
"#;

const START_SCRIPT: &str = r#"
try{
  if((WifiCount) -eq 0){throw 'nowifi'}
  $m=Mgr
  $cfg=New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
  $cfg.Ssid=$env:NT_SSID
  $cfg.Passphrase=$env:NT_PASS
  AwaitAction ($m.ConfigureAccessPointAsync($cfg))
  $r=Await ($m.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  if([string]$r.Status -ne 'Success'){throw ('Windows could not start the hotspot ('+[string]$r.Status+'). '+[string]$r.AdditionalErrorMessage)}
  @{ok=$true}|ConvertTo-Json -Compress
}catch{
  @{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress
}
"#;

const STOP_SCRIPT: &str = r#"
try{
  $m=Mgr
  $r=Await ($m.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  if([string]$r.Status -ne 'Success'){throw ('Windows could not stop the hotspot ('+[string]$r.Status+'). '+[string]$r.AdditionalErrorMessage)}
  @{ok=$true}|ConvertTo-Json -Compress
}catch{
  @{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress
}
"#;

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    ssid: String,
    password: String,
}

fn read_saved(dir: &Path) -> Saved {
    fs::read_to_string(dir.join("hotspot.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotStatus {
    /// "on", "off", "intransition" or "unavailable" (no Wi-Fi adapter)
    pub state: String,
    pub clients: u32,
    pub wifi_available: bool,
    pub ssid: String,
    pub has_password: bool,
    pub message: Option<String>,
}

#[tauri::command]
pub fn hotspot_status(app: AppHandle) -> Result<HotspotStatus, String> {
    let saved = read_saved(&data_dir(&app)?);
    let out = run_ps(&format!("{WINRT}{STATUS_SCRIPT}"), &[])?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|_| "Windows gave an answer this app could not read.".to_string())?;
    let wifi = v.get("wifi").and_then(Value::as_bool).unwrap_or(false);
    let note = v.get("note").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    Ok(HotspotStatus {
        state: v.get("state").and_then(Value::as_str).unwrap_or("off").to_string(),
        clients: v.get("clients").and_then(Value::as_u64).unwrap_or(0) as u32,
        wifi_available: wifi,
        ssid: saved.ssid,
        has_password: !saved.password.is_empty(),
        message: if wifi { note } else { Some(NO_WIFI_MESSAGE.to_string()) },
    })
}

/// Saves the name and, when given, the password. An empty password keeps the one already saved.
#[tauri::command]
pub fn hotspot_save(app: AppHandle, ssid: String, password: Option<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    validate_ssid(&ssid)?;
    let mut saved = read_saved(&dir);
    match password.as_deref() {
        Some(p) if !p.is_empty() => {
            validate_password(p)?;
            saved.password = p.to_string();
        }
        _ if saved.password.is_empty() => return Err("Enter a password of 8 to 63 characters.".into()),
        _ => {}
    }
    saved.ssid = ssid;
    write_json(&dir.join("hotspot.json"), &saved)
}

/// One background job at a time for everything on this page. The window asks `hotspot_job` how it is going.
#[derive(Default, Clone)]
pub struct HotspotState(Arc<Mutex<Job>>);

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub running: bool,
    pub kind: String,
    pub error: Option<String>,
}

fn spawn_job(state: &HotspotState, kind: &str, work: impl FnOnce() -> Result<(), String> + Send + 'static) -> Result<(), String> {
    let job = state.0.clone();
    {
        let mut j = job.lock().map_err(|_| "busy")?;
        if j.running {
            return Err("Another change is still running. Wait for it to finish.".into());
        }
        *j = Job { running: true, kind: kind.to_string(), error: None };
    }
    let kind = kind.to_string();
    thread::spawn(move || {
        let result = work();
        if let Ok(mut j) = job.lock() {
            *j = Job { running: false, kind, error: result.err() };
        }
    });
    Ok(())
}

#[tauri::command]
pub fn hotspot_job(state: State<HotspotState>) -> Job {
    state.0.lock().map(|j| j.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn hotspot_start(app: AppHandle, state: State<HotspotState>) -> Result<(), String> {
    let saved = read_saved(&data_dir(&app)?);
    validate_ssid(&saved.ssid).map_err(|_| "Save a hotspot name and password first.".to_string())?;
    validate_password(&saved.password).map_err(|_| "Save a hotspot name and password first.".to_string())?;
    spawn_job(&state, "hotspot-start", move || {
        let script = format!("{WINRT}{START_SCRIPT}");
        let out = run_ps(&script, &[("NT_SSID", &saved.ssid), ("NT_PASS", &saved.password)])?;
        let v: Value = serde_json::from_str(out.trim()).map_err(|_| "Windows gave an answer this app could not read.".to_string())?;
        elevated_outcome_hotspot(v)
    })
}

#[tauri::command]
pub fn hotspot_stop(state: State<HotspotState>) -> Result<(), String> {
    spawn_job(&state, "hotspot-stop", move || {
        let out = run_ps(&format!("{WINRT}{STOP_SCRIPT}"), &[])?;
        let v: Value = serde_json::from_str(out.trim()).map_err(|_| "Windows gave an answer this app could not read.".to_string())?;
        elevated_outcome_hotspot(v)
    })
}

fn elevated_outcome_hotspot(v: Value) -> Result<(), String> {
    match elevated_outcome(v) {
        Err(e) if e == "nowifi" => Err(NO_WIFI_MESSAGE.to_string()),
        r => r,
    }
}

// ---------- Internet sharing between two adapters ----------

const ADAPTERS_SCRIPT: &str = r#"
$ips=@{}
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue|ForEach-Object{if(-not $ips.ContainsKey([int]$_.InterfaceIndex)){$ips[[int]$_.InterfaceIndex]=$_.IPAddress}}
$rows=@(Get-NetAdapter|ForEach-Object{
  [pscustomobject]@{
    name=$_.Name
    description=$_.InterfaceDescription
    connected=($_.Status -eq 'Up')
    virtual=((-not $_.HardwareInterface) -or ($_.InterfaceDescription -match 'Virtual|VMware|VirtualBox|Hyper-V|TAP-|Wintun|WireGuard|Loopback|Tunnel|vEthernet|Bluetooth'))
    ipv4=$ips[[int]$_.ifIndex]
  }
})
ConvertTo-Json -InputObject $rows -Compress
"#;

const SHARING_READ_SCRIPT: &str = r#"
$m=New-Object -ComObject HNetCfg.HNetShare
$r=@()
foreach($c in $m.EnumEveryConnection){
  $cfg=$m.INetSharingConfigurationForINetConnection.Invoke($c)
  if($cfg.SharingEnabled){
    $role='private'; if($cfg.SharingConnectionType -eq 0){$role='public'}
    $r+=[pscustomobject]@{name=$m.NetConnectionProps.Invoke($c).Name;role=$role}
  }
}
ConvertTo-Json -InputObject $r -Compress
"#;

const SHARING_APPLY_BODY: &str = r#"
$did=$null
try{
  $m=New-Object -ComObject HNetCfg.HNetShare
  $pub=$null;$pri=$null
  foreach($c in $m.EnumEveryConnection){
    $n=$m.NetConnectionProps.Invoke($c).Name
    $cfg=$m.INetSharingConfigurationForINetConnection.Invoke($c)
    if($cfg.SharingEnabled){throw 'Internet sharing is already on. Press Reset first.'}
    if($n -eq $pubN){$pub=$cfg}
    if($n -eq $priN){$pri=$cfg}
  }
  if(-not $pub -or -not $pri){throw 'One of the adapters was not found.'}
  $pub.EnableSharing(0);$did=$pub
  $pri.EnableSharing(1)
  Done @{ok=$true}
}catch{
  $msg=$_.Exception.Message
  try{if($did){$did.DisableSharing()}}catch{}
  Done @{ok=$false;error=$msg}
}
"#;

const SHARING_RESET_BODY: &str = r#"
try{
  $m=New-Object -ComObject HNetCfg.HNetShare
  foreach($c in $m.EnumEveryConnection){
    $cfg=$m.INetSharingConfigurationForINetConnection.Invoke($c)
    if($cfg.SharingEnabled){$cfg.DisableSharing()}
  }
  Done @{ok=$true}
}catch{
  Done @{ok=$false;error=$_.Exception.Message}
}
"#;

#[derive(Serialize, Clone)]
pub struct SharedConnection {
    pub name: String,
    pub role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingStatus {
    pub on: bool,
    pub public: Option<String>,
    pub private: Option<String>,
    /// True when the sharing now on is the pair this app set up.
    pub by_app: bool,
}

#[derive(Serialize, Deserialize, PartialEq)]
struct Pair {
    public: String,
    private: String,
}

fn read_sharing() -> Result<Vec<SharedConnection>, String> {
    let out = run_ps(SHARING_READ_SCRIPT, &[])?;
    Ok(json_items(&out)?
        .iter()
        .filter_map(|v| Some(SharedConnection { name: v.get("name")?.as_str()?.to_string(), role: v.get("role")?.as_str()?.to_string() }))
        .collect())
}

#[tauri::command]
pub fn sharing_status(app: AppHandle) -> Result<SharingStatus, String> {
    let list = read_sharing().map_err(|e| format!("Could not read the sharing state from Windows. {e}"))?;
    let public = list.iter().find(|c| c.role == "public").map(|c| c.name.clone());
    let private = list.iter().find(|c| c.role == "private").map(|c| c.name.clone());
    let mine: Option<Pair> = data_dir(&app)
        .ok()
        .and_then(|d| fs::read_to_string(d.join("sharing.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok());
    let by_app = match (&public, &private, mine) {
        (Some(a), Some(b), Some(m)) => m.public == *a && m.private == *b,
        _ => false,
    };
    Ok(SharingStatus { on: !list.is_empty(), public, private, by_app })
}

#[tauri::command]
pub fn sharing_adapters() -> Result<Vec<AdapterInfo>, String> {
    parse_adapters(&run_ps(ADAPTERS_SCRIPT, &[])?)
}

#[tauri::command]
pub fn sharing_apply(app: AppHandle, state: State<HotspotState>, public: String, private: String) -> Result<(), String> {
    if public == private && !public.is_empty() {
        return Err("The public and private adapter must be different.".into());
    }
    if !name_ok(&public) || !name_ok(&private) {
        return Err("Choose both a public and a private adapter.".into());
    }
    let dir = data_dir(&app)?;
    spawn_job(&state, "sharing-apply", move || {
        let adapters = parse_adapters(&run_ps(ADAPTERS_SCRIPT, &[])?)?;
        let on = !read_sharing()?.is_empty();
        check_apply(&public, &private, &adapters, on)?;
        let v = run_elevated(SHARING_APPLY_BODY, &dir.join("sharing-result.json"), &[("pubN", public.clone()), ("priN", private.clone())])?;
        elevated_outcome(v)?;
        write_json(&dir.join("sharing.json"), &Pair { public, private })
    })
}

#[tauri::command]
pub fn sharing_reset(app: AppHandle, state: State<HotspotState>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    spawn_job(&state, "sharing-reset", move || {
        let v = run_elevated(SHARING_RESET_BODY, &dir.join("sharing-result.json"), &[])?;
        elevated_outcome(v)?;
        let _ = fs::remove_file(dir.join("sharing.json"));
        Ok(())
    })
}

// ---------- Connected devices ----------

#[derive(Serialize)]
pub struct Device {
    pub name: String,
    pub ip: String,
    pub mac: String,
}

/// Devices the PC has talked to on one private subnet, from the ARP table. Reads the table only; sends nothing.
/// `interface_ip` is the PC's own address on that subnet; without it, Windows' default sharing address is used.
#[tauri::command]
pub fn hotspot_devices(interface_ip: Option<String>) -> Result<Vec<Device>, String> {
    let ip = interface_ip.filter(|s| !s.is_empty()).unwrap_or_else(|| DEFAULT_PRIVATE_IP.to_string());
    let parsed: std::net::Ipv4Addr = ip.parse().map_err(|_| "That is not an IPv4 address.".to_string())?;
    if !(parsed.is_private() || parsed.is_link_local()) {
        return Err("Only private networks are read.".into());
    }
    let out = Command::new("arp")
        .arg("-a")
        .stdin(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_arp(&text, &ip)
        .into_iter()
        .map(|n| Device { name: "Unnamed device".into(), ip: n.ip, mac: n.mac })
        .collect())
}
