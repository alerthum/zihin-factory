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

const preferredModels = [
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-nano-30b-a3b-reasoning"
];

async function chooseModel(env: NvidiaEnv): Promise<string> {
  const response = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`NVIDIA models HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json() as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map(x => x.id).filter((x): x is string => Boolean(x));

  for (const preferred of preferredModels) {
    if (ids.includes(preferred)) return preferred;
  }

  const fallback = ids.find(id =>
    /(instruct|reasoning)$/i.test(id) &&
    !/(embed|embedding|rerank|guard|vision|image|audio|speech)/i.test(id)
  );

  if (!fallback) {
    throw new Error("NVIDIA API connected but no suitable text-generation model was found.");
  }

  return fallback;
}

export async function runNvidiaText(
  env: NvidiaEnv,
  input: { prompt: string; system?: string; maxTokens?: number }
): Promise<NvidiaResult> {
  const model = await chooseModel(env);

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
      max_tokens: input.maxTokens ?? 600,
      temperature: 0.2,
      stream: false
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NVIDIA completion HTTP ${response.status}: ${text.slice(0, 1200)}`);
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
