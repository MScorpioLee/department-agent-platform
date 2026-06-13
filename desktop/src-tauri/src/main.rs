#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command as ProcCommand,
    sync::Mutex
};
use tauri::{tray::TrayIconBuilder, AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const TOOL_OUTPUT_CAP: usize = 30_000; // 单次工具输出进入对话的上限(字节)

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

/// 首次启动引导探测(无需 token):查目标服务器是否空库(needs_setup),从 Rust 侧请求避 CSP/CORS。
#[tauri::command(rename_all = "camelCase")]
async fn desktop_setup_status(server_url: String) -> DesktopResult<Value> {
    let url = api_url(&normalize_server_url(&server_url)?, "/auth/setup-status")?;
    let response = Client::new()
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| DesktopError::internal(format!("请求 Agent Server 失败: {error}")))?;
    let status = response.status();
    let body = read_response_body(response).await?;
    if !status.is_success() {
        return Err(DesktopError::http(status, &body));
    }
    Ok(body)
}

/// 自助注册(无需 token):从 Rust 侧 POST /api/register,绕过 webview 的 CSP/CORS 限制。
#[tauri::command(rename_all = "camelCase")]
async fn desktop_register(
    server_url: String,
    username: String,
    password: String,
    display_name: Option<String>,
    note: Option<String>
) -> DesktopResult<Value> {
    let url = api_url(&normalize_server_url(&server_url)?, "/register")?;
    let mut payload = json!({ "username": username, "password": password });
    if let Some(value) = display_name.filter(|v| !v.is_empty()) {
        payload["display_name"] = json!(value);
    }
    if let Some(value) = note.filter(|v| !v.is_empty()) {
        payload["note"] = json!(value);
    }
    let response = Client::new()
        .post(url)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| DesktopError::internal(format!("请求 Agent Server 失败: {error}")))?;
    let status = response.status();
    let body = read_response_body(response).await?;
    if !status.is_success() {
        return Err(DesktopError::http(status, &body));
    }
    Ok(body)
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

// ---------- 本地编码 Agent:工作区内的文件/命令工具(安全边界在 Rust 强制)----------

#[derive(Default)]
struct WorkspaceState(Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
struct CommandResult {
    exit_code: i32,
    stdout: String,
    stderr: String
}

fn path_denied() -> DesktopError {
    DesktopError::new(Some(403), "path_denied", "路径不在工作区目录内")
}

/// 把相对路径词法解析到工作区内;遇到 `..` 越过根、或绝对路径,一律拒绝(不触碰文件系统)。
fn normalize_within(root: &Path, rel: &str) -> DesktopResult<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(path_denied());
    }
    let root_depth = root.components().count();
    let mut result = root.to_path_buf();
    let mut depth = root_depth;
    for comp in rel_path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if depth <= root_depth {
                    return Err(path_denied());
                }
                result.pop();
                depth -= 1;
            }
            Component::Normal(part) => {
                result.push(part);
                depth += 1;
            }
            _ => return Err(path_denied())
        }
    }
    Ok(result)
}

fn cap_output(mut text: String) -> String {
    if text.len() > TOOL_OUTPUT_CAP {
        text.truncate(TOOL_OUTPUT_CAP);
        text.push_str("\n…(已截断)");
    }
    text
}

fn workspace_root(state: &State<WorkspaceState>) -> DesktopResult<PathBuf> {
    state
        .0
        .lock()
        .map_err(|_| DesktopError::internal("工作区状态锁定失败"))?
        .clone()
        .ok_or_else(|| DesktopError::new(Some(409), "no_workspace", "请先选择项目目录"))
}

#[tauri::command(rename_all = "camelCase")]
fn agent_set_workspace(state: State<WorkspaceState>, path: String) -> DesktopResult<String> {
    let canonical = fs::canonicalize(&path)
        .map_err(|error| DesktopError::new(Some(400), "invalid_workspace", format!("目录无效: {error}")))?;
    if !canonical.is_dir() {
        return Err(DesktopError::new(Some(400), "invalid_workspace", "请选择一个目录"));
    }
    let display = canonical.to_string_lossy().to_string();
    *state.0.lock().map_err(|_| DesktopError::internal("工作区状态锁定失败"))? = Some(canonical);
    Ok(display)
}

