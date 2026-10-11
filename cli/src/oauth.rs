// MCP authorization: protected resource discovery, dynamic client registration,
// authorization code + PKCE through a localhost callback, and refresh.

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::blocking::Client as Http;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Registration {
    pub resource: String,
    pub client_id: String,
    pub token_endpoint: String,
}

#[derive(Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
}

impl Tokens {
    pub fn expired(&self) -> bool {
        self.expires_at.is_some_and(|t| now() + 60 >= t)
    }
}

pub fn login(http: &Http, url: &str, client_id: Option<String>) -> Result<(Registration, Tokens)> {
    let (metadata_url, challenge_scope) = protected_resource_metadata(http, url)?;
    let resource_meta: Value = http.get(&metadata_url).send()?.error_for_status()?.json()?;
    let resource = resource_meta["resource"].as_str().unwrap_or(url).to_string();
    let issuer = resource_meta["authorization_servers"][0]
        .as_str()
        .context("protected resource metadata names no authorization server")?;
    let server = authorization_server_metadata(http, issuer)?;
    let endpoint = |key: &str| -> Result<String> {
        server[key].as_str().map(String::from).with_context(|| format!("authorization server has no {key}"))
    };

    let listener = TcpListener::bind("127.0.0.1:0")?;
    let redirect_uri = format!("http://127.0.0.1:{}/callback", listener.local_addr()?.port());

    let client_id = match client_id {
        Some(id) => id,
        None => register(http, &endpoint("registration_endpoint").context(
            "this server does not support dynamic client registration; pass --client-id",
        )?, &redirect_uri)?,
    };

    // Scope per the MCP spec: the 401 challenge's scope first, else everything the resource lists.
    let scope = challenge_scope.or_else(|| {
        resource_meta["scopes_supported"].as_array().map(|s| {
            s.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")
        })
    });

    let verifier = URL_SAFE_NO_PAD.encode(random_bytes::<32>()?);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = URL_SAFE_NO_PAD.encode(random_bytes::<16>()?);

    let mut params = vec![
        ("response_type", "code"),
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
        ("resource", resource.as_str()),
    ];
    if let Some(scope) = &scope {
        params.push(("scope", scope));
    }
    let authorize = Url::parse_with_params(&endpoint("authorization_endpoint")?, &params)?;

    println!("Opening your browser to authorize complier. If it doesn't open, visit:\n\n  {authorize}\n");
    let _ = std::process::Command::new("open").arg(authorize.as_str()).status();

    let code = await_callback(&listener, &state)?;
    let token_endpoint = endpoint("token_endpoint")?;
    let tokens = token_request(http, &token_endpoint, &[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
        ("resource", &resource),
    ], None)?;

    Ok((Registration { resource, client_id, token_endpoint }, tokens))
}

pub fn refresh(http: &Http, reg: &Registration, tokens: Tokens) -> Result<Tokens> {
    let refresh_token = tokens.refresh_token.context("access token expired and there is no refresh token")?;
    token_request(http, &reg.token_endpoint, &[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh_token),
        ("client_id", &reg.client_id),
        ("resource", &reg.resource),
    ], Some(refresh_token.clone()))
}

// The 401 challenge points at the metadata; otherwise fall back to the well-known location.
fn protected_resource_metadata(http: &Http, url: &str) -> Result<(String, Option<String>)> {
    let response = http.post(url).header("Accept", "application/json, text/event-stream").json(&json!({})).send()?;
    if let Some(header) = response.headers().get("www-authenticate").and_then(|h| h.to_str().ok()) {
        if let Some(metadata) = auth_param(header, "resource_metadata") {
            return Ok((metadata, auth_param(header, "scope")));
        }
    }
    let url = Url::parse(url)?;
    Ok((format!("{}/.well-known/oauth-protected-resource{}", origin(&url), url.path().trim_end_matches('/')), None))
}

fn authorization_server_metadata(http: &Http, issuer: &str) -> Result<Value> {
    let url = Url::parse(issuer)?;
    let (origin, path) = (origin(&url), url.path().trim_end_matches('/'));
    for candidate in [
        format!("{origin}/.well-known/oauth-authorization-server{path}"),
        format!("{origin}/.well-known/openid-configuration{path}"),
        format!("{origin}{path}/.well-known/openid-configuration"),
    ] {
        let response = http.get(&candidate).send()?;
        if response.status().is_success() {
            return Ok(response.json()?);
        }
    }
    bail!("no authorization server metadata found for {issuer}")
}

fn register(http: &Http, endpoint: &str, redirect_uri: &str) -> Result<String> {
    let response: Value = http
        .post(endpoint)
        .json(&json!({
            "client_name": "complier",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }))
        .send()?
        .error_for_status()
        .context("dynamic client registration failed")?
        .json()?;
    response["client_id"].as_str().map(String::from).context("registration returned no client_id")
}

// Serves exactly one request on the callback port and returns the authorization code.
fn await_callback(listener: &TcpListener, state: &str) -> Result<String> {
    let (mut stream, _) = listener.accept()?;
    let mut request_line = String::new();
    BufReader::new(stream.try_clone()?).read_line(&mut request_line)?;
    let target = request_line.split_whitespace().nth(1).context("malformed callback request")?;
    let query: Vec<(String, String)> = Url::parse(&format!("http://localhost{target}"))?
        .query_pairs()
        .into_owned()
        .collect();
    let param = |key: &str| query.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());

    let outcome = match (param("error"), param("code"), param("state")) {
        (Some(error), _, _) => Err(anyhow!("authorization denied: {error}")),
        (None, Some(code), Some(s)) if s == state => Ok(code),
        _ => Err(anyhow!("callback had a missing or mismatched state")),
    };
    let body = if outcome.is_ok() { "complier is authorized. You can close this tab." } else { "Authorization failed." };
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())?;
    outcome
}

fn token_request(http: &Http, endpoint: &str, form: &[(&str, &str)], previous_refresh: Option<String>) -> Result<Tokens> {
    let response = http.post(endpoint).header("Accept", "application/json").form(form).send()?;
    let status = response.status();
    let body: Value = response.json()?;
    if !status.is_success() || body.get("error").is_some() {
        bail!("token request failed ({status}): {body}");
    }
    Ok(Tokens {
        access_token: body["access_token"].as_str().context("no access_token in response")?.to_string(),
        refresh_token: body["refresh_token"].as_str().map(String::from).or(previous_refresh),
        expires_at: body["expires_in"].as_u64().map(|s| now() + s),
    })
}

// Pulls `key="value"` out of a WWW-Authenticate header.
fn auth_param(header: &str, key: &str) -> Option<String> {
    let start = header.find(&format!("{key}=\""))? + key.len() + 2;
    let len = header[start..].find('"')?;
    Some(header[start..start + len].to_string())
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}
