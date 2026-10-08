use crate::gateway::{self, Profile};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.luxecode.desktop.9router";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavedProfile {
    id: String,
    name: String,
    #[serde(flatten)]
    connection: Profile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogModel {
    id: String,
    name: String,
    is_combo: bool,
    context_window: Option<u64>,
    max_output_tokens: Option<u64>,
}

fn profile_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 {
        return Err("Invalid gateway profile ID".into());
    }
    Ok(root.join("gateway-profiles").join(format!("{id}.json")))
}

fn read_profile(root: &Path, id: &str) -> Result<SavedProfile, String> {
    let path = profile_path(root, id)?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| {
            "Gateway connection not found; restore it in Settings → Providers. No direct fallback."
                .to_string()
        })?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read gateway connection".to_string())?;
    if bytes.len() > 16 * 1024 {
        return Err("Gateway connection is too large".into());
    }
    let saved: SavedProfile = serde_json::from_slice(&bytes).map_err(|_| {
        "Gateway connection is invalid; recreate it in Settings → Providers".to_string()
    })?;
    if saved.id != id {
        return Err("Gateway connection ID mismatch".into());
    }
    gateway::parse_profile(
        &serde_json::to_vec(&saved.connection).map_err(|_| "Invalid gateway connection")?,
    )?;
    Ok(saved)
}

fn write_profile(root: &Path, saved: &SavedProfile) -> Result<(), String> {
    let destination = profile_path(root, &saved.id)?;
    let directory = destination.parent().ok_or("Invalid gateway directory")?;
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(directory)
        .map_err(|_| "Could not create gateway directory")?;
    let temporary = destination.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not create gateway connection")?;
        file.write_all(&serde_json::to_vec(saved).map_err(|_| "Invalid gateway connection")?)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save gateway connection")?;
        std::fs::rename(&temporary, &destination)
            .map_err(|_| "Could not finish saving gateway connection")
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result.map_err(str::to_string)
}

#[cfg(target_os = "macos")]
fn secret(id: &str) -> Result<String, String> {
    let bytes = security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, id)
        .map_err(|_| "Gateway key unavailable; unlock macOS Keychain or replace the key in Settings → Providers. No direct fallback.".to_string())?;
    String::from_utf8(bytes).map_err(|_| "Invalid gateway key in macOS Keychain".into())
}

#[cfg(target_os = "macos")]
fn set_secret(id: &str, key: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, id, key.as_bytes())
        .map_err(|_| "Could not save gateway key; unlock macOS Keychain and retry".into())
}

#[cfg(not(target_os = "macos"))]
fn secret(_id: &str) -> Result<String, String> {
    Err("Gateway MVP requires macOS Keychain; other platforms are not enabled".into())
}

#[cfg(not(target_os = "macos"))]
fn set_secret(_id: &str, _key: &str) -> Result<(), String> {
    Err("Gateway MVP requires macOS Keychain; other platforms are not enabled".into())
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "LuxeCode data directory unavailable".into())
}

#[tauri::command]
pub(crate) async fn gateway_profiles(app: tauri::AppHandle) -> Result<Vec<SavedProfile>, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = root.join("gateway-profiles");
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut profiles = Vec::new();
        for entry in
            std::fs::read_dir(directory).map_err(|_| "Could not list gateway connections")?
        {
            let path = entry
                .map_err(|_| "Could not list gateway connections")?
                .path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let id = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .ok_or("Invalid gateway filename")?;
                profiles.push(read_profile(&root, id)?);
            }
        }
        profiles.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(profiles)
    })
    .await
    .map_err(|_| "Gateway operation interrupted".to_string())?
}

