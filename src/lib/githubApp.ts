// GitHub App integration (browser-side).
//   - beginInstall()          → window.location = /api/github/install
//   - handleCallback(...)     → POST /api/github/callback
//   - listAccessibleRepos()   → GET  /api/github/repos
//   - openPR(...)             → POST /api/github/prs
//   - commentOnIssue(...)     → POST /api/github/issues
//   - getInstallStatus()      → GET  /api/github/status
//
// The browser is the only place that can do `window.location`, so the install
// flow always passes through the worker (`/api/github/install` does a 302 to
// https://github.com/apps/<slug>/installations/new?state=<csrf>, then GitHub
// redirects back to `/api/github/callback?installation_id=...&state=...`).

export interface GhAppRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
}

export interface GhAppAccount {
  id: number;
  login: string;
  type?: string;
  avatar_url?: string;
}

export interface GhInstallStatus {
  installed: boolean;
  account: GhAppAccount | null;
  repos: GhAppRepo[];
  configured: boolean;
  appSlug?: string | null;
}

export interface GhAppStoredInstall {
  installationId: string;
  installedAt: number;
}

const STORAGE_KEY = "openthink_gh_app_v1";

function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("openthink_api_url") || window.location.origin;
}

function readStoredInstall(): GhAppStoredInstall | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GhAppStoredInstall>;
    if (typeof parsed.installationId === "string" && parsed.installationId.length > 0) {
      return {
        installationId: parsed.installationId,
        installedAt: typeof parsed.installedAt === "number" ? parsed.installedAt : Date.now(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function writeStoredInstall(installationId: string): void {
  if (typeof window === "undefined") return;
  const stored: GhAppStoredInstall = { installationId, installedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function clearStoredInstall(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getInstallationId(): string | null {
  return readStoredInstall()?.installationId ?? null;
}

export function setInstallationId(id: string): void {
  writeStoredInstall(id);
}

export function clearInstallationId(): void {
  clearStoredInstall();
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const r = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
  const text = await r.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!r.ok) {
    const msg = data?.error || data?.description || `HTTP ${r.status}`;
    const err = new Error(msg) as Error & { status?: number; payload?: any };
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}

export function beginInstall(_redirectBack: string = "/github"): void {
  if (typeof window === "undefined") return;
  const base = getApiBase();
  const url = new URL("/api/github/install", base);
  if (_redirectBack && _redirectBack !== "/github") {
    url.searchParams.set("next", _redirectBack);
  }
  window.location.href = url.toString();
}

export interface CallbackResult {
  ok: boolean;
  repos: GhAppRepo[];
  user: GhAppAccount | null;
  installationId?: string;
  error?: string;
}

export async function handleCallback(
  code: string,
  installationId: string,
): Promise<CallbackResult> {
  const data = await apiFetch<{
    ok: boolean;
    user: GhAppAccount | null;
    repos: GhAppRepo[];
    installationId?: string;
    error?: string;
  }>("/api/github/callback", {
    method: "POST",
    body: JSON.stringify({ code, installationId }),
  });
  if (data.installationId) writeStoredInstall(data.installationId);
  return {
    ok: !!data.ok,
    repos: Array.isArray(data.repos) ? data.repos : [],
    user: data.user ?? null,
    installationId: data.installationId,
    error: data.error,
  };
}

export async function listAccessibleRepos(): Promise<GhAppRepo[]> {
  const data = await apiFetch<{ repos: GhAppRepo[] }>("/api/github/repos");
  return Array.isArray(data.repos) ? data.repos : [];
}

export interface OpenPRParams {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}

export interface OpenPRResult {
  ok: boolean;
  prNumber?: number;
  url?: string;
  head?: string;
  base?: string;
  files?: number;
  error?: string;
  description?: string;
}

export async function openPR(params: OpenPRParams): Promise<OpenPRResult> {
  return apiFetch<OpenPRResult>("/api/github/prs", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export interface CommentIssueParams {
  owner: string;
  repo: string;
  number: number;
  body: string;
}

export interface CommentIssueResult {
  ok: boolean;
  url?: string;
  id?: number;
  error?: string;
}

export async function commentOnIssue(params: CommentIssueParams): Promise<CommentIssueResult> {
  return apiFetch<CommentIssueResult>("/api/github/issues", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getInstallStatus(): Promise<GhInstallStatus> {
  return apiFetch<GhInstallStatus>("/api/github/status");
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function parseFilesTextarea(text: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const path = line.slice(0, colon).trim();
    const content = line.slice(colon + 1).trim();
    if (!path || !content) continue;
    out.push({ path, content });
  }
  return out;
}
