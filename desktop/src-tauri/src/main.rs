#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{tray::TrayIconBuilder, AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:8700";
const KEYCHAIN_SERVICE: &str = "department-agent-desktop";
const KEYCHAIN_ACCOUNT: &str = "agent-token";

type DesktopResult<T> = Result<T, DesktopError>;

#[derive(Debug, Serialize)]
struct DesktopError {
    status: Option<u16>,
    code: String,
    message: String
}

impl DesktopError {
    fn new(status: Option<u16>, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into()
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(None, "desktop_error", message)
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(Some(401), "unauthorized", message)
    }

    fn http(status: StatusCode, body: &Value) -> Self {
        if let Some(error) = body.get("error").and_then(Value::as_object) {
            let code = error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("http_error");
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("请求失败");
            return Self::new(Some(status.as_u16()), code, message);
        }

        Self::new(
            Some(status.as_u16()),
            "http_error",
            format!("请求失败({})", status.as_u16())
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopConfig {
    #[serde(default = "default_server_url")]
    server_url: String
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            server_url: default_server_url()
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct UserDto {
    id: String,
    username: String,
    #[serde(default)]
    display_name: String,
    role: String
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    token: String,
    user: UserDto
}

#[derive(Debug, Serialize)]
struct DesktopHttpResponse {
    status: u16,
    body: Value
}

fn default_server_url() -> String {
    DEFAULT_SERVER_URL.to_string()
}

fn normalize_server_url(server_url: &str) -> DesktopResult<String> {
    let candidate = if server_url.trim().is_empty() {
        DEFAULT_SERVER_URL
    } else {
        server_url.trim()
    };
    let parsed = Url::parse(candidate)
        .map_err(|_| DesktopError::new(None, "invalid_server_url", "Server 地址格式不正确"))?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(DesktopError::new(
            None,
            "invalid_server_url",
            "Server 地址必须是 http(s) URL"
        ));
    }

    Ok(candidate.trim_end_matches('/').to_string())
}

fn api_url(server_url: &str, path: &str) -> DesktopResult<String> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains("://") || path.contains('\\') {
        return Err(DesktopError::new(
            None,
            "invalid_request_path",
            "请求路径必须是 Agent Server 的相对路径"
        ));
    }

    Ok(format!("{}/api{}", normalize_server_url(server_url)?, path))
}

fn config_path(app: &AppHandle) -> DesktopResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| DesktopError::internal(format!("读取配置目录失败: {error}")))?;
    fs::create_dir_all(&dir)
        .map_err(|error| DesktopError::internal(format!("创建配置目录失败: {error}")))?;
    Ok(dir.join("desktop-config.json"))
}

fn read_config(app: &AppHandle) -> DesktopResult<DesktopConfig> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(DesktopConfig::default());
    }

    let text = fs::read_to_string(&path)
        .map_err(|error| DesktopError::internal(format!("读取配置失败: {error}")))?;
    let mut config: DesktopConfig = serde_json::from_str(&text)
        .map_err(|error| DesktopError::internal(format!("解析配置失败: {error}")))?;
    config.server_url = normalize_server_url(&config.server_url)?;
    Ok(config)
}

fn write_config(app: &AppHandle, config: &DesktopConfig) -> DesktopResult<()> {
    let path = config_path(app)?;
    let text = serde_json::to_string_pretty(config)
        .map_err(|error| DesktopError::internal(format!("序列化配置失败: {error}")))?;
    fs::write(path, text)
        .map_err(|error| DesktopError::internal(format!("写入配置失败: {error}")))?;
    Ok(())
}

fn token_entry() -> DesktopResult<Entry> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|error| DesktopError::internal(format!("打开系统钥匙串失败: {error}")))
}

fn store_token(token: &str) -> DesktopResult<()> {
    token_entry()?
        .set_password(token)
        .map_err(|error| DesktopError::internal(format!("写入系统钥匙串失败: {error}")))
}

fn load_token() -> DesktopResult<String> {
    token_entry()?
        .get_password()
        .map_err(|_| DesktopError::unauthorized("请先登录"))
}

fn delete_token() {
    if let Ok(entry) = token_entry() {
        let _ = entry.delete_credential();
    }
}

