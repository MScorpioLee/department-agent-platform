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