#[tauri::command]
pub(crate) async fn gateway_test(
    endpoint: String,
    key: String,
) -> Result<Vec<CatalogModel>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile = gateway::parse_profile(&serde_json::to_vec(&serde_json::json!({
            "endpoint": endpoint, "model": "catalog-probe", "contextWindow": 1, "maxOutputTokens": 1,
        })).map_err(|_| "Invalid endpoint")?)?;
        let catalog = gateway::probe_catalog(&profile, &key)?;
        let mut models: Vec<CatalogModel> = catalog["data"].as_array().ok_or("Invalid gateway catalog")?.iter().filter_map(|model| {
            let id = model["id"].as_str()?;
            let mut connection = profile.clone();
            connection.model = id.into();
            gateway::parse_profile(&serde_json::to_vec(&connection).ok()?).ok()?;
            Some(CatalogModel {
                id: id.into(),
                name: model["name"].as_str().unwrap_or(id).chars().filter(|value| !value.is_control()).take(200).collect(),
                is_combo: model["isCombo"].as_bool() == Some(true) || model["owned_by"].as_str() == Some("combo"),
                context_window: model.pointer("/limit/context").and_then(Value::as_u64),
                max_output_tokens: model.pointer("/limit/output").and_then(Value::as_u64),
            })
        }).collect();
        models.sort_by(|left, right| left.id.cmp(&right.id));
        models.dedup_by(|left, right| left.id == right.id);
        if models.is_empty() { return Err("Gateway catalog is empty; create a model/combo in 9router first".into()); }
        Ok(models)
    }).await.map_err(|_| "Gateway operation interrupted".to_string())?
}

#[tauri::command]
pub(crate) async fn gateway_create(
    app: tauri::AppHandle,
    name: String,
    connection: Profile,
    key: String,
) -> Result<SavedProfile, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let name = name.trim().to_string();
        if name.is_empty() || name.len() > 100 || name.chars().any(char::is_control) {
            return Err("Gateway connection name must contain 1–100 characters".into());
        }
        let connection = gateway::parse_profile(
            &serde_json::to_vec(&connection).map_err(|_| "Invalid gateway connection")?,
        )?;
        gateway::probe(&connection, &key)?;
        let saved = SavedProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            connection,
        };
        set_secret(&saved.id, &key)?;
        if let Err(error) = write_profile(&root, &saved) {
            #[cfg(target_os = "macos")]
            let _ =
                security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, &saved.id);
            return Err(error);
        }
        Ok(saved)
    })
    .await
    .map_err(|_| "Gateway operation interrupted".to_string())?
}

#[tauri::command]
pub(crate) async fn gateway_rotate_key(
    app: tauri::AppHandle,
    profile_id: String,
    key: String,
) -> Result<(), String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let saved = read_profile(&root, &profile_id)?;
        gateway::probe(&saved.connection, &key)?;
        set_secret(&saved.id, &key)
    })
    .await
    .map_err(|_| "Gateway operation interrupted".to_string())?
}

pub(crate) fn apply(
    cmd: &mut Command,
    data_dir: Option<&Path>,
    profile_id: Option<&str>,
) -> Result<(), String> {
    cmd.env_remove("LUXECODE_9ROUTER_API_KEY")
        .env_remove("LUXECODE_GATEWAY_PROFILE");
    let Some(id) = profile_id else {
        return Ok(());
    };
    let root =
        data_dir.ok_or("Gateway connections are supported only by the local OpenCode engine")?;
    let saved = read_profile(root, id)?;
    let program = cmd
        .get_program()
        .to_str()
        .ok_or("Invalid OpenCode CLI path")?;
    let version = crate::harness::exec_output(
        program,
        &["--version".into()],
        None,
        std::time::Duration::from_secs(10),
    )?;
    if !version.status.success() || !supported_engine(&String::from_utf8_lossy(&version.stdout)) {
        return Err("Gateway isolation requires OpenCode 1.18.35 or newer; upgrade its CLI in Settings → Providers. No direct fallback.".into());
    }
    let key = secret(id)?;
    gateway::probe(&saved.connection, &key)?;
    configure_saved(cmd, root, &saved, &key)
}

fn supported_engine(output: &str) -> bool {
    output
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .any(|value| {
            let numbers = value
                .split('.')
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>();
            numbers
                .is_ok_and(|parts| parts.len() == 3 && parts.as_slice() >= [1, 18, 35].as_slice())
        })
}