#[tauri::command]
fn agent_get_workspace(state: State<WorkspaceState>) -> DesktopResult<Option<String>> {
    Ok(state
        .0
        .lock()
        .map_err(|_| DesktopError::internal("工作区状态锁定失败"))?
        .as_ref()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn agent_list_files(state: State<WorkspaceState>, path: String) -> DesktopResult<Vec<String>> {
    let root = workspace_root(&state)?;
    let target = normalize_within(&root, if path.is_empty() { "." } else { &path })?;
    let mut entries: Vec<String> = fs::read_dir(&target)
        .map_err(|error| DesktopError::internal(format!("读取目录失败: {error}")))?
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_dir() {
                format!("{name}/")
            } else {
                name
            }
        })
        .collect();
    entries.sort();
    entries.truncate(500);
    Ok(entries)
}

#[tauri::command]
fn agent_read_file(state: State<WorkspaceState>, path: String) -> DesktopResult<String> {
    let root = workspace_root(&state)?;
    let target = normalize_within(&root, &path)?;
    let text = fs::read_to_string(&target)
        .map_err(|error| DesktopError::new(Some(404), "read_failed", format!("读取失败: {error}")))?;
    Ok(cap_output(text))
}

#[tauri::command]
fn agent_write_file(state: State<WorkspaceState>, path: String, content: String) -> DesktopResult<usize> {
    let root = workspace_root(&state)?;
    let target = normalize_within(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| DesktopError::internal(format!("创建目录失败: {error}")))?;
    }
    fs::write(&target, &content)
        .map_err(|error| DesktopError::internal(format!("写入失败: {error}")))?;
    Ok(content.len())
}

#[tauri::command]
fn agent_run_command(state: State<WorkspaceState>, command: String) -> DesktopResult<CommandResult> {
    let root = workspace_root(&state)?;
    if command.trim().is_empty() {
        return Err(DesktopError::new(Some(400), "payload_invalid", "命令不能为空"));
    }
    let output = if cfg!(target_os = "windows") {
        ProcCommand::new("cmd").args(["/C", &command]).current_dir(&root).output()
    } else {
        ProcCommand::new("sh").args(["-c", &command]).current_dir(&root).output()
    }
    .map_err(|error| DesktopError::internal(format!("执行失败: {error}")))?;
    Ok(CommandResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: cap_output(String::from_utf8_lossy(&output.stdout).to_string()),
        stderr: cap_output(String::from_utf8_lossy(&output.stderr).to_string())
    })
}

/// 经平台 /v1 中转调模型(token 留在 Rust 钥匙串,webview 不碰)。
#[tauri::command(rename_all = "camelCase")]
async fn agent_model_chat(app: AppHandle, messages: Value, tools: Option<Value>) -> DesktopResult<Value> {
    let config = read_config(&app)?;
    let token = load_token()?;
    let url = format!("{}/v1/chat/completions", config.server_url);
    let mut payload = json!({ "messages": messages });
    if let Some(tools) = tools {
        payload["tools"] = tools;
    }
    let response = Client::new()
        .post(url)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| DesktopError::internal(format!("请求模型中转失败: {error}")))?;
    let status = response.status();
    let body = read_response_body(response).await?;
    if !status.is_success() {
        return Err(DesktopError::http(status, &body));
    }
    Ok(body)
}

fn main() {
    tauri::Builder::default()
        .manage(WorkspaceState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            TrayIconBuilder::new()
                .tooltip("Agent 控制台")
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_login,
            desktop_setup_status,
            desktop_register,
            desktop_get_me,
            desktop_logout,
            desktop_api_request,
            desktop_get_server_url,
            desktop_set_server_url,
            desktop_notify,
            agent_set_workspace,
            agent_get_workspace,
            agent_list_files,
            agent_read_file,
            agent_write_file,
            agent_run_command,
            agent_model_chat
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

    #[test]
    fn normalize_keeps_paths_inside_workspace() {
        let root = Path::new("/home/u/proj");
        assert_eq!(
            normalize_within(root, "src/main.rs").unwrap(),
            PathBuf::from("/home/u/proj/src/main.rs")
        );
        assert_eq!(normalize_within(root, ".").unwrap(), PathBuf::from("/home/u/proj"));
        // 进子目录再回到根仍合法
        assert_eq!(
            normalize_within(root, "src/../README.md").unwrap(),
            PathBuf::from("/home/u/proj/README.md")
        );
    }

    #[test]
    fn normalize_rejects_escape_and_absolute() {
        let root = Path::new("/home/u/proj");
        assert_eq!(normalize_within(root, "../secret").unwrap_err().code, "path_denied");
        assert_eq!(normalize_within(root, "src/../../etc/passwd").unwrap_err().code, "path_denied");
        assert_eq!(normalize_within(root, "/etc/passwd").unwrap_err().code, "path_denied");
    }
}
