//! The kill switch: Windows Filtering Platform filters that block every connection that does not use the tunnel.
//!
//! The filters belong to a DYNAMIC session. Windows removes them by itself when this process closes the engine
//! handle or exits for any reason, including a crash, so a bug here can never leave the computer offline for good.
//! The elevated engine process keeps running until the user presses Deactivate, even if the tunnel drops. While it
//! runs, traffic that is not allowed below is blocked, not leaked.
//!
//! Allowed: loopback, the Wintun adapter (matched by its LUID), UDP to the server address and port, DHCP, and the
//! local network (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7, multicast and broadcast) so the
//! router, printers and DHCP keep working. Everything else is blocked at the ALE connect and receive layers.

use std::net::{IpAddr, SocketAddr};
use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;

const RPC_C_AUTHN_WINNT: u32 = 10;
const PROTO_UDP: u8 = 17;

/// One test a filter makes. Values are copied into short-lived boxes when the filter is added.
#[derive(Clone, Debug, PartialEq)]
pub enum Cond {
    Loopback,
    LocalInterface(u64),
    RemoteV4 { addr: u32, mask: u32 },
    RemoteV6 { addr: [u8; 16], prefix: u8 },
    Udp,
    RemotePort(u16),
    LocalPort(u16),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub v6: bool,
    pub recv: bool,
    pub conds: Vec<Cond>,
}

fn v4(a: [u8; 4], len: u8) -> Cond {
    let mask = if len == 0 { 0 } else { u32::MAX << (32 - len) };
    Cond::RemoteV4 { addr: u32::from_be_bytes(a) & mask, mask }
}

fn v6(a: [u8; 16], prefix: u8) -> Cond {
    Cond::RemoteV6 { addr: a, prefix }
}

/// The list of permit rules. Pure, so tests can check it.
pub fn permit_rules(luid: u64, endpoints: &[SocketAddr]) -> Vec<Rule> {
    let mut out = Vec::new();
    for recv in [false, true] {
        for is_v6 in [false, true] {
            let mut add = |conds: Vec<Cond>| out.push(Rule { v6: is_v6, recv, conds });
            add(vec![Cond::Loopback]);
            add(vec![Cond::LocalInterface(luid)]);
            if !is_v6 {
                for (a, l) in [([10, 0, 0, 0], 8), ([172, 16, 0, 0], 12), ([192, 168, 0, 0], 16), ([169, 254, 0, 0], 16), ([224, 0, 0, 0], 4), ([255, 255, 255, 255], 32)] {
                    add(vec![v4(a, l)]);
                }
                // DHCP: the client talks to port 67 and listens on port 68.
                add(vec![Cond::Udp, if recv { Cond::LocalPort(68) } else { Cond::RemotePort(67) }]);
            } else {
                let mut ll = [0u8; 16];
                ll[0] = 0xfe;
                ll[1] = 0x80;
                let mut ula = [0u8; 16];
                ula[0] = 0xfc;
                let mut mc = [0u8; 16];
                mc[0] = 0xff;
                add(vec![v6(ll, 10)]);
                add(vec![v6(ula, 7)]);
                add(vec![v6(mc, 8)]);
                add(vec![Cond::Udp, if recv { Cond::LocalPort(546) } else { Cond::RemotePort(547) }]);
            }
            for e in endpoints {
                match (e.ip(), is_v6) {
                    (IpAddr::V4(ip), false) => add(vec![v4(ip.octets(), 32), Cond::Udp, Cond::RemotePort(e.port())]),
                    (IpAddr::V6(ip), true) => add(vec![v6(ip.octets(), 128), Cond::Udp, Cond::RemotePort(e.port())]),
                    _ => {}
                }
            }
        }
    }
    out
}

pub struct KillSwitch {
    engine: HANDLE,
}

