import { todayKey } from "./state.js";

function extractJsonObject(rawText) {
  const cleaned = rawText.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("A IA não retornou um JSON válido.");
  }
}

export function recordGeminiUsage(usage, usageMetadata, model = "?", isPaid = false) {
  const day = todayKey();
  if (usage.dayKey !== day) {
    usage.dayKey = day;
    usage.geminiRequests = 0;
    usage.geminiTokens = 0;
    usage.recentRequestTimestamps = [];
    usage.models = {};
  }
  const month = day.slice(0, 7);
  if (usage.monthKey !== month) {
    usage.monthKey = month;
    usage.monthModels = {};
    usage.paidMonthModels = {};
  }
  const now = Date.now();
  usage.geminiRequests += 1;
  usage.recentRequestTimestamps = [
    ...(usage.recentRequestTimestamps || []).filter((ts) => now - ts < 60000),
    now
  ];
  const tokens = usageMetadata?.totalTokenCount || 0;
  usage.geminiTokens += tokens;
  const promptTokens = usageMetadata?.promptTokenCount || 0;
  // thinking tokens são cobrados como saída
  const outputTokens = (usageMetadata?.candidatesTokenCount || 0) + (usageMetadata?.thoughtsTokenCount || 0);
  const buckets = [(usage.models ||= {}), (usage.monthModels ||= {})];
  if (isPaid) buckets.push((usage.paidMonthModels ||= {}));
  for (const bucket of buckets) {
    const m = (bucket[model] ||= { req: 0, in: 0, out: 0 });
    m.req += 1;
    m.in += promptTokens;
    m.out += outputTokens;
  }
  return { promptTokens, outputTokens, totalTokens: tokens };
}

function buildThinkingConfig(m, fastMode) {
  if (!fastMode || !m || m.startsWith("gemma")) return null;
  if (/^gemini-2\.5-(flash|lite)/i.test(m)) return { thinkingBudget: 0 };
  if (/^gemini-3.*flash/i.test(m)) return { thinkingLevel: "minimal" };
  if (/^gemini-3/i.test(m)) return { thinkingLevel: "low" };
  return null;
}

// Sempre tenta a Chave Free primeiro neste modelo específico.
// Se ESTE modelo bater cota/exigir billing (429/403), acusa aviso antes de mover SÓ este modelo para a Paga.
export async function callGemini({
  apiKey,
  paidApiKey = null,
  model,
  isPaid = false,
  roleLabel = "IA",
  onConfirmPaid = null,
  systemPrompt,
  userMessage,
  contextPayload,
  usage,
  temperature = 0.82,
  fastMode = false,
  timeoutMs = 35000
}) {
  if (!apiKey && !paidApiKey) {
    throw new Error("Configure sua Gemini API Key em ⚙️ Configurações antes de jogar.");
  }

  const payloadText = contextPayload
    ? `ESTADO ATUAL DO JOGO (JSON):\n${JSON.stringify(contextPayload)}\n\nENTRADA DO JOGADOR:\n${userMessage}`
    : userMessage;

  // Gemma na API não aceita systemInstruction nem modo JSON: o prompt vai junto no texto.
  const buildBody = (m, allowThinking = true) => {
    const gemma = m.startsWith("gemma");
    const thinkingCfg = allowThinking ? buildThinkingConfig(m, fastMode) : null;
    return {
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: systemPrompt }] } }),
      contents: [{ role: "user", parts: [{ text: gemma ? `${systemPrompt}

${payloadText}` : payloadText }] }],
      generationConfig: {
        ...(gemma ? {} : { responseMimeType: "application/json" }),
        ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
        temperature
      }
    };
  };

  const sendRaw = async (key, allowThinking) => {
    const body = buildBody(model, allowThinking);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) excedido ao chamar ${model}. Tente enviar novamente.`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const send = async (key) => {
    const useThinking = Boolean(buildThinkingConfig(model, fastMode));
    let res = await sendRaw(key, useThinking);
    if (!res.ok && res.status === 400 && useThinking) {
      // Caso alguma variante/preview rejeite thinkingConfig/minimal, repete sem ele sem perder a chamada.
      res = await sendRaw(key, false);
    }
    return res;
  };

  let usedPaid = Boolean(isPaid && !apiKey);
  let activeKey = apiKey || paidApiKey;
  let res = await send(activeKey);

  if (!res.ok && !usedPaid && paidApiKey && paidApiKey !== apiKey && [400, 403, 404, 429].includes(res.status)) {
    const allowed = typeof onConfirmPaid === "function"
      ? await onConfirmPaid({ model, roleLabel, status: res.status })
      : false;
    if (!allowed) {
      throw new Error(`Cota gratuita de ${model} (${roleLabel}) atingida (${res.status}); Chave Paga não autorizada.`);
    }
    usedPaid = true;
    res = await send(paidApiKey);
  }

  if (!res?.ok) {
    const errText = await res?.text().catch(() => "") || "";
    if (res?.status === 429) {
      throw new Error(`Cota de ${model} (${roleLabel}) atingida (429). Cole uma Chave Paga ou aguarde o reset diário.`);
    }
    throw new Error(`Erro Gemini em ${model} (${res?.status || "?"}): ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const tokenInfo = recordGeminiUsage(usage, data.usageMetadata, model, usedPaid);
  const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) {
    throw new Error("Resposta vazia da API Gemini (verifique bloqueio de segurança ou modelo).");
  }

  const parsed = extractJsonObject(candidateText);
  return { parsed, tokenInfo, model, usedPaid, fellBack: false };
}

// Lista os modelos disponíveis diretamente na conta/chave do usuário.
export async function listGeminiModels(apiKey) {
  if (!apiKey) throw new Error("Cole ao menos uma Gemini API Key para consultar os modelos.");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Falha ao listar modelos (${res.status}): ${errText.slice(0, 180)}`);
  }
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({
      id: (m.name || "").replace(/^models\//, ""),
      displayName: m.displayName || (m.name || "").replace(/^models\//, "")
    }))
    .filter((m) => /^(gemini|gemma)/i.test(m.id) && !/embedding|tts|image|live|robotics/i.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id));
}
