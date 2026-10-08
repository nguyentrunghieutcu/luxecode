use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use std::net::IpAddr;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Profile {
    pub endpoint: String,
    pub model: String,
    pub context_window: u64,
    pub max_output_tokens: u64,
}

pub(crate) fn parse_profile(bytes: &[u8]) -> Result<Profile, String> {
    if bytes.len() > 16 * 1024 {
        return Err("Gateway profile exceeds 16 KiB".into());
    }
    let profile: Profile = serde_json::from_slice(bytes)
        .map_err(|_| "Invalid gateway profile; see docs/luxecode-p0-p1.md".to_string())?;
    let endpoint = url::Url::parse(&profile.endpoint)
        .map_err(|_| "Gateway endpoint must be an absolute HTTP(S) URL".to_string())?;
    let loopback = endpoint.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || !(endpoint.scheme() == "https" || endpoint.scheme() == "http" && loopback)
    {
        return Err("Gateway requires HTTPS (HTTP allowed only on loopback), without credentials, query or fragment".into());
    }
    if profile.model.is_empty()
        || profile.model.len() > 200
        || !profile
            .model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_./:-".contains(&byte))
        || profile.max_output_tokens == 0
        || profile.context_window < profile.max_output_tokens
        || profile.context_window > 10_000_000
    {
        return Err("Gateway model and verified context/output limits are required".into());
    }
    Ok(profile)
}

pub(crate) fn probe(profile: &Profile, key: &str) -> Result<(), String> {
    let catalog = probe_catalog(profile, key)?;
    if !catalog["data"].as_array().is_some_and(|models| {
        models
            .iter()
            .any(|model| model["id"].as_str() == Some(profile.model.as_str()))
    }) {
        return Err("Configured gateway model/combo is absent from the catalog; select another connection in Settings → Providers".into());
    }
    Ok(())
}

pub(crate) fn probe_catalog(profile: &Profile, key: &str) -> Result<Value, String> {
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("Enter a valid gateway API key in Settings → Providers".into());
    }
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(5))
        .build();
    let catalog_url = format!("{}/models", profile.endpoint.trim_end_matches('/'));
    let inference_url = format!(
        "{}/chat/completions",
        profile.endpoint.trim_end_matches('/')
    );
    match agent
        .post(&inference_url)
        .set("Content-Type", "application/json")
        .send_string("{}")
    {
        Err(ureq::Error::Status(401 | 403, _)) => {}
        Err(ureq::Error::Transport(_)) => {
            return Err("Gateway unreachable; no direct fallback".into())
        }
        Err(ureq::Error::Status(status, _)) => {
            return Err(format!(
                "Gateway authentication probe failed (HTTP {status}); expected 401/403 without a key; verify Require API Key in 9router; no direct fallback"
            ))
        }
        _ => {
            return Err(
                "Gateway must reject unauthenticated requests; enable Require API Key in 9router"
                    .into(),
            )
        }
    }
    match agent
        .post(&inference_url)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {key}"))
        .send_string("{}")
    {
        Err(ureq::Error::Status(400, response)) => {
            let body: Value = serde_json::from_reader(response.into_reader().take(64 * 1024))
                .map_err(|_| "Gateway authentication probe returned invalid JSON".to_string())?;
            if body["error"]["message"].as_str() != Some("Missing model") {
                return Err(
                    "Gateway does not support the zero-inference authentication probe".into(),
                );
            }
        }
        Err(ureq::Error::Status(status, _)) => {
            return Err(format!(
                "Gateway authentication failed (HTTP {status}); no direct fallback"
            ))
        }
        _ => return Err("Gateway authentication probe failed; no direct fallback".into()),
    }
    let response = agent
        .get(&catalog_url)
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(|error| match error {
            ureq::Error::Status(status, _) => {
                format!("Gateway model probe failed (HTTP {status}); no direct fallback")
            }
            ureq::Error::Transport(_) => "Gateway unreachable; no direct fallback".into(),
        })?;
    if response.status() != 200 {
        return Err("Gateway redirects are not allowed".into());
    }
    let catalog: Value = serde_json::from_reader(response.into_reader().take(1024 * 1024))
        .map_err(|_| "Gateway returned an invalid model catalog".to_string())?;
    if !catalog["data"].is_array() {
        return Err("Gateway returned an invalid model catalog".into());
    }
    Ok(catalog)
}

