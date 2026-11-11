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

export function recordGeminiUsage(usage, usageMetadata, model = "?") {
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
  for (const bucket of [(usage.models ||= {}), usage.monthModels]) {
    const m = (bucket[model] ||= { req: 0, in: 0, out: 0 });
    m.req += 1;
    m.in += promptTokens;
    m.out += outputTokens;
  }
  return { promptTokens, outputTokens, totalTokens: tokens };
}

// Cascata: se o modelo pedido falhar por cota/sobrecarga, cai para fallbackModel.
export async function callGemini({ apiKey, model, fallbackModel = null, systemPrompt, userMessage, contextPayload, usage, temperature = 0.82 }) {
  if (!apiKey) {
    throw new Error("Configure sua Gemini API Key em ⚙️ Configurações antes de jogar.");
  }

  const payloadText = contextPayload
    ? `ESTADO ATUAL DO JOGO (JSON):\n${JSON.stringify(contextPayload)}\n\nENTRADA DO JOGADOR:\n${userMessage}`
    : userMessage;

  // Gemma na API não aceita systemInstruction nem modo JSON: o prompt vai junto no texto.
  const buildBody = (m) => {
    const gemma = m.startsWith("gemma");
    return {
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: systemPrompt }] } }),
      contents: [{ role: "user", parts: [{ text: gemma ? `${systemPrompt}

${payloadText}` : payloadText }] }],
      generationConfig: { ...(gemma ? {} : { responseMimeType: "application/json" }), temperature }
    };
  };

  const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
  let res;
  let usedModel;
  for (usedModel of models) {
    const body = buildBody(usedModel);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok || !(res.status === 429 || res.status >= 500)) break;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error("Cota do Gemini atingida temporariamente (429). Aguarde alguns segundos ou troque para gemini-2.5-flash-lite nas configurações.");
    }
    throw new Error(`Erro Gemini (${res.status}): ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const tokenInfo = recordGeminiUsage(usage, data.usageMetadata, usedModel);
  const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) {
    throw new Error("Resposta vazia da API Gemini (verifique bloqueio de segurança ou modelo).");
  }

  const parsed = extractJsonObject(candidateText);
  return { parsed, tokenInfo, model: usedModel, fellBack: usedModel !== model };
}
