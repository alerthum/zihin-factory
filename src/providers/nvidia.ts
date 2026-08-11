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

const PRODUCER_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-70b-instruct"
];

const REVIEWER_MODELS = [
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-nano-30b-a3b-reasoning",
  "qwen/qwen2.5-72b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
  "meta/llama-3.1-70b-instruct"
];

const CODER_MODELS = [
  "qwen/qwen2.5-coder-32b-instruct",
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5"
];

let cachedModels: { ids: string[]; expiresAt: number } | null = null;

async function listModels(env: NvidiaEnv): Promise<string[]> {
  if (cachedModels && Date.now() < cachedModels.expiresAt) return cachedModels.ids;

  const response = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`NVIDIA models HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json() as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map(x => x.id).filter((x): x is string => Boolean(x));
  cachedModels = { ids, expiresAt: Date.now() + 10 * 60 * 1000 };
  return ids;
}

async function chooseModel(
  env: NvidiaEnv,
  purpose: NvidiaPurpose,
  avoidModels: string[] = []
): Promise<string> {
  const ids = await listModels(env);
  const avoid = new Set(avoidModels);
  const preferred = purpose === "reviewer"
    ? REVIEWER_MODELS
    : purpose === "coder"
      ? CODER_MODELS
      : PRODUCER_MODELS;

  for (const model of preferred) {
    if (ids.includes(model) && !avoid.has(model)) return model;
  }

  const fallback = ids.find(id =>
    !avoid.has(id) &&
    /(instruct|reasoning)$/i.test(id) &&
    !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id)
  );

  if (fallback) return fallback;

  const unavoidable = ids.find(id =>
    /(instruct|reasoning)$/i.test(id) &&
    !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id)
  );

  if (!unavoidable) {
    throw new Error("NVIDIA API connected but no suitable text-generation model was found.");
  }

  return unavoidable;
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
  const model = await chooseModel(
    env,
    input.purpose ?? "producer",
    input.avoidModels ?? []
  );

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (input.system?.trim()) messages.push({ role: "system", content: input.system.trim() });
  messages.push({ role: "user", content: input.prompt });

  const response = await fetch(`${API_BASE}/chat/completions`, {
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
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NVIDIA completion HTTP ${response.status}: ${text.slice(0, 1600)}`);
  }

  const json = JSON.parse(text) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("NVIDIA completion returned no text content.");

  return { model, content, rawId: json.id, usage: json.usage };
}
