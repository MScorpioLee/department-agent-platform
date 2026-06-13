export type ClientTarget = "web" | "desktop";

type TauriGlobal = typeof globalThis & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
  };
  __TAURI_INTERNALS__?: unknown;
};

export function getClientTarget(): ClientTarget {
  if (process.env.NEXT_PUBLIC_CLIENT_TARGET === "desktop") {
    return "desktop";
  }

  const runtime = globalThis as TauriGlobal;
  if (runtime.__TAURI__ || runtime.__TAURI_INTERNALS__) {
    return "desktop";
  }

  return "web";
}

export function isDesktopClient(): boolean {
  return getClientTarget() === "desktop";
}

// 客户端画像:console=管理端(默认,全功能按角色);coder=聚焦编码客户端(独立用户端 App)。
// 由构建期 NEXT_PUBLIC_CLIENT_PROFILE 决定(见 desktop/src-tauri/tauri.coder.conf.json)。
export type ClientProfile = "console" | "coder";

export function getClientProfile(): ClientProfile {
  return process.env.NEXT_PUBLIC_CLIENT_PROFILE === "coder" ? "coder" : "console";
}

export function isCoderProfile(): boolean {
  return getClientProfile() === "coder";
}
