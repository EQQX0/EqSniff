//! Reads and writes pcapng files, the format current Wireshark saves by default.
//!
//! Reading walks the file block by block and keeps at most `max` packets, so a large file is not
//! copied twice. Packet bytes are kept exactly as stored. Whatever this reader does not keep
//! (name resolution blocks, packet comments and the like) is counted and reported in `notes`
//! instead of being dropped without a word.

use crate::pcapfile::{self, Rec, MAX_RECORD};
use std::collections::BTreeMap;

/// What a capture file says about one interface.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IfaceInfo {
    pub link: u32,
    /// 0 means no limit.
    pub snaplen: u32,
    pub name: Option<String>,
    pub description: Option<String>,
}

/// A capture file after reading.
#[derive(Debug, Default)]
pub struct Loaded {
    pub recs: Vec<Rec>,
    /// Packets in the file, including ones past `max` that were counted but not kept.
    pub total: usize,
    pub ifaces: Vec<IfaceInfo>,
    /// What the file says about itself (the program and system that wrote it).
    pub info: Vec<String>,
    /// What was not kept or could not be read.
    pub notes: Vec<String>,
    pub pcapng: bool,
}

pub fn is_pcapng(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[..4] == [0x0a, 0x0d, 0x0d, 0x0a]
}

/// Opens a capture file in either format.
pub fn read_any(bytes: &[u8], max: usize) -> Result<Loaded, String> {
    if is_pcapng(bytes) {
        return read(bytes, max);
    }
    let (recs, total) = pcapfile::read(bytes, max)?;
    let link = recs.first().map_or(1, |r| r.link);
    Ok(Loaded { recs, total, ifaces: vec![IfaceInfo { link, ..Default::default() }], ..Default::default() })
}

fn rd16(b: &[u8], o: usize, big: bool) -> u16 {
    let x = [b[o], b[o + 1]];
    if big { u16::from_be_bytes(x) } else { u16::from_le_bytes(x) }
}

fn rd32(b: &[u8], o: usize, big: bool) -> u32 {
    let x = [b[o], b[o + 1], b[o + 2], b[o + 3]];
    if big { u32::from_be_bytes(x) } else { u32::from_le_bytes(x) }
}

fn rd64(b: &[u8], o: usize, big: bool) -> u64 {
    let mut x = [0u8; 8];
    x.copy_from_slice(&b[o..o + 8]);
    if big { u64::from_be_bytes(x) } else { u64::from_le_bytes(x) }
}

/// Splits an options list into (code, value) pairs. A damaged list yields what came before the damage.
fn options(mut b: &[u8], big: bool) -> Vec<(u16, &[u8])> {
    let mut out = Vec::new();
    while b.len() >= 4 {
        let (code, len) = (rd16(b, 0, big), rd16(b, 2, big) as usize);
        if code == 0 || 4 + len > b.len() {
            break;
        }
        out.push((code, &b[4..4 + len]));
        let step = 4 + pad4(len);
        if step > b.len() {
            break;
        }
        b = &b[step..];
    }
    out
}

fn text(v: &[u8]) -> String {
    String::from_utf8_lossy(v).trim_end_matches('\0').trim().to_string()
}

/// How an interface counts time: ticks of 10^-n or 2^-n seconds, from an offset.
#[derive(Clone, Copy)]
struct Ts {
    pow2: bool,
    exp: u8,
    offset_s: i64,
}

impl Default for Ts {
    fn default() -> Ts {
        Ts { pow2: false, exp: 6, offset_s: 0 } // the pcapng default is microseconds
    }
}

impl Ts {
    fn from_option(v: u8) -> Ts {
        Ts { pow2: v & 0x80 != 0, exp: v & 0x7f, offset_s: 0 }
    }