fn configure_saved(
    cmd: &mut Command,
    root: &Path,
    saved: &SavedProfile,
    key: &str,
) -> Result<(), String> {
    let id = &saved.id;
    gateway::configure(
        cmd,
        &root.join("gateway-profiles").join(id).join("runtime"),
        key,
        gateway::config_for(&saved.connection, &format!("luxecode-{id}")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "writes a temporary fake credential in the local macOS Keychain"]
    fn keychain_round_trip_and_rotation() {
        let id = uuid::Uuid::new_v4().to_string();
        let result = (|| -> Result<(), String> {
            set_secret(&id, "luxecode-test-first-not-a-real-api-key")?;
            assert_eq!(secret(&id)?, "luxecode-test-first-not-a-real-api-key");
            set_secret(&id, "luxecode-test-rotated-not-a-real-api-key")?;
            assert_eq!(secret(&id)?, "luxecode-test-rotated-not-a-real-api-key");
            Ok(())
        })();
        let cleanup = security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, &id);
        result.unwrap();
        cleanup.unwrap();
        assert!(secret(&id).unwrap_err().contains("No direct fallback"));
    }

    #[test]
    fn immutable_profiles_round_trip_without_secrets_and_validate_ids() {
        let root = std::env::temp_dir().join(format!("luxecode-gateway-{}", uuid::Uuid::new_v4()));
        let saved = SavedProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Coding combo".into(),
            connection: Profile {
                endpoint: "http://127.0.0.1:20128/v1".into(),
                model: "coding".into(),
                context_window: 128000,
                max_output_tokens: 16000,
            },
        };
        write_profile(&root, &saved).unwrap();
        let restored = read_profile(&root, &saved.id).unwrap();
        assert_eq!(restored.connection.model, "coding");
        assert_eq!(restored.connection.endpoint, saved.connection.endpoint);
        let text = std::fs::read_to_string(profile_path(&root, &saved.id).unwrap()).unwrap();
        assert!(!text.contains("key"));
        assert!(profile_path(&root, "../../evil").is_err());
        assert!(read_profile(&root, &uuid::Uuid::new_v4().to_string())
            .unwrap_err()
            .contains("No direct fallback"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(profile_path(&root, &saved.id).unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn direct_mode_strips_gateway_secrets_and_never_loads_a_profile() {
        let mut command = Command::new("unused");
        command
            .env("LUXECODE_GATEWAY_PROFILE", "must-not-load")
            .env("LUXECODE_9ROUTER_API_KEY", "must-not-leak");
        apply(&mut command, None, None).unwrap();
        for variable in ["LUXECODE_GATEWAY_PROFILE", "LUXECODE_9ROUTER_API_KEY"] {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == variable && value.is_none()));
        }
        assert!(apply(&mut command, None, Some("profile")).is_err());
    }

    #[test]
    fn profiles_isolate_runtime_and_keep_main_and_auxiliary_models_on_the_same_gateway() {
        let root = std::env::temp_dir().join(format!("gateway-isolation-{}", uuid::Uuid::new_v4()));
        let mut directories = Vec::new();
        for model in ["coding-combo", "review-combo"] {
            let saved = SavedProfile {
                id: uuid::Uuid::new_v4().to_string(),
                name: model.into(),
                connection: Profile {
                    endpoint: "http://localhost:20128/v1".into(),
                    model: model.into(),
                    context_window: 128000,
                    max_output_tokens: 16000,
                },
            };
            let mut command = Command::new("unused");
            configure_saved(&mut command, &root, &saved, "test-key").unwrap();
            let environment: std::collections::BTreeMap<_, _> = command
                .get_envs()
                .filter_map(|(name, value)| {
                    value.map(|value| {
                        (
                            name.to_string_lossy().into_owned(),
                            value.to_string_lossy().into_owned(),
                        )
                    })
                })
                .collect();
            let config: Value =
                serde_json::from_str(&environment["OPENCODE_CONFIG_CONTENT"]).unwrap();
            assert_eq!(config["model"], format!("luxecode-{}/{model}", saved.id));
            assert_eq!(config["model"], config["small_model"]);
            assert_eq!(
                config["enabled_providers"],
                serde_json::json!([format!("luxecode-{}", saved.id)])
            );
            assert!(!environment["OPENCODE_CONFIG_CONTENT"].contains("test-key"));
            assert_eq!(environment["LUXECODE_9ROUTER_API_KEY"], "test-key");
            assert_eq!(environment["OPENCODE_DISABLE_PROJECT_CONFIG"], "true");
            directories.push(environment["XDG_DATA_HOME"].clone());
        }
        assert_ne!(directories[0], directories[1]);
        assert!(supported_engine("1.18.35"));
        assert!(supported_engine("opencode 1.19.0"));
        assert!(!supported_engine("1.18.34"));
        assert!(!supported_engine("invalid"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
