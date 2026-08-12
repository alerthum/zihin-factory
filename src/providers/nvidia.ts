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
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_PROVIDER_ATTEMPTS = 2;

const PRODUCER_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-70b-instruct"
];

const REVIEWER_MODELS = [
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "qwen/qwen2.5-72b-instruct",
  "nvidia/nemotron-3-nano-30b-a3b-reasoning",
  "meta/llama-3.1-70b-instruct"
];

const CODER_MODELS = [
  "qwen/qwen2.5-coder-32b-instruct",
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5"
];

let cachedModels: { ids: string[]; expiresAt: number } | null = null;

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

  for (const id of ids) {
    if (
      !avoid.has(id) &&
      !ordered.includes(id) &&
      /(instruct|reasoning)$/i.test(id) &&
      !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id)
    ) {
      ordered.push(id);
    }
  }

  if (ordered.length === 0) {
    for (const id of ids) {
      if (
        !ordered.includes(id) &&
        /(instruct|reasoning)$/i.test(id) &&
        !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id)
      ) {
        ordered.push(id);
      }
    }
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

export async function runNvidiaText(
  env: NvidiaEnv,
  input: {
    prompt: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    purpose?: NvidiaPurpose;
    avoidModels?: string[];
  }
): Promise<NvidiaResult> {
  const ids = await listModels(env);
  const candidates = candidateOrder(ids, input.purpose ?? "producer", input.avoidModels ?? []);

  if (candidates.length === 0) {
    throw new Error("NVIDIA API connected but no suitable text-generation model was found.");
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (input.system?.trim()) messages.push({ role: "system", content: input.system.trim() });
  messages.push({ role: "user", content: input.prompt });

  const failures: string[] = [];
  const maxAttempts = Math.min(MAX_PROVIDER_ATTEMPTS, candidates.length);

  for (let i = 0; i < maxAttempts; i++) {
    const model = candidates[i];
    try {
      const response = await fetchWithTimeout(`${API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: input.maxTokens ?? 1200,
          temperature: input.temperature ?? 0.2,
          stream: false
        })
      }, REQUEST_TIMEOUT_MS);

      const text = await response.text();
      if (!response.ok) {
        failures.push(`${model}:HTTP_${response.status}:${text.slice(0, 500)}`);
        continue;
      }

      const json = JSON.parse(text) as {
        id?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      };

      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        failures.push(`${model}:empty_content`);
        continue;
      }

      return { model, content, rawId: json.id, usage: json.usage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}:${message.slice(0, 500)}`);
    }
  }

  throw new Error(`NVIDIA provider exhausted ${maxAttempts} model attempt(s): ${failures.join(" | ").slice(0, 1800)}`);
}
