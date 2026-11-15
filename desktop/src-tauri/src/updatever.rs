//! Version-number handling for the update check. No network or window code here.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub core: (u64, u64, u64),
    /// Text after a `-`, such as `beta.2`. A version with one is older than the same core without.
    pub pre: Option<String>,
}

/// Reads `1.2.3`, `v1.2`, `1.2.3-rc1`, `1.2.3+build5`. Anything else gives `None`.
pub fn parse(v: &str) -> Option<Version> {
    let v = v.trim().trim_start_matches('v');
    let v = v.split('+').next()?; // build metadata never matters
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) if !p.is_empty() => (c, Some(p.to_string())),
        Some(_) => return None,
        None => (v, None),
    };
    let nums: Vec<u64> = core.split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let core = match nums[..] {
        [a] => (a, 0, 0),
        [a, b] => (a, b, 0),
        [a, b, c] => (a, b, c),
        _ => return None,
    };
    Some(Version { core, pre })
}

/// Pre-release ordering as in semver: numbers compare as numbers and come before words;
/// a shorter list comes before a longer one that starts the same.
fn cmp_pre(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.split('.'), b.split('.'));
    loop {
        match (x.next(), y.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) => {
                let o = match (p.parse::<u64>(), q.parse::<u64>()) {
                    (Ok(m), Ok(n)) => m.cmp(&n),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => p.cmp(q),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
        }
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        self.core.cmp(&other.core).then_with(|| match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (Some(a), Some(b)) => cmp_pre(a, b),
        })
    }
}

/// The version text shown to the person: only plain characters, at most 32 of them, so a bad
/// update file cannot fill the screen.
pub fn display(v: &str) -> String {
    v.trim().chars().filter(|c| c.is_ascii_alphanumeric() || ".-+_".contains(*c)).take(32).collect()
}

/// The address to check. A `NT_UPDATE_URL` override is used only when it is https.
pub fn choose_url(over: Option<String>, default: &str) -> String {
    match over {
        Some(u) if u.trim().to_ascii_lowercase().starts_with("https://") => u.trim().to_string(),
        _ => default.to_string(),
    }
}

/// The host part of an https address, lower case, without port or credentials. `None` for anything else.
pub fn https_host(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://").or_else(|| url.trim().strip_prefix("HTTPS://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None; // credentials in an address are never expected here
    }
    let host = authority.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// The installer may only come from the same host that served the version file.
pub fn same_host(feed: &str, link: &str) -> bool {
    matches!((https_host(feed), https_host(link)), (Some(a), Some(b)) if a == b)
}

/// A SHA-256 written as 64 hex digits. Returns it in lower case.
pub fn clean_sha256(s: &str) -> Option<String> {
    let s = s.trim().to_ascii_lowercase();
    (s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())).then_some(s)
}
