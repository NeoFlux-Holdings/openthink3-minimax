# OpenThink3 — Strategic Roadmap

This is a planning doc for the next 3-6 months of architecture work, distilled from prior chat sessions. The current branch is `openthink3` (mobile PWA + Worker at `worker/`). The aesthetic direction is **brutalist/refined-terminal** (sharp corners, monospace data, status dots, command-palette hero).

## 1. CF-Native Architecture (replace exe.dev default)

**Current state:** The repo references `https://exe.dev/` and `https://deepwiki.com/RhysSullivan/executor` as planned dependencies. The `DesktopRemotePanel` already lists `cloudflared` as the tunnel layer. The worker is live at `https://openthink3-worker.thomas-zarebczan.workers.dev` with KV namespaces, Durable Objects (THREAD_DO, ORCHESTRATOR_DO), Workers AI binding, and a per-user `X-CF-Token` / `X-CF-Account-Id` header scheme (`resolve-account` endpoint, deploy, sync all done).

**Target state:** Everything runs on Cloudflare where possible. exe.dev becomes a fallback ONLY for features CF cannot do (raw VMs, FUSE mounts, x86-only binaries, etc).

| Workload | CF-native replacement | exe.dev fallback? |
|---|---|---|
| LLM inference | Workers AI binding (`env.AI.run`) — already wired | No |
| Long-running agent loop | Durable Objects (`THREAD_DO`, `ORCHESTRATOR_DO`) — already wired | No |
| Memory / brain pages | PGLite inside a Worker (Postgres 17 via WASM, single-DB), or Supabase for shared brains | No |
| Scheduled jobs (dream cycle) | Cron Triggers (wrangler.toml `[triggers]`) | No |
| File storage | R2 bucket (cold + frequent) | No |
| KV config / state | KV namespaces (already: `MEMORIES`, `ARTIFACTS`) | No |
| Vector search | Vectorize index (Workers-native) | No |
| Code execution sandbox | Workers for Platforms (gVisor-isolated V8 isolates per session) | Yes for any untrusted code that needs > 30s CPU or Node APIs CF lacks |
| Tunnel to local agent | Cloudflare Tunnel (`cloudflared`) — already named | No |
| Local agent CLI | npx + remote MCP server, agent runs in user's shell, calls back via WSS tunnel | No |
| GitHub PRs from agent | GitHub App installation (Phase 1C, deferred — need App ID + private key from user) | No |
| Real browser automation | Browser Rendering (Cloudflare) | Yes for anything that needs real desktop Chrome |
| Long-tail background jobs (>15min) | Cron Triggers for sub-15min + Workflows (still in beta) for longer | Yes for hours-long |
| Websocket fanout for live agent streaming | Durable Objects with Hibernation (sleeps when idle, costs near-zero) | No |

