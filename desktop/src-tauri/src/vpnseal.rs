//! Locks a tunnel file with a passphrase before it leaves this computer.
//! PBKDF2-HMAC-SHA256 turns the passphrase into a key, AES-256-GCM encrypts and authenticates the text.
//! The server only ever sees the sealed text, so it cannot read a private key.

use aes_gcm::aead::{rand_core::RngCore, Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256};

pub const MIN_PASSPHRASE: usize = 8;
const ITERATIONS: u32 = 300_000;
const SALT: usize = 16;
const NONCE: usize = 12;
const MAX_PLAIN: usize = 16 * 1024;
const PREFIX: &str = "v1";

fn derive(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    key
}

fn check(passphrase: &str) -> Result<(), String> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(format!("The sync passphrase needs at least {MIN_PASSPHRASE} characters."));
    }
    Ok(())
}

/// Sealed text looks like `v1.<iterations>.<base64 of salt, nonce, ciphertext>`. A fresh salt and nonce are used every time.
pub fn seal(plain: &str, passphrase: &str) -> Result<String, String> {
    check(passphrase)?;
    if plain.len() > MAX_PLAIN {
        return Err("That tunnel is too large to sync.".into());
    }
    let mut salt = [0u8; SALT];
    let mut nonce = [0u8; NONCE];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive(passphrase, &salt, ITERATIONS);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let sealed = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
        .map_err(|_| "Could not encrypt the tunnel.".to_string())?;
    let mut blob = Vec::with_capacity(SALT + NONCE + sealed.len());
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&sealed);
    Ok(format!("{PREFIX}.{ITERATIONS}.{}", B64.encode(blob)))
}

pub fn open(sealed: &str, passphrase: &str) -> Result<String, String> {
    check(passphrase)?;
    let bad = || "That synced tunnel is damaged.".to_string();
    let mut parts = sealed.splitn(3, '.');
    if parts.next() != Some(PREFIX) {
        return Err(bad());
    }
    let iterations: u32 = parts.next().and_then(|n| n.parse().ok()).ok_or_else(bad)?;
    if !(100_000..=2_000_000).contains(&iterations) {
        return Err(bad());
    }
    let blob = B64.decode(parts.next().ok_or_else(bad)?).map_err(|_| bad())?;
    if blob.len() < SALT + NONCE + 16 {
        return Err(bad());
    }
    let (salt, rest) = blob.split_at(SALT);
    let (nonce, ct) = rest.split_at(NONCE);
    let key = derive(passphrase, salt, iterations);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "Wrong sync passphrase, or the synced tunnel was changed.".to_string())?;
    String::from_utf8(plain).map_err(|_| bad())
}

/// A fingerprint of a tunnel file, so two computers can tell whether they hold the same tunnel without decrypting anything.
/// Cut to 32 hex characters. A file holding a random private key cannot be guessed back from it.
pub fn fingerprint(plain: &str) -> String {
    let d = Sha256::digest(plain.as_bytes());
    d.iter().take(16).map(|b| format!("{b:02x}")).collect()
}
