export type ToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ToolCatalog = {
  ok: boolean;
  tools: ToolDescriptor[];
  source: string;
  error?: string;
};

export async function discoverToolsFromUrl(tunnelUrl: string): Promise<ToolCatalog> {
  const base = tunnelUrl.replace(/\/+$/, "");
  const candidates = [`${base}/tools`, `${base}/mcp/tools`, `${base}/jsonrpc/tools`];
  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) continue;
      const data = (await r.json()) as unknown;
      const tools = extractTools(data);
      if (tools !== null) {
        return { ok: true, tools, source: candidate };
      }
    } catch {
      // try next
    }
  }
  return { ok: false, tools: [], source: candidates[0], error: "No /tools endpoint found" };
}

function extractTools(data: unknown): ToolDescriptor[] | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const topTools = obj.tools;
  if (Array.isArray(topTools)) return normalizeTools(topTools);
  const result = obj.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.tools)) return normalizeTools(result.tools);
  const nested = obj.data as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.tools)) return normalizeTools(nested.tools);
  return null;
}

function normalizeTools(raw: unknown[]): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : null;
    if (!name) continue;
    out.push({
      name,
      description: typeof item.description === "string" ? item.description : undefined,
      inputSchema: isPlainObject(item.inputSchema)
        ? (item.inputSchema as Record<string, unknown>)
        : isPlainObject(item.parameters)
          ? (item.parameters as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