    /// Nanoseconds since 1970. Finer than a nanosecond is cut; out of range is clamped.
    fn to_ns(self, ticks: u64) -> u64 {
        let t = ticks as u128;
        let ns: u128 = if self.pow2 {
            if self.exp >= 64 { 0 } else { (t * 1_000_000_000) >> self.exp }
        } else if self.exp <= 9 {
            t * 10u128.pow(9 - self.exp as u32)
        } else if self.exp > 38 {
            0
        } else {
            t / 10u128.pow(self.exp as u32 - 9)
        };
        let signed = ns as i128 + self.offset_s as i128 * 1_000_000_000;
        signed.clamp(0, u64::MAX as i128) as u64
    }
}

fn block_name(t: u32) -> String {
    match t {
        0x04 => "name resolution".into(),
        0x05 => "interface statistics".into(),
        0x0a => "decryption secrets".into(),
        0x0bad | 0x4000_0bad => "custom".into(),
        n => format!("unknown (type {n:#x})"),
    }
}

pub fn read(bytes: &[u8], max: usize) -> Result<Loaded, String> {
    if !is_pcapng(bytes) {
        return Err("That is not a pcapng file.".into());
    }
    if bytes.len() < 28 {
        return Err("That file is too short to be a capture file.".into());
    }
    let mut out = Loaded { pcapng: true, ..Default::default() };
    let mut ts: Vec<Ts> = Vec::new();
    let (mut o, mut big, mut sections, mut base) = (0usize, false, 0usize, 0usize);
    let mut skipped: BTreeMap<u32, usize> = BTreeMap::new();
    let (mut bad, mut simple, mut commented, mut other_pkt_opts, mut iface_opts) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut cut: Option<&str> = None;

    while o < bytes.len() {
        if bytes.len() - o < 12 {
            cut = Some("The file ends in the middle of a block");
            break;
        }
        if bytes[o..o + 4] == [0x0a, 0x0d, 0x0d, 0x0a] {
            if bytes.len() - o < 28 {
                cut = Some("The file ends in the middle of a section header");
                break;
            }
            big = match [bytes[o + 8], bytes[o + 9], bytes[o + 10], bytes[o + 11]] {
                [0x4d, 0x3c, 0x2b, 0x1a] => false,
                [0x1a, 0x2b, 0x3c, 0x4d] => true,
                _ if sections == 0 => return Err("That pcapng file is damaged: its byte-order marker is wrong.".into()),
                _ => {
                    cut = Some("A section header has a wrong byte-order marker");
                    break;
                }
            };
        } else if sections == 0 {
            return Err("That is not a valid pcapng file: it does not start with a section header block.".into());
        }
        let (btype, blen) = (rd32(bytes, o, big), rd32(bytes, o + 4, big) as usize);
        if blen < 12 || blen % 4 != 0 || blen > bytes.len() - o {
            cut = Some(if blen > bytes.len() - o { "The file ends in the middle of a block" } else { "A block has an impossible length" });
            break;
        }
        if rd32(bytes, o + blen - 4, big) as usize != blen {
            cut = Some("A block's two length fields disagree");
            break;
        }
        let body = &bytes[o + 8..o + blen - 4];
        match btype {
            0x0a0d_0d0a => {
                if body.len() < 16 {
                    cut = Some("A section header is too short");
                    break;
                }
                let (major, minor) = (rd16(body, 4, big), rd16(body, 6, big));
                if major != 1 {
                    if sections == 0 {
                        return Err(format!("This pcapng file is version {major}.{minor}. Only version 1.x is supported."));
                    }
                    cut = Some("A later section uses an unsupported pcapng version");
                    break;
                }
                sections += 1;
                base = out.ifaces.len();
                let (mut hw, mut os, mut app) = (String::new(), String::new(), String::new());
                for (code, v) in options(&body[16..], big) {
                    match code {
                        2 => hw = text(v),
                        3 => os = text(v),
                        4 => app = text(v),
                        _ => {}
                    }
                }
                let parts: Vec<String> = [("program", app), ("system", os), ("hardware", hw)]
                    .into_iter()
                    .filter(|(_, v)| !v.is_empty())
                    .map(|(k, v)| format!("{k}: {v}"))
                    .collect();
                if !parts.is_empty() {
                    out.info.push(format!("Section {sections}: {}", parts.join(", ")));
                }
            }
            0x01 if body.len() >= 8 => {
                let mut info = IfaceInfo { link: rd16(body, 0, big) as u32, snaplen: rd32(body, 4, big), ..Default::default() };
                let mut t = Ts::default();
                for (code, v) in options(&body[8..], big) {
                    match code {
                        2 => info.name = Some(text(v)),
                        3 => info.description = Some(text(v)),
                        9 if v.len() == 1 => t = Ts::from_option(v[0]),
                        14 if v.len() == 8 => t.offset_s = rd64(v, 0, big) as i64,
                        _ => iface_opts += 1,
                    }
                }
                out.ifaces.push(info);
                ts.push(t);
            }
            0x06 | 0x02 | 0x03 => {
                // Enhanced, obsolete and simple packet blocks. (interface, ticks, captured length, wire length, data offset, has time)
                let parsed: Option<(usize, u64, usize, u32, usize, bool)> = match btype {
                    0x06 if body.len() >= 20 => Some((
                        rd32(body, 0, big) as usize,
                        ((rd32(body, 4, big) as u64) << 32) | rd32(body, 8, big) as u64,
                        rd32(body, 12, big) as usize,
                        rd32(body, 16, big),
                        20,
                        true,
                    )),
                    0x02 if body.len() >= 20 => Some((
                        rd16(body, 0, big) as usize,
                        ((rd32(body, 4, big) as u64) << 32) | rd32(body, 8, big) as u64,
                        rd32(body, 12, big) as usize,
                        rd32(body, 16, big),
                        20,
                        true,
                    )),
                    0x03 if body.len() >= 4 => {
                        let orig = rd32(body, 0, big);
                        let snap = out.ifaces.get(base).map_or(0, |i| i.snaplen) as usize;
                        let cap = (orig as usize).min(if snap == 0 { usize::MAX } else { snap }).min(body.len() - 4);
                        Some((0, 0, cap, orig, 4, false))
                    }
                    _ => None,
                };
                let ok = parsed.filter(|&(iface, _, cap, _, at, _)| base + iface < out.ifaces.len() && cap <= MAX_RECORD && at + cap <= body.len());
                let Some((iface, ticks, cap, orig, at, has_time)) = ok else {
                    bad += 1;
                    o += blen;
                    continue;
                };
                let gi = base + iface;
                if btype == 0x06 {
                    for (code, _) in options(&body[pad4(at + cap).min(body.len())..], big) {
                        if code == 1 {
                            commented += 1;
                        } else {
                            other_pkt_opts += 1;
                        }
                    }
                }
                if !has_time {
                    simple += 1;
                }
                out.total += 1;
                if out.recs.len() < max {
                    let ns = ts[gi].to_ns(ticks);
                    out.recs.push(Rec { time: ns as f64 / 1e9, ts_ns: ns, data: body[at..at + cap].to_vec(), wire_len: orig, link: out.ifaces[gi].link, iface: gi as u32 });
                }
            }
            _ => *skipped.entry(btype).or_default() += 1,
        }
        o += blen;
    }

    if out.total == 0 {
        return Err(match cut {
            Some(why) => format!("{why}, before any packet. The file is damaged or incomplete."),
            None => "That capture file holds no packets.".into(),
        });
    }
    if let Some(why) = cut {
        out.notes.push(format!("{why}. The file is damaged or was cut short; the {} packets before that point were read.", out.total));
    }
    if bad > 0 {
        out.notes.push(format!("{bad} packet block(s) were unreadable (wrong interface or length) and were skipped."));
    }
    for (t, n) in skipped {
        out.notes.push(format!("{n} {} block(s) in the file were not kept.", block_name(t)));
    }
    if simple > 0 {
        out.notes.push(format!("{simple} packet(s) came from simple packet blocks, which carry no timestamp, so their time shows as 1970."));
    }
    if commented > 0 {
        out.notes.push(format!("{commented} packet comment(s) in the file are not kept."));
    }
    if other_pkt_opts > 0 {
        out.notes.push(format!("{other_pkt_opts} per-packet option(s) (flags, hashes) are not kept."));
    }
    if iface_opts > 0 {
        out.notes.push(format!("{iface_opts} interface option(s) (addresses, speed, filter) are not kept."));
    }
    Ok(out)
}

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

