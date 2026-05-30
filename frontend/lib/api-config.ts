/**
 * Public API endpoints for the CivicVox dashboard.
 * Set in .env.local (dev) or Vercel Production env (deploy).
 *
 * Tailscale Funnel example:
 *   NEXT_PUBLIC_API_URL=https://your-machine.your-tailnet.ts.net
 *   NEXT_PUBLIC_WS_URL=wss://your-machine.your-tailnet.ts.net
 *   (path /ws/stream is appended automatically when omitted)
 */

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const WS_STREAM_PATH = "/ws/stream";

/** Derive wss/ws URL from https/http API base when WS env is omitted. */
export function deriveWebSocketUrl(apiBaseUrl: string): string {
  const base = trimTrailingSlash(apiBaseUrl);
  if (!base) return "";
  const wsOrigin = base
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  return `${wsOrigin}${WS_STREAM_PATH}`;
}

/** Accept full ws URL or WSS base only (appends /ws/stream). */
function resolveWebSocketUrl(rawWs: string, apiUrl: string): string {
  const trimmed = trimTrailingSlash(rawWs);
  if (!trimmed) return deriveWebSocketUrl(apiUrl);
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return `${trimmed}${WS_STREAM_PATH}`;
    }
  } catch {
    return deriveWebSocketUrl(apiUrl);
  }
  return trimmed;
}

const rawApi = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
const rawWs = process.env.NEXT_PUBLIC_WS_URL?.trim() ?? "";

export const API_URL = trimTrailingSlash(rawApi);
export const WS_URL = resolveWebSocketUrl(rawWs, API_URL);

export function isApiConfigured(): boolean {
  return API_URL.length > 0 && WS_URL.length > 0;
}

export function getApiConfigError(): string | null {
  if (!API_URL) {
    return "NEXT_PUBLIC_API_URL is not set. Add it to .env.local or Vercel project settings.";
  }
  if (!WS_URL) {
    return "NEXT_PUBLIC_WS_URL is not set and could not be derived from NEXT_PUBLIC_API_URL.";
  }
  return null;
}
