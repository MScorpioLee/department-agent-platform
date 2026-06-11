import type { User } from "@/lib/types";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriGlobal = typeof globalThis & {
  __TAURI__?: {
    core?: {
      invoke?: Invoke;
    };
  };
};

export interface DesktopHttpResponse {
  status: number;
  body: unknown;
}

export interface DesktopLoginOptions {
  serverUrl?: string;
}

async function getInvoke(): Promise<Invoke> {
  const globalInvoke = (globalThis as TauriGlobal).__TAURI__?.core?.invoke;
  if (globalInvoke) return globalInvoke;

  const api = await import("@tauri-apps/api/core");
  return api.invoke as Invoke;
}

export async function desktopLogin(
  username: string,
  password: string,
  options: DesktopLoginOptions = {}
): Promise<User> {
  const invoke = await getInvoke();
  return invoke<User>("desktop_login", {
    serverUrl: options.serverUrl ?? "",
    username,
    password
  });
}

export async function desktopGetMe(): Promise<User> {
  const invoke = await getInvoke();
  return invoke<User>("desktop_get_me", {});
}

export async function desktopLogout(): Promise<void> {
  const invoke = await getInvoke();
  await invoke<void>("desktop_logout", {});
}

export async function desktopApiFetch(
  path: string,
  init: RequestInit = {},
  prefix = "/api/proxy"
): Promise<DesktopHttpResponse> {
  const invoke = await getInvoke();
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
  const directPath = prefix === "/api/auth" ? `/auth${path}` : path;

  return invoke<DesktopHttpResponse>("desktop_api_request", {
    method,
    path: directPath,
    body
  });
}

export async function getDesktopServerUrl(): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("desktop_get_server_url", {});
}

export async function setDesktopServerUrl(serverUrl: string): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("desktop_set_server_url", { serverUrl });
}

export async function notifyDesktop(title: string, body: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke<void>("desktop_notify", { title, body });
}