fn put_opt(out: &mut Vec<u8>, code: u16, v: &[u8]) {
    out.extend_from_slice(&code.to_le_bytes());
    out.extend_from_slice(&(v.len() as u16).to_le_bytes());
    out.extend_from_slice(v);
    out.resize(out.len() + pad4(v.len()) - v.len(), 0);
}

fn put_block(out: &mut Vec<u8>, btype: u32, body: &[u8]) {
    let total = (12 + pad4(body.len())) as u32;
    out.extend_from_slice(&btype.to_le_bytes());
    out.extend_from_slice(&total.to_le_bytes());
    out.extend_from_slice(body);
    out.resize(out.len() + pad4(body.len()) - body.len(), 0);
    out.extend_from_slice(&total.to_le_bytes());
}

/// Builds a little-endian pcapng file with nanosecond timestamps. Each distinct (interface, link
/// type) pair among the records becomes one interface block, in order of first use. `ifaces`
/// supplies names, descriptions and snap lengths, indexed by `Rec::iface`.
pub fn write(recs: &[Rec], ifaces: &[IfaceInfo], app: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(128 + recs.iter().map(|r| 32 + pad4(r.data.len())).sum::<usize>());
    let mut shb = Vec::new();
    shb.extend_from_slice(&0x1a2b_3c4du32.to_le_bytes());
    shb.extend_from_slice(&1u16.to_le_bytes());
    shb.extend_from_slice(&0u16.to_le_bytes());
    shb.extend_from_slice(&(-1i64).to_le_bytes()); // section length unknown
    put_opt(&mut shb, 4, app.as_bytes());
    put_opt(&mut shb, 0, &[]);
    put_block(&mut out, 0x0a0d_0d0a, &shb);

    let mut order: Vec<(u32, u32)> = Vec::new();
    for r in recs {
        if !order.contains(&(r.iface, r.link)) {
            order.push((r.iface, r.link));
        }
    }
    for &(i, link) in &order {
        let info = ifaces.get(i as usize);
        let longest = recs.iter().filter(|r| r.iface == i && r.link == link).map(|r| r.data.len() as u32).max().unwrap_or(0);
        // A snap length shorter than a stored packet would make Wireshark complain.
        let snap = match info.map_or(0, |x| x.snaplen) {
            0 => 0,
            s => s.max(longest),
        };
        let mut idb = Vec::new();
        idb.extend_from_slice(&(link as u16).to_le_bytes());
        idb.extend_from_slice(&0u16.to_le_bytes());
        idb.extend_from_slice(&snap.to_le_bytes());
        if let Some(n) = info.and_then(|x| x.name.as_deref()).filter(|n| !n.is_empty()) {
            put_opt(&mut idb, 2, n.as_bytes());
        }
        if let Some(d) = info.and_then(|x| x.description.as_deref()).filter(|d| !d.is_empty()) {
            put_opt(&mut idb, 3, d.as_bytes());
        }
        put_opt(&mut idb, 9, &[9]); // timestamps in nanoseconds
        put_opt(&mut idb, 0, &[]);
        put_block(&mut out, 0x01, &idb);
    }
    for r in recs {
        let idx = order.iter().position(|k| *k == (r.iface, r.link)).unwrap_or(0) as u32;
        let mut epb = Vec::with_capacity(20 + r.data.len() + 3);
        epb.extend_from_slice(&idx.to_le_bytes());
        epb.extend_from_slice(&((r.ts_ns >> 32) as u32).to_le_bytes());
        epb.extend_from_slice(&(r.ts_ns as u32).to_le_bytes());
        epb.extend_from_slice(&(r.data.len() as u32).to_le_bytes());
        epb.extend_from_slice(&r.wire_len.max(r.data.len() as u32).to_le_bytes());
        epb.extend_from_slice(&r.data);
        put_block(&mut out, 0x06, &epb);
    }
    out
}
