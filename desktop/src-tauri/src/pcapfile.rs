//! Reads and writes classic .pcap files (Ethernet frames), the format Wireshark and tcpdump open.
//! pcapng (the newer format) is recognised and refused with a clear message.

#[derive(Debug)]
pub struct Rec {
    pub time: f64,
    pub data: Vec<u8>,
    /// Length on the wire, which can be larger than `data` if the packet was cut short.
    pub wire_len: u32,
}

const MAX_RECORD: usize = 262_144;
/// Largest capture file the app opens, as bytes and as base64 text (a third larger).
pub const MAX_FILE: usize = 32 * 1024 * 1024;
pub const MAX_FILE_B64: usize = 45_000_000;

/// Decodes a file sent as base64, refusing anything over the size limits before the memory is used.
pub fn decode_upload(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let text = text.trim();
    if text.len() > MAX_FILE_B64 {
        return Err("That file is too large to open. The limit is 32 MB.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(text).map_err(|_| "The file could not be read.".to_string())?;
    if bytes.len() > MAX_FILE {
        return Err("That file is too large to open. The limit is 32 MB.".into());
    }
    Ok(bytes)
}

pub fn write(recs: &[Rec]) -> Vec<u8> {
    let mut out = Vec::with_capacity(24 + recs.iter().map(|r| 16 + r.data.len()).sum::<usize>());
    out.extend_from_slice(&0xa1b2_c3d4u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // time zone
    out.extend_from_slice(&0u32.to_le_bytes()); // accuracy
    out.extend_from_slice(&65_535u32.to_le_bytes()); // snap length
    out.extend_from_slice(&1u32.to_le_bytes()); // link type 1 = Ethernet
    for r in recs {
        let secs = r.time.max(0.0).floor();
        let micros = ((r.time.max(0.0) - secs) * 1_000_000.0).round().min(999_999.0);
        out.extend_from_slice(&(secs as u32).to_le_bytes());
        out.extend_from_slice(&(micros as u32).to_le_bytes());
        out.extend_from_slice(&(r.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&r.wire_len.max(r.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&r.data);
    }
    out
}

/// Returns up to `max` packets and the number of records the file holds in total.
/// A file cut off in the middle of a record is read up to that point.
pub fn read(bytes: &[u8], max: usize) -> Result<(Vec<Rec>, usize), String> {
    if bytes.len() < 24 {
        return Err("That file is too short to be a capture file.".into());
    }
    if bytes[..4] == [0x0a, 0x0d, 0x0d, 0x0a] {
        return Err("That is a pcapng file. This app opens classic .pcap files. In Wireshark, use File > Save As and choose \"Wireshark/tcpdump - pcap\".".into());
    }
    let magic = [bytes[0], bytes[1], bytes[2], bytes[3]];
    let (big, nano) = match magic {
        [0xd4, 0xc3, 0xb2, 0xa1] => (false, false),
        [0x4d, 0x3c, 0xb2, 0xa1] => (false, true),
        [0xa1, 0xb2, 0xc3, 0xd4] => (true, false),
        [0xa1, 0xb2, 0x3c, 0x4d] => (true, true),
        _ => return Err("That file is not a .pcap capture file.".into()),
    };
    let u32at = |o: usize| -> u32 {
        let b = [bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]];
        if big { u32::from_be_bytes(b) } else { u32::from_le_bytes(b) }
    };
    if u32at(20) & 0x0fff_ffff != 1 {
        return Err("Only Ethernet captures can be opened. This file uses a different link type.".into());
    }
    let mut recs = Vec::new();
    let mut total = 0usize;
    let mut o = 24;
    while o + 16 <= bytes.len() {
        let (sec, frac, incl, orig) = (u32at(o), u32at(o + 4), u32at(o + 8) as usize, u32at(o + 12));
        if incl > MAX_RECORD || o.saturating_add(16).saturating_add(incl) > bytes.len() {
            break;
        }
        total += 1;
        if recs.len() < max {
            let frac = frac as f64 / if nano { 1e9 } else { 1e6 };
            recs.push(Rec { time: sec as f64 + frac, data: bytes[o + 16..o + 16 + incl].to_vec(), wire_len: orig });
        }
        o += 16 + incl;
    }
    if total == 0 {
        return Err("That capture file holds no packets.".into());
    }
    Ok((recs, total))
}
