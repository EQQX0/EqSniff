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
        if incl > MAX_RECORD || o + 16 + incl > bytes.len() {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(t: f64, n: usize) -> Rec {
        Rec { time: t, data: (0..n).map(|i| i as u8).collect(), wire_len: n as u32 }
    }

    #[test]
    fn round_trip() {
        let bytes = write(&[rec(1_700_000_000.25, 60), rec(1_700_000_001.5, 1500)]);
        let (back, total) = read(&bytes, 10).unwrap();
        assert_eq!(total, 2);
        assert_eq!(back[1].data.len(), 1500);
        assert!((back[0].time - 1_700_000_000.25).abs() < 1e-5);
    }

    #[test]
    fn respects_max_but_counts_all() {
        let bytes = write(&[rec(1.0, 20), rec(2.0, 20), rec(3.0, 20)]);
        let (back, total) = read(&bytes, 2).unwrap();
        assert_eq!((back.len(), total), (2, 3));
    }

    #[test]
    fn truncated_file_reads_what_is_there() {
        let mut bytes = write(&[rec(1.0, 40), rec(2.0, 40)]);
        bytes.truncate(bytes.len() - 10);
        assert_eq!(read(&bytes, 10).unwrap().1, 1);
    }

    #[test]
    fn refuses_other_formats() {
        assert!(read(&[0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 5).unwrap_err().contains("pcapng"));
        assert!(read(&[b'x'; 40], 5).is_err());
        assert!(read(&[1, 2, 3], 5).is_err());
    }

    #[test]
    fn refuses_non_ethernet() {
        let mut bytes = write(&[rec(1.0, 20)]);
        bytes[20] = 101; // raw IP
        assert!(read(&bytes, 5).unwrap_err().contains("Ethernet"));
    }
}