impl Drop for KillSwitch {
    fn drop(&mut self) {
        // SAFETY: the handle came from FwpmEngineOpen0 and is closed once. Closing removes the dynamic filters.
        unsafe {
            FwpmEngineClose0(self.engine);
        }
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn layer(v6: bool, recv: bool) -> GUID {
    match (v6, recv) {
        (false, false) => FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        (true, false) => FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        (false, true) => FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
        (true, true) => FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    }
}

fn check(rc: u32, what: &str) -> Result<(), String> {
    if rc == 0 {
        Ok(())
    } else {
        Err(format!("Kill switch: {what} failed (Windows error {rc:#x})."))
    }
}

impl KillSwitch {
    /// Installs the filters. They last as long as the returned value (and no longer than this process).
    pub fn enable(luid: u64, endpoints: &[SocketAddr]) -> Result<KillSwitch, String> {
        // SAFETY: plain Windows Filtering Platform calls. Every pointer handed to Windows points at data that
        // lives until the call returns.
        unsafe {
            let mut session: FWPM_SESSION0 = std::mem::zeroed();
            session.flags = FWPM_SESSION_FLAG_DYNAMIC;
            let mut engine: HANDLE = std::ptr::null_mut();
            check(FwpmEngineOpen0(std::ptr::null(), RPC_C_AUTHN_WINNT, std::ptr::null(), &session, &mut engine), "opening the filter engine")?;
            let ks = KillSwitch { engine };

            let mut name = wide("Network Toolkit kill switch");
            let sub_key = GUID::from_u128(0x6e74_6b73_0000_4000_8000_0000_0000_0000 | std::process::id() as u128);
            let mut sub: FWPM_SUBLAYER0 = std::mem::zeroed();
            sub.subLayerKey = sub_key;
            sub.displayData.name = name.as_mut_ptr();
            sub.weight = 0xFFFF;
            check(FwpmSubLayerAdd0(engine, &sub, std::ptr::null_mut()), "adding the filter group")?;

            for r in permit_rules(luid, endpoints) {
                add_filter(engine, &sub_key, &mut name, layer(r.v6, r.recv), FWP_ACTION_PERMIT, 8, &r.conds)?;
            }
            for v6 in [false, true] {
                for recv in [false, true] {
                    add_filter(engine, &sub_key, &mut name, layer(v6, recv), FWP_ACTION_BLOCK, 0, &[])?;
                }
            }
            Ok(ks)
        }
    }
}

unsafe fn add_filter(engine: HANDLE, sub: &GUID, name: &mut [u16], layer_key: GUID, action: u32, weight: u8, conds: &[Cond]) -> Result<(), String> {
    // Owned values the conditions point at. The boxes keep their address while the vectors grow.
    let mut u64s: Vec<Box<u64>> = Vec::new();
    let mut m4: Vec<Box<FWP_V4_ADDR_AND_MASK>> = Vec::new();
    let mut m6: Vec<Box<FWP_V6_ADDR_AND_MASK>> = Vec::new();
    let mut list: Vec<FWPM_FILTER_CONDITION0> = Vec::new();
    for c in conds {
        let mut fc: FWPM_FILTER_CONDITION0 = std::mem::zeroed();
        fc.matchType = FWP_MATCH_EQUAL;
        match c {
            Cond::Loopback => {
                fc.fieldKey = FWPM_CONDITION_FLAGS;
                fc.matchType = FWP_MATCH_FLAGS_ALL_SET;
                fc.conditionValue.r#type = FWP_UINT32;
                fc.conditionValue.Anonymous.uint32 = FWP_CONDITION_FLAG_IS_LOOPBACK;
            }
            Cond::LocalInterface(l) => {
                u64s.push(Box::new(*l));
                fc.fieldKey = FWPM_CONDITION_IP_LOCAL_INTERFACE;
                fc.conditionValue.r#type = FWP_UINT64;
                fc.conditionValue.Anonymous.uint64 = &mut **u64s.last_mut().unwrap();
            }
            Cond::RemoteV4 { addr, mask } => {
                m4.push(Box::new(FWP_V4_ADDR_AND_MASK { addr: *addr, mask: *mask }));
                fc.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                fc.conditionValue.r#type = FWP_V4_ADDR_MASK;
                fc.conditionValue.Anonymous.v4AddrMask = &mut **m4.last_mut().unwrap();
            }
            Cond::RemoteV6 { addr, prefix } => {
                m6.push(Box::new(FWP_V6_ADDR_AND_MASK { addr: *addr, prefixLength: *prefix }));
                fc.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
                fc.conditionValue.r#type = FWP_V6_ADDR_MASK;
                fc.conditionValue.Anonymous.v6AddrMask = &mut **m6.last_mut().unwrap();
            }
            Cond::Udp => {
                fc.fieldKey = FWPM_CONDITION_IP_PROTOCOL;
                fc.conditionValue.r#type = FWP_UINT8;
                fc.conditionValue.Anonymous.uint8 = PROTO_UDP;
            }
            Cond::RemotePort(p) => {
                fc.fieldKey = FWPM_CONDITION_IP_REMOTE_PORT;
                fc.conditionValue.r#type = FWP_UINT16;
                fc.conditionValue.Anonymous.uint16 = *p;
            }
            Cond::LocalPort(p) => {
                fc.fieldKey = FWPM_CONDITION_IP_LOCAL_PORT;
                fc.conditionValue.r#type = FWP_UINT16;
                fc.conditionValue.Anonymous.uint16 = *p;
            }
        }
        list.push(fc);
    }
    let mut f: FWPM_FILTER0 = std::mem::zeroed();
    f.displayData.name = name.as_mut_ptr();
    f.layerKey = layer_key;
    f.subLayerKey = *sub;
    f.weight.r#type = FWP_UINT8;
    f.weight.Anonymous.uint8 = weight;
    f.numFilterConditions = list.len() as u32;
    f.filterCondition = if list.is_empty() { std::ptr::null_mut() } else { list.as_mut_ptr() };
    f.action.r#type = action;
    let mut id = 0u64;
    let rc = FwpmFilterAdd0(engine, &f, std::ptr::null_mut(), &mut id);
    drop((u64s, m4, m6));
    check(rc, "adding a filter")
}
