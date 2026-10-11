// Credentials go in the OS keychain under service "complier", account "<server>/<ENV_VAR>".

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "complier";

fn entry(server: &str, var: &str) -> Result<Entry> {
    Ok(Entry::new(SERVICE, &format!("{server}/{var}"))?)
}

pub fn set(server: &str, var: &str, secret: &str) -> Result<()> {
    Ok(entry(server, var)?.set_password(secret)?)
}

pub fn get(server: &str, var: &str) -> Result<String> {
    entry(server, var)?
        .get_password()
        .with_context(|| format!("reading {server}/{var} from the keychain"))
}

pub fn delete(server: &str, var: &str) -> Result<()> {
    match entry(server, var)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
