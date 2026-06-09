import type { AiConfig } from "@/lib/types";

type QueueState = {
  active: number;
  lastStart: number;
  waiters: Array<() => void>;
  timer?: number;
};

type ProviderCallResult =
  | { ok: true; text: string }
  | { ok: false; status?: number; error: string; retryMs?: number };

const queues = new Map<string, QueueState>();
const VALIDATION_TIMEOUT_MS = 15000;

function limits(provider: string) {
  if (provider === "gemini") return { maxConcurrent: 1, minIntervalMs: 6000, maxRetries: 3 };
  return { maxConcurrent: 2, minIntervalMs: 1500, maxRetries: 3 };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function providerLabel(provider: string) {
  if (provider === "gemini") return "Gemini";
  if (provider === "openai") return "OpenAI";
  return "Custom";
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = VALIDATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function bodySnippet(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 260);
}

function friendlyHttpError(provider: string, model: string, status: number, body: string) {
  const label = providerLabel(provider);
  const detail = bodySnippet(body);
  if (status === 401 || status === 403) {
    return `${label} API 키가 유효하지 않거나 권한이 없습니다. 키, 프로젝트 권한, 결제/사용 설정을 확인하세요.`;
  }
  if (status === 404) {
    return `${label} 모델코드(${model})를 찾지 못했습니다. 제공자에서 실제 사용 가능한 모델코드인지 확인하세요.`;
  }
  if (status === 429) {
    return `${label} 할당량(RPM/TPM/RPD)을 초과했습니다. 잠시 후 다시 시도하거나 더 가벼운 모델을 선택하세요.`;
  }
  if (status >= 500) {
    return `${label} 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.`;
  }
  if (status === 400) {
    return `${label} 요청이 거절되었습니다. 모델코드, API 키 권한, Base URL 설정을 확인하세요.${detail ? ` (${detail})` : ""}`;
  }
  return `${label} HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

function friendlyNetworkError(provider: string, error: unknown) {
  const label = providerLabel(provider);
  if ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError") {
    return `${label} API가 15초 안에 응답하지 않아 검증을 중단했습니다. 네트워크 상태와 제공자 제한을 확인하세요.`;
  }
  if (provider === "openai") {
    return "OpenAI API는 브라우저 직접 호출이 CORS 정책으로 차단될 수 있습니다. 브라우저에서 쓰려면 CORS가 허용된 Custom OpenAI-compatible 프록시를 사용하거나 Gemini를 선택하세요.";
  }
  if (provider === "custom") {
    return "Custom API에 연결하지 못했습니다. Base URL이 브라우저 CORS를 허용하는지, /models 또는 /chat/completions 경로가 열려 있는지 확인하세요.";
  }
  return `${label} API에 연결하지 못했습니다. 네트워크, CORS 차단, API 키 제한 설정을 확인하세요.`;
}

function retryAfterMs(response: Response) {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return undefined;
}

function queueState(key: string) {
  const existing = queues.get(key);
  if (existing) return existing;
  const created: QueueState = { active: 0, lastStart: 0, waiters: [] };
  queues.set(key, created);
  return created;
}

function pumpQueue(state: QueueState, maxConcurrent: number, minIntervalMs: number) {
  if (!state.waiters.length || state.active >= maxConcurrent) return;
  const delay = Math.max(0, state.lastStart + minIntervalMs - Date.now());
  if (delay > 0) {
    if (!state.timer) {
      state.timer = window.setTimeout(() => {
        state.timer = undefined;
        pumpQueue(state, maxConcurrent, minIntervalMs);
      }, delay);
    }
    return;
  }
  const start = state.waiters.shift();
  if (!start) return;
  state.active += 1;
  state.lastStart = Date.now();
  start();
  pumpQueue(state, maxConcurrent, minIntervalMs);
}

async function limited<T>(key: string, maxConcurrent: number, minIntervalMs: number, task: () => Promise<T>) {
  const state = queueState(key);
  await new Promise<void>((resolve) => {
    state.waiters.push(resolve);
    pumpQueue(state, maxConcurrent, minIntervalMs);
  });
  try {
    return await task();
  } finally {
    state.active = Math.max(0, state.active - 1);
    pumpQueue(state, maxConcurrent, minIntervalMs);
  }
}

export async function validateClientAiKey(config: AiConfig) {
  if (!config.apiKey || !config.model) {
    return { ok: false, message: "API 키와 모델코드가 필요합니다." };
  }
  if (config.provider === "custom" && !config.baseUrl) {
    return { ok: false, message: "Custom 제공자는 Base URL이 필요합니다." };
  }

  try {
    const response = await validateProvider(config);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, message: friendlyHttpError(config.provider, config.model, response.status, body) };
    }
    return {
      ok: true,
      message: "AI 연결을 확인했습니다. API 키는 브라우저 메모리에만 보관합니다.",
    };
  } catch (error) {
    return { ok: false, message: friendlyNetworkError(config.provider, error) };
  }
}

function validateProvider(config: AiConfig) {
  if (config.provider === "gemini") {
    return fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey || "" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
  }

  const baseUrl = config.provider === "custom" ? (config.baseUrl || "").replace(/\/$/, "") : "https://api.openai.com/v1";
  return fetchWithTimeout(`${baseUrl}/models/${encodeURIComponent(config.model)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey || ""}` },
  });
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function makeBatches<T>(items: T[], render: (item: T) => string, maxItems = 20, maxEstimatedTokens = 6000) {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokenCount = 0;
  for (const item of items) {
    const size = estimateTokens(render(item));
    if (current.length && (current.length >= maxItems || tokenCount + size > maxEstimatedTokens)) {
      batches.push(current);
      current = [];
      tokenCount = 0;
    }
    current.push(item);
    tokenCount += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function generateAiText(config: AiConfig, prompt: string) {
  const limit = limits(config.provider);
  return limited(`${config.provider}:${config.model}`, limit.maxConcurrent, limit.minIntervalMs, async () => {
    let lastError = "";
    for (let attempt = 0; attempt <= limit.maxRetries; attempt += 1) {
      const response = await callProvider(config, prompt);
      if (response.ok) return response.text;
      lastError = response.error;
      if (response.status === 429 && attempt < limit.maxRetries) {
        await sleep(response.retryMs || [10_000, 20_000, 40_000][attempt] || 40_000);
        continue;
      }
      break;
    }
    throw new Error(lastError || "AI 호출에 실패했습니다.");
  });
}

async function callProvider(config: AiConfig, prompt: string): Promise<ProviderCallResult> {
  if (config.provider === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey || "" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, retryMs: retryAfterMs(response), error: `Gemini HTTP ${response.status}: ${await response.text()}` };
    }
    const json = await response.json();
    return {
      ok: true,
      text: (json.candidates || [])
        .flatMap((candidate: { content?: { parts?: Array<{ text?: string }> } }) => candidate.content?.parts || [])
        .map((part: { text?: string }) => part.text || "")
        .join("\n"),
    };
  }

  const baseUrl = config.provider === "custom" ? (config.baseUrl || "").replace(/\/$/, "") : "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey || ""}` },
    body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) {
    return { ok: false, status: response.status, retryMs: retryAfterMs(response), error: `${config.provider} HTTP ${response.status}: ${await response.text()}` };
  }
  const json = await response.json();
  return { ok: true, text: json.choices?.[0]?.message?.content || "" };
}
