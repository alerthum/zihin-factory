export type NvidiaPurpose = "producer" | "reviewer" | "coder";

export type NvidiaResult = {
  model: string;
  content: string;
  rawId?: string;
  usage?: unknown;
};

type NvidiaEnv = {
  NVIDIA_API_KEY: string;
};

const API_BASE = "https://integrate.api.nvidia.com/v1";
const INITIAL_RESPONSE_TIMEOUT_MS = 25_000;
const STREAM_IDLE_TIMEOUT_MS = 25_000;
const STREAM_TOTAL_TIMEOUT_MS = 75_000;
const HEARTBEAT_INTERVAL_MS = 12_000;
const MAX_PROVIDER_ATTEMPTS = 3;
const REVIEWER_PROVIDER_ATTEMPTS = 2;

// Latency-first order: the public hosted NIM endpoint can return 524 when a
// large model does not begin responding quickly enough. We prefer smaller
// instruction models for control-plane work and retain larger models as
// quality fallbacks when they are present in /v1/models.
const PRODUCER_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "meta/llama-3.1-8b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-70b-instruct"
];

const REVIEWER_MODELS = [
  "meta/llama-3.1-70b-instruct",
  "qwen/qwen2.5-72b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-8b-instruct"
];

const CODER_MODELS = [
  "qwen/qwen2.5-coder-32b-instruct",
  "meta/llama-3.1-8b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "meta/llama-3.3-70b-instruct"
];

let cachedModels: { ids: string[]; expiresAt: number } | null = null;

function isTextModel(id: string): boolean {
  return /(instruct|reasoning)(?:[-_.][a-z0-9.]+)*$/i.test(id) &&
    !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id);
}

function candidateOrder(
  ids: string[],
  purpose: NvidiaPurpose,
  avoidModels: string[]
): string[] {
  const avoid = new Set(avoidModels);
  const preferred = purpose === "reviewer"
    ? REVIEWER_MODELS
    : purpose === "coder"
      ? CODER_MODELS
      : PRODUCER_MODELS;

  const ordered: string[] = [];
  for (const model of preferred) {
    if (ids.includes(model) && !avoid.has(model) && !ordered.includes(model)) ordered.push(model);
  }

  // Prefer smaller model names before arbitrary large fallbacks when the
  // preferred list is not available.
  const dynamic = ids
    .filter(id => !avoid.has(id) && isTextModel(id) && !ordered.includes(id))
    .sort((a, b) => {
      const size = (x: string) => {
        const m = x.match(/(?:^|[-_/])(\d+(?:\.\d+)?)b(?:[-_/]|$)/i);
        return m ? Number(m[1]) : 999;
      };
      return size(a) - size(b);
    });
  ordered.push(...dynamic);

  if (ordered.length === 0) {
    ordered.push(...ids.filter(isTextModel));
  }

  return ordered;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("nvidia_request_timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function listModels(env: NvidiaEnv): Promise<string[]> {
  if (cachedModels && Date.now() < cachedModels.expiresAt) return cachedModels.ids;

  const response = await fetchWithTimeout(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` }
  }, 20_000);

  if (!response.ok) {
    throw new Error(`NVIDIA models HTTP ${response.status}: ${(await response.text()).slice(0, 1200)}`);
  }

  const json = await response.json() as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map(x => x.id).filter((x): x is string => Boolean(x));
  cachedModels = { ids, expiresAt: Date.now() + 10 * 60 * 1000 };
  return ids;
}

function readWithTimeout(reader: any, controller: AbortController, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { controller.abort("nvidia_stream_idle_timeout"); } catch { /* noop */ }
      reject(new Error("nvidia_stream_idle_timeout"));
    }, timeoutMs);

    reader.read().then(
      (value: any) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function streamingCompletion(
  env: NvidiaEnv,
  model: string,
  body: Record<string, unknown>,
  onHeartbeat?: () => Promise<void> | void
): Promise<NvidiaResult> {
  const controller = new AbortController();
  let lastHeartbeatAt = 0;
  const heartbeat = async (force = false) => {
    if (!onHeartbeat) return;
    const now = Date.now();
    if (!force && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatAt = now;
    try { await onHeartbeat(); } catch { /* heartbeat must not fail provider work */ }
  };
  await heartbeat(true);
  const initialTimer = setTimeout(() => controller.abort("nvidia_initial_response_timeout"), INITIAL_RESPONSE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify({ ...body, model, stream: true }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(initialTimer);
  }

  await heartbeat(true);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP_${response.status}:${text.slice(0, 700)}`);
  }

  const stream = (response as any).body;
  if (!stream?.getReader) {
    throw new Error("stream_body_missing");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  let buffer = "";
  let content = "";
  let rawId: string | undefined;
  let usage: unknown;
  let doneSignal = false;

  while (!doneSignal) {
    if (Date.now() - started > STREAM_TOTAL_TIMEOUT_MS) {
      controller.abort("nvidia_stream_total_timeout");
      throw new Error("nvidia_stream_total_timeout");
    }

    const chunk = await readWithTimeout(reader, controller, STREAM_IDLE_TIMEOUT_MS);
    await heartbeat();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        doneSignal = true;
        break;
      }
      try {
        const event = JSON.parse(data) as {
          id?: string;
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          usage?: unknown;
        };
        if (event.id) rawId = event.id;
        if (event.usage) usage = event.usage;
        const delta = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? "";
        if (delta) content += delta;
      } catch {
        // Ignore keepalive / provider-specific SSE metadata lines.
      }
    }
  }

  const finalContent = content.trim();
  if (!finalContent) throw new Error("empty_stream_content");
  return { model, content: finalContent, rawId, usage };
}

export async function runNvidiaText(
  env: NvidiaEnv,
  input: {
    prompt: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    purpose?: NvidiaPurpose;
    avoidModels?: string[];
    onHeartbeat?: () => Promise<void> | void;
  }
): Promise<NvidiaResult> {
  try { await input.onHeartbeat?.(); } catch { /* heartbeat is best effort */ }
  const ids = await listModels(env);
  const candidates = candidateOrder(ids, input.purpose ?? "producer", input.avoidModels ?? []);

  if (candidates.length === 0) {
    throw new Error("NVIDIA API connected but no suitable text-generation model was found.");
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (input.system?.trim()) messages.push({ role: "system", content: input.system.trim() });
  messages.push({ role: "user", content: input.prompt });

  const failures: string[] = [];
  const attemptBudget = (input.purpose ?? "producer") === "reviewer" ? REVIEWER_PROVIDER_ATTEMPTS : MAX_PROVIDER_ATTEMPTS;
  const maxAttempts = Math.min(attemptBudget, candidates.length);

  for (let i = 0; i < maxAttempts; i++) {
    const model = candidates[i];
    try {
      try { await input.onHeartbeat?.(); } catch { /* heartbeat is best effort */ }
      return await streamingCompletion(env, model, {
        messages,
        max_tokens: Math.max(64, Math.min(1200, input.maxTokens ?? 900)),
        temperature: input.temperature ?? 0.2
      }, input.onHeartbeat);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}:${message.slice(0, 700)}`);
      try { await input.onHeartbeat?.(); } catch { /* heartbeat is best effort */ }
    }
  }

  throw new Error(`NVIDIA provider exhausted ${maxAttempts} streaming model attempt(s): ${failures.join(" | ").slice(0, 2600)}`);
}
