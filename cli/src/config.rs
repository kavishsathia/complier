// Server definitions live in ~/.complier/servers.toml. Secrets never do: stdio servers record
// only their env var names, HTTP servers only their (public) OAuth client details.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub enum Server {
    Stdio {
        command: Vec<String>,
        #[serde(default)]
        env: Vec<String>,
    },
    Http {
        url: String,
        resource: String,
        client_id: String,
        token_endpoint: String,
    },
}

pub type Servers = BTreeMap<String, Server>;

fn path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("no home directory")?;
    Ok(home.join(".complier").join("servers.toml"))
}

pub fn load() -> Result<Servers> {
    match std::fs::read_to_string(path()?) {
        Ok(text) => Ok(toml::from_str(&text)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Servers::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn save(servers: &Servers) -> Result<()> {
    let path = path()?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(path, toml::to_string(servers)?)?;
    Ok(())
}

pub fn get(name: &str) -> Result<Server> {
    load()?.remove(name).ok_or_else(|| anyhow!("no server named {name}"))
}