#[allow(dead_code)]
fn config(profile: &Profile) -> String {
    config_for(profile, "luxecode")
}

pub(crate) fn config_for(profile: &Profile, provider: &str) -> String {
    json!({
        "enabled_providers": [provider],
        "model": format!("{provider}/{}", profile.model),
        "small_model": format!("{provider}/{}", profile.model),
        "provider": {
            (provider): {
                "npm": "@ai-sdk/openai-compatible",
                "name": "LuxeCode · 9router",
                "options": {"baseURL": profile.endpoint.trim_end_matches('/'), "apiKey": "{env:LUXECODE_9ROUTER_API_KEY}"},
                "models": {
                    (profile.model.as_str()): {
                        "name": profile.model,
                        "limit": {"context": profile.context_window, "output": profile.max_output_tokens}
                    }
                }
            }
        }
    }).to_string()
}

#[allow(dead_code)]
pub(crate) fn apply(cmd: &mut Command, data_dir: Option<&Path>) -> Result<(), String> {
    cmd.env_remove("LUXECODE_9ROUTER_API_KEY")
        .env_remove("LUXECODE_GATEWAY_PROFILE");
    let Some(data_dir) = data_dir else {
        return Ok(());
    };
    let Some(path) = std::env::var_os("LUXECODE_GATEWAY_PROFILE") else {
        if std::env::var_os("LUXECODE_9ROUTER_API_KEY").is_some() {
            return Err("Gateway key requires LUXECODE_GATEWAY_PROFILE; no direct fallback".into());
        }
        return Ok(());
    };
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "Could not read LUXECODE_GATEWAY_PROFILE".to_string())?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read gateway profile".to_string())?;
    let profile = parse_profile(&bytes)?;
    let key = std::env::var("LUXECODE_9ROUTER_API_KEY")
        .map_err(|_| "Set LUXECODE_9ROUTER_API_KEY before launching LuxeCode".to_string())?;
    probe(&profile, &key)?;
    configure(cmd, &data_dir.join("opencode-poc"), &key, config(&profile))
}

