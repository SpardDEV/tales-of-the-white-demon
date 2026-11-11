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

export function recordGeminiUsage(usage, usageMetadata) {
  const day = todayKey();
  if (usage.dayKey !== day) {
    usage.dayKey = day;
    usage.geminiRequests = 0;
    usage.geminiTokens = 0;
    usage.recentRequestTimestamps = [];
  }
  const now = Date.now();
  usage.geminiRequests += 1;
  usage.recentRequestTimestamps = [
    ...(usage.recentRequestTimestamps || []).filter((ts) => now - ts < 60000),
    now
  ];
  const tokens = usageMetadata?.totalTokenCount || 0;
  usage.geminiTokens += tokens;
  return {
    promptTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    totalTokens: tokens
  };
}

export async function callGemini({ apiKey, model, systemPrompt, userMessage, contextPayload, usage }) {
  if (!apiKey) {
    throw new Error("Configure sua Gemini API Key em ⚙️ Configurações antes de jogar.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payloadText = contextPayload
    ? `ESTADO ATUAL DO JOGO (JSON):\n${JSON.stringify(contextPayload)}\n\nENTRADA DO JOGADOR:\n${userMessage}`
    : userMessage;

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: payloadText }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.82
    }
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error("Cota do Gemini atingida temporariamente (429). Aguarde alguns segundos ou troque para gemini-2.5-flash-lite nas configurações.");
    }
    throw new Error(`Erro Gemini (${res.status}): ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const tokenInfo = recordGeminiUsage(usage, data.usageMetadata);
  const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) {
    throw new Error("Resposta vazia da API Gemini (verifique bloqueio de segurança ou modelo).");
  }

  const parsed = extractJsonObject(candidateText);
  return { parsed, tokenInfo };
}