**Action items:**
- [ ] Stand up a PGLite-based `MEMORIES` schema in `worker/` (currently KV-only). Add to wrangler.toml D1 or keep KV but switch values to JSON-serialized PGLite exports.
- [ ] Wire Workflows for the dream cycle (currently a hand-rolled loop in the brain) — `wrangler workflows` for the cron-driven consolidation.
- [ ] Add Vectorize index binding for the semantic layer.
- [ ] Move `env.CF_API_TOKEN` out of single-secret into per-user headers (done) + per-deployer token propagation (Phase 2C — the new worker gets the user's CF token as its own secret).

## 2. gbrain + gstack Skills (critical, on by default)

Reference: <https://github.com/garrytan/gbrain> and <https://github.com/garrytan/gstack>. gbrain is Garry Tan's PGLite-based synthesis + retrieval layer. gstack is his execution stack (the "do" half of "brain + hands"). gbrain-evals is the public benchmark.

**Default-on skills** (advanced users can disable in Settings):
- `gbrain-search` — `gbrain search "<query>"` returns hybrid-scored top pages. Wired into ThreadFeed's context builder so each AI turn includes top-5 relevant pages from the user's brain.
- `gbrain-think` — `gbrain think "<query>"` returns synthesized answer with citations + gap analysis. Wired into the chat when the user asks an open-ended question (heuristic: query > 6 words, no code blocks, no file refs).
- `gbrain-capture` — `gbrain capture --stdin` or `gbrain capture "<text>"` writes a new page. Wired into ThreadFeed's "save to brain" affordance + a slash-command `/capture`.
- `gbrain-evals-runner` — runs the gbrain-evals benchmark against the user's brain nightly, posts the scorecard to `/benchmarks` on the deployed site, updates the live score badge.

**Toggle:** A `gstack_enabled` field in `useDeployFlow` / per-user settings. Off by default only if gbrain server isn't reachable. Default ON.

**CF-native fit:** gbrain already runs on PGLite (WASM). It can run as a Worker endpoint or as a separate sidecar reachable over the WSS tunnel. The PGLite persistence layer is the same as we'd use for OpenThink3's own memory.

**Action items:**
- [ ] Add a Skills panel (existing `activeCanvasTab === 'skills'` — verify it works) with toggles for each gbrain/gstack skill.
- [ ] Bundle the gbrain CLI as a WASM-compiled worker (or sidecar via cloudflared tunnel) so end users don't need a separate install.
- [ ] Auto-post `gbrain-evals` results to a `benchmarks/` page on the deployed Cloudflare Pages site — live updated each night.

## 3. Plugin System + exe.dev / deepwiki support

The `PluginPanel` already exists. Add:

- **gbrain plugin** (above) — default ON
- **gstack plugin** — default ON  
- **exe.dev plugin** — default OFF, requires `EXE_API_KEY` env, opens sessions for code-execution workloads CF can't do
- **deepwiki plugin** — default ON, indexes the OpenThink3 + gbrain + gstack + exe.dev + cloudflare repos for "ask the docs"
- **Plugin authors** ship a `~/.opencode/plugins/<name>.ts` matching the contract below:

```ts
export default {
  name: "my-plugin",
  version: "1.0.0",
  defaultEnabled: false,
  requiresEnv: ["MY_API_KEY"],
  installHint: "Get a key at https://...",
  init: async (ctx) => { ... },
  tools: [{ name, description, schema, run }],
}
```

The plugin manager reads `~/.opencode/plugins/`, surfaces them in `PluginPanel`, and threads through to the opencode config.

## 4. Local Agent Connection (MCP server/client + CF tunnels)

A "thin" MCP server (no codex-app-server-level protocol) that exposes OpenThink3's main session as tools over HTTPS. Any MCP-capable client (Codex, Claude Code, Cursor, local opencode) can connect to the user's running OpenThink3 and:

- View + send chat messages
- Run skills + plugins
- Capture to the brain
- Spawn background tasks

The server runs in `worker/` as a `mcp` namespace; clients connect via:
```json
{
  "mcpServers": {
    "openthink3": {
      "url": "https://openthink3-worker.<account>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <user-session-token>" }
    }
  }
}
```

The user can ALSO run the agent locally (their laptop). The local agent is the *same* opencode config + skills, but pointing at a local gbrain + local R2 mirror. CF tunnel (`cloudflared tunnel create openthink3-local`) bridges the local agent to the cloud deployment so:
- Local debugging: the user can attach their editor to the running cloud session
- Remote commands: send a slash command from the laptop that runs in the cloud
- Cross-device sync: state is shared via DO, but compute can be local

**Premium tier:** this whole stack is gated behind "Pro" since it requires a stable tunnel + dedicated compute.

## 5. CF Tunnels for AI request routing (premium)

A "use my local Codex/Claude" feature. When the user wants a task that needs Claude Opus 4.6 but they're already on the OpenThink3 cloud, they can:

1. Open `Desktop` tab in Sidebar → "Connect local agent"
2. OpenThink3 shows a one-time `cloudflared` token + URL
3. User runs `cloudflared tunnel --token <token>` on their laptop
4. Now requests to `local://claude` from the cloud worker get proxied via the tunnel to the user's local Claude Code / Codex
5. The user gets billed on their local API key, results stream back

This is the "remote control feature" — and it's premium because it requires:
- A persistent tunnel
- Token-based auth (per session)
- A way to handle streaming responses that span 10+ minutes

**Action items:**
- [ ] Add `localAgent` field to `ThreadInfo` (URL of local agent if connected)
- [ ] New worker endpoint `POST /api/agent/local-proxy` that takes a `target: 'local' | 'cloud'`, looks up the tunnel, forwards the request, streams the response back
- [ ] UI in `DesktopRemotePanel` for setting up + monitoring the tunnel

## 6. Git via fork + envs (basic)

Each user gets a fork of `NeoFlux-Holdings/openthink3-minimax` under their own GitHub account. The fork is the "user's local copy" — they can edit, customize, PR back. The envs they set in their fork's `.env` (e.g. `GITHUB_TOKEN_FOR_GBRAIN`, `EXE_API_KEY`) get picked up by the worker at deploy time via a `POST /api/cf/github/sync-envs` endpoint that:
1. Reads the env file from the fork
2. Calls `PUT /accounts/<id>/workers/scripts/<worker>/secrets` to set each as a secret on their deployed worker
3. Triggers a worker re-deploy

This is the "bare minimum" git integration — they can edit their own deployment without forking the whole architecture.

## 7. UX flows for the premium features

When a user enables the local agent tunnel, the flow is:
- Settings → "Premium" → "Connect local agent" → modal with 3 steps
- Step 1: Show the cloudflared command (`cloudflared tunnel create openthink3-local-<userid>`)
- Step 2: Show the auth token + the URL to copy
- Step 3: Test connection → success → "Connected" badge in the Sidebar

When they want a request proxied:
- They can choose "engine" per task: `cloud` (Workers AI default) or `local` (their tunnel)
- Sidebar status bar shows: "engine: local · Claude Opus 4.6 · 1.2k tokens this turn"

## 8. Status of the design pass

- `100/100` on react-doctor
- `index.css` has a new brutalist/refined-terminal design system (mono, status dots, command-palette, status bars, bracket frames)
- `HomeView` is the new entry-point hero (eyebrow with live status, display title with accent italic, hero stats grid, command-palette input, action tiles grid, status bar)
- `Sidebar` uses the new system: `sidebar-section-label` (▸ prefix), `sidebar-new-task` (sharp accent button), `sidebar-item` (with active state with left border), `status-bar` footer
- `JetBrains Mono` is now loaded for all mono text
- Bug fix: Search/Library and Help/Learning no longer both highlight when the same tab is selected

## 9. Outstanding (sequential order, do these next session)

1. Verify the per-user CF credentials flow end-to-end (paste a real CF token, see it resolve, see /api/cf/manifest/manifest populate)
2. Stand up PGLite inside the worker for the MEMORIES schema
3. Wire gbrain + gstack skills into the OpenThink3 settings (default ON)
4. Build the plugin manager (load from `~/.opencode/plugins/`, expose in `PluginPanel`)
5. Add the benchmarks page that auto-posts gbrain-evals scorecards
6. CF Tunnel UX for the local-agent bridge
7. Premium gating for tunnel + remote-control features
8. Git fork + envs sync endpoint

The gbrain + gstack work and the local-agent bridge are the biggest single-PR items. The plugin system is mechanical. The benchmarks auto-post is small once the eval runner is set up.