async fn read_response_body(response: reqwest::Response) -> DesktopResult<Value> {
    let text = response
        .text()
        .await
        .map_err(|error| DesktopError::internal(format!("读取响应失败: {error}")))?;

    if text.trim().is_empty() {
        return Ok(Value::Null);
    }

    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

async fn send_authenticated_json(
    app: &AppHandle,
    method: Method,
    path: &str,
    body: Option<Value>
) -> DesktopResult<(StatusCode, Value)> {
    let config = read_config(app)?;
    let token = load_token()?;
    let url = api_url(&config.server_url, path)?;
    let client = Client::new();
    let mut request = client
        .request(method, url)
        .bearer_auth(token)
        .header("Accept", "application/json");

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| DesktopError::internal(format!("请求 Agent Server 失败: {error}")))?;
    let status = response.status();
    let body = read_response_body(response).await?;
    Ok((status, body))
}

#[tauri::command(rename_all = "camelCase")]
async fn desktop_login(
    app: AppHandle,
    server_url: String,
    username: String,
    password: String
) -> DesktopResult<UserDto> {
    let normalized_server_url = normalize_server_url(&server_url)?;
    let url = api_url(&normalized_server_url, "/auth/login")?;
    let response = Client::new()
        .post(url)
        .header("Accept", "application/json")
        .json(&json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|error| DesktopError::internal(format!("请求 Agent Server 失败: {error}")))?;
    let status = response.status();
    let body = read_response_body(response).await?;

    if !status.is_success() {
        return Err(DesktopError::http(status, &body));
    }

    let login_response: LoginResponse = serde_json::from_value(body)
        .map_err(|error| DesktopError::internal(format!("登录响应格式不正确: {error}")))?;
    store_token(&login_response.token)?;
    write_config(
        &app,
        &DesktopConfig {
            server_url: normalized_server_url
        }
    )?;
    Ok(login_response.user)
}

#[tauri::command]
async fn desktop_get_me(app: AppHandle) -> DesktopResult<UserDto> {
    let (status, body) = send_authenticated_json(&app, Method::GET, "/auth/me", None).await?;
    if !status.is_success() {
        return Err(DesktopError::http(status, &body));
    }

    serde_json::from_value(body)
        .map_err(|error| DesktopError::internal(format!("用户响应格式不正确: {error}")))
}

#[tauri::command]
fn desktop_logout() -> DesktopResult<()> {
    delete_token();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn desktop_api_request(
    app: AppHandle,
    method: String,
    path: String,
    body: Option<Value>
) -> DesktopResult<DesktopHttpResponse> {
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|_| DesktopError::new(None, "invalid_method", "HTTP 方法不正确"))?;
    let (status, body) = send_authenticated_json(&app, method, &path, body).await?;
    Ok(DesktopHttpResponse {
        status: status.as_u16(),
        body
    })
}

#[tauri::command]
fn desktop_get_server_url(app: AppHandle) -> DesktopResult<String> {
    Ok(read_config(&app)?.server_url)
}

#[tauri::command(rename_all = "camelCase")]
fn desktop_set_server_url(app: AppHandle, server_url: String) -> DesktopResult<String> {
    let normalized_server_url = normalize_server_url(&server_url)?;
    write_config(
        &app,
        &DesktopConfig {
            server_url: normalized_server_url.clone()
        }
    )?;
    Ok(normalized_server_url)
}

#[tauri::command]
fn desktop_notify(app: AppHandle, title: String, body: String) -> DesktopResult<()> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| DesktopError::internal(format!("发送系统通知失败: {error}")))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            TrayIconBuilder::new()
                .tooltip("Agent 控制台")
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_login,
            desktop_get_me,
            desktop_logout,
            desktop_api_request,
            desktop_get_server_url,
            desktop_set_server_url,
            desktop_notify
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_url() {
        assert_eq!(
            normalize_server_url(" http://127.0.0.1:8700/ ").unwrap(),
            "http://127.0.0.1:8700"
        );
    }

    #[test]
    fn rejects_non_http_server_url() {
        let error = normalize_server_url("file:///tmp/agent").unwrap_err();
        assert_eq!(error.code, "invalid_server_url");
    }

    #[test]
    fn builds_agent_api_url() {
        assert_eq!(
            api_url("https://agent.example.com/", "/machines?limit=20").unwrap(),
            "https://agent.example.com/api/machines?limit=20"
        );
    }

    #[test]
    fn rejects_absolute_request_path() {
        let error = api_url("http://127.0.0.1:8700", "https://example.com").unwrap_err();
        assert_eq!(error.code, "invalid_request_path");
    }
}