pub(crate) fn configure(
    cmd: &mut Command,
    root: &Path,
    key: &str,
    config: String,
) -> Result<(), String> {
    cmd.env_remove("OPENCODE_CONFIG")
        .env_remove("OPENCODE_CONFIG_DIR")
        .env_remove("OPENCODE_AUTH_JSON")
        .env_remove("OPENCODE_DB")
        .env_remove("OPENCODE_TUI_CONFIG")
        .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true");
    for (variable, folder) in [
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_DATA_HOME", "data"),
        ("XDG_CACHE_HOME", "cache"),
        ("XDG_STATE_HOME", "state"),
        ("OPENCODE_TEST_HOME", "home"),
    ] {
        let directory = root.join(folder);
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|_| "Could not create isolated OpenCode directories".to_string())?;
        cmd.env(variable, directory);
    }
    cmd.env("LUXECODE_9ROUTER_API_KEY", key)
        .env("OPENCODE_CONFIG_CONTENT", config);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};

    fn read_request(stream: &mut TcpStream) -> String {
        let mut reader = BufReader::new(stream);
        let mut request = String::new();
        loop {
            let mut line = String::new();
            assert!(reader.read_line(&mut line).unwrap() > 0);
            request.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        let length = request
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        reader.read_exact(&mut vec![0; length]).unwrap();
        request
    }

    fn profile(endpoint: &str) -> Result<Profile, String> {
        parse_profile(json!({"endpoint": endpoint, "model": "coding", "contextWindow": 32768, "maxOutputTokens": 8192}).to_string().as_bytes())
    }

    #[test]
    fn validates_endpoint_and_model_limits() {
        for endpoint in [
            "http://127.0.0.1:20128/v1",
            "http://[::1]:20128/v1",
            "https://gateway.example/v1",
        ] {
            assert!(profile(endpoint).is_ok());
        }
        for endpoint in [
            "http://gateway.example/v1",
            "https://user:key@example.com/v1",
            "file:///tmp/config",
            "https://example.com/v1?key=secret",
            "https://example.com/#secret",
        ] {
            assert!(profile(endpoint).is_err());
        }
        assert!(parse_profile(br#"{"endpoint":"http://localhost/v1","model":"coding","contextWindow":10,"maxOutputTokens":20}"#).is_err());
        assert!(parse_profile(br#"{"endpoint":"http://localhost/v1","model":"coding","contextWindow":100,"maxOutputTokens":20,"apiKey":"must-not-persist"}"#).is_err());
    }

    #[test]
    fn config_restricts_main_and_auxiliary_models_to_gateway() {
        let profile = profile("http://127.0.0.1:20128/v1/").unwrap();
        let config: Value = serde_json::from_str(&config(&profile)).unwrap();
        assert_eq!(config["enabled_providers"], json!(["luxecode"]));
        assert_eq!(config["model"], "luxecode/coding");
        assert_eq!(config["small_model"], config["model"]);
        assert_eq!(
            config["provider"]["luxecode"]["options"]["apiKey"],
            "{env:LUXECODE_9ROUTER_API_KEY}"
        );
        assert_eq!(
            config["provider"]["luxecode"]["options"]["baseURL"],
            "http://127.0.0.1:20128/v1"
        );
    }

    #[test]
    fn probe_requires_auth_catalog_and_rejects_redirects() {
        for (status, body, expected) in [
            (200, r#"{"data":[{"id":"coding"}]}"#, true),
            (200, r#"{"data":[]}"#, false),
            (401, "{}", false),
            (429, "{}", false),
            (500, "{}", false),
            (302, "{}", false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let profile =
                profile(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
            let (done_tx, done_rx) = std::sync::mpsc::channel();
            let server = std::thread::spawn(move || {
                for stage in 0..3 {
                    let authenticated = stage != 0;
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let request = read_request(&mut stream);
                    if stage < 2 {
                        assert!(request.starts_with("POST /v1/chat/completions "));
                        assert!(request.contains("Content-Type: application/json"));
                    } else {
                        assert!(request.starts_with("GET /v1/models "));
                    }
                    assert_eq!(
                        request.contains("Authorization: Bearer test-key"),
                        authenticated
                    );
                    let status = match stage {
                        0 => 401,
                        1 => 400,
                        _ => status,
                    };
                    let body = if stage == 1 {
                        r#"{"error":{"message":"Missing model"}}"#
                    } else {
                        body
                    };
                    write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\nLocation: http://127.0.0.1:1/steal\r\n\r\n{body}", body.len()).unwrap();
                }
                done_tx.send(()).unwrap();
            });
            let result = probe(&profile, "test-key");
            assert_eq!(result.is_ok(), expected, "{result:?}");
            done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            server.join().unwrap();
        }
    }

    #[test]
    fn other_providers_do_not_receive_gateway_secrets_or_profile() {
        let mut command = Command::new("unused");
        command
            .env("LUXECODE_9ROUTER_API_KEY", "test-key")
            .env("LUXECODE_GATEWAY_PROFILE", "test-profile");
        apply(&mut command, None).unwrap();
        for variable in ["LUXECODE_9ROUTER_API_KEY", "LUXECODE_GATEWAY_PROFILE"] {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == variable && value.is_none()));
        }
    }

    #[test]
    fn gateway_must_require_authentication() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let profile = profile(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            read_request(&mut stream);
            write!(
                stream,
                "HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            )
            .unwrap();
        });
        assert!(probe(&profile, "test-key")
            .unwrap_err()
            .contains("Require API Key"));
        server.join().unwrap();
    }
}
