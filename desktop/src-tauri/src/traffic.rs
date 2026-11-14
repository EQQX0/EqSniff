//! Limits the speed of THIS computer's outgoing traffic using a Windows QoS policy.
//! It never touches other devices. Every policy it makes starts with POLICY_PREFIX so the
//! emergency stop can remove exactly those and nothing else.

use serde::Serialize;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

/// True once this session has applied a limit, so closing the app only calls PowerShell when needed.
static LIMIT_SET: AtomicBool = AtomicBool::new(false);

const POLICY_PREFIX: &str = "NetworkToolkit-Limit";

#[derive(Serialize)]
pub struct LimitStatus {
    pub active: bool,
    pub kbps: Option<u32>,
}

fn powershell(script: &str) -> Result<String, String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // no console window
    let out = cmd.output().map_err(|_| "Could not start Windows PowerShell.".to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
        if err.contains("access") || err.contains("denied") || err.contains("administrator") || err.contains("privilege") {
            Err("Windows needs administrator rights to change speed limits. Close the app, right-click it, and choose Run as administrator.".into())
        } else {
            Err("Windows would not apply the change. Try again as administrator.".into())
        }
    }
}

#[tauri::command]
pub fn traffic_status() -> Result<LimitStatus, String> {
    let out = powershell(&format!(
        "Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -like '{POLICY_PREFIX}*' }} | ForEach-Object {{ [math]::Round($_.ThrottleRateActionBitsPerSecond / 1000) }}"
    ))?;
    let kbps = out.lines().next().and_then(|l| l.trim().parse::<u32>().ok());
    Ok(LimitStatus { active: kbps.is_some(), kbps })
}

/// Caps outgoing speed for this computer. `kbps` is checked here, so it is always a plain number.
#[tauri::command]
pub fn traffic_limit(kbps: u32) -> Result<LimitStatus, String> {
    if !(64..=1_000_000).contains(&kbps) {
        return Err("Choose a limit between 64 and 1,000,000 kbps.".into());
    }
    let bits = kbps as u64 * 1000;
    powershell(&format!(
        "Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -like '{POLICY_PREFIX}*' }} | Remove-NetQosPolicy -Confirm:$false; \
         New-NetQosPolicy -Name '{POLICY_PREFIX}' -Precedence 127 -IPDstPrefixMatchCondition '0.0.0.0/0' -ThrottleRateActionBitsPerSecond {bits} -ErrorAction Stop | Out-Null"
    ))?;
    LIMIT_SET.store(true, Ordering::Relaxed);
    traffic_status()
}

/// Emergency stop: removes every limit this app made.
#[tauri::command]
pub fn traffic_stop() -> Result<LimitStatus, String> {
    powershell(&format!(
        "Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -like '{POLICY_PREFIX}*' }} | Remove-NetQosPolicy -Confirm:$false"
    ))?;
    traffic_status()
}

/// Called when the app closes, so a limit never outlives the window.
pub fn stop_on_exit() {
    if LIMIT_SET.load(Ordering::Relaxed) {
        let _ = traffic_stop();
    }
}
