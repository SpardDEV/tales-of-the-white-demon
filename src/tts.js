// Motor de TTS nativo via Gemini API (gemini-2.5-flash-preview-tts · Free primeiro → Paga com aviso) + Fallback Web Speech grátis.
// Converte PCM 16-bit 24kHz da Gemini API em WAV reproduzível e mede tokens/centavos reais por mensagem.
import { TTS_TIERS, USD_TO_BRL_REF } from "./config.js";
import { todayKey } from "./state.js";
import { recordGeminiUsage } from "./gemini.js";

export const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

const MODE_VOICE = {
  pray: { gender: "F", pitch: "+2st", rate: "0.95", tone: "solene, acolhedor e místico" },
  prologue_deity: { gender: "F", pitch: "+2st", rate: "0.95", tone: "solene, acolhedor e místico" },
  mana: { gender: "F2", pitch: "+3st", rate: "1.04", tone: "leve, vibrante e etéreo" },
  system: { gender: "F", pitch: "-1st", rate: "1.08", tone: "preciso, objetivo e firme" },
  world: { gender: "M2", pitch: "-2st", rate: "0.93", tone: "profundo, antigo e grave" },
  prologue_world: { gender: "M2", pitch: "-2st", rate: "0.93", tone: "profundo, antigo e grave" },
  narrative: { gender: "M", pitch: "-1st", rate: "0.98", tone: "imersivo de dark fantasy" }
};

const GEMINI_VOICES = {
  M: "Charon",
  M2: "Fenrir",
  F: "Kore",
  F2: "Aoede"
};

export function normalizeTtsFamily(tierKey) {
  return String(tierKey || "gemini-tts") === "browser" ? "browser" : "gemini-tts";
}

export function resolveVoiceSpec(tierKey = "gemini-tts", mode = "narrative", aiVoice = null) {
  const family = normalizeTtsFamily(tierKey);
  const def = MODE_VOICE[mode] || MODE_VOICE.narrative;
  const gRaw = String(aiVoice?.gender || "").toUpperCase();
  const gender = ["M", "M2", "F", "F2"].includes(gRaw) ? gRaw : def.gender;
  const voiceName = family === "browser" ? "browser" : (GEMINI_VOICES[gender] || GEMINI_VOICES.M);
  const toneBits = [def.tone];
  if (aiVoice?.pitch) toneBits.push(`altura ${aiVoice.pitch}`);
  if (aiVoice?.rate) toneBits.push(`ritmo ${aiVoice.rate}`);
  return { family, gender, voiceName, tone: toneBits.join(", "), pitch: def.pitch, rate: def.rate };
}

export function estimateTtsCost(text, tierKey = "gemini-tts", mode = "narrative", _useSsml = true, aiVoice = null) {
  const family = normalizeTtsFamily(tierKey);
  const tier = TTS_TIERS[family] || TTS_TIERS["gemini-tts"];
  const spec = resolveVoiceSpec(family, mode, aiVoice);
  const chars = String(text || "").length;
  const usd = chars * (tier.usdPerChar || 0);
  const brlCents = usd * USD_TO_BRL_REF * 100;
  return { chars, usd, brlCents, tier, voiceName: spec.voiceName, gender: spec.gender };
}

export function formatTtsCost(usd, brlCents, chars) {
  return `${chars} chars · US$ ${usd.toFixed(5)} (~${brlCents.toFixed(2)} centavos)`;
}

function ensureTtsMonth(usage) {
  const month = todayKey().slice(0, 7);
  if (usage.ttsMonthKey !== month) {
    usage.ttsMonthKey = month;
    usage.ttsMonthChars = 0;
    usage.ttsMonthUsd = 0;
    usage.ttsMonthBillableUsd = 0;
    usage.ttsHistory = [];
  }
  return month;
}

function recordTtsUsage(usage, { turnIndex, label, chars, usd, brlCents, voiceName, usedPaid }) {
  ensureTtsMonth(usage);
  const actualUsd = usedPaid ? usd : 0;
  usage.ttsMonthChars = (usage.ttsMonthChars || 0) + chars;
  usage.ttsMonthUsd = (usage.ttsMonthUsd || 0) + usd;
  usage.ttsMonthBillableUsd = (usage.ttsMonthBillableUsd || 0) + actualUsd;
  usage.ttsHistory = [
    ...(usage.ttsHistory || []),
    {
      turn: turnIndex ?? null,
      label: label || "Fala",
      chars,
      usd,
      brlCents,
      actualUsd,
      withinFreeTier: !usedPaid,
      tier: voiceName,
      at: new Date().toISOString()
    }
  ].slice(-40);
  return { withinFreeTier: !usedPaid, actualUsd };
}

export function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(/[❄◈❖⚔✦☰※▲►•]/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSpeechChunks(rawText, firstMax = 190, nextMax = 360) {
  const clean = cleanTextForSpeech(rawText);
  if (!clean) return [];
  if (clean.length <= firstMax + 40) return [clean];

  // Quebra primeiro por frases; se uma frase passar do limite, quebra em vírgulas/espaços
  const rawParts = clean.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
  const pieces = [];
  for (const part of rawParts) {
    if (part.length <= nextMax) {
      pieces.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > nextMax) {
      let cut = rest.lastIndexOf(",", nextMax);
      if (cut < 80) cut = rest.lastIndexOf(" ", nextMax);
      if (cut < 40) cut = nextMax;
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
  }

  const chunks = [];
  let buf = "";
  for (const p of pieces) {
    const limit = chunks.length === 0 ? firstMax : nextMax;
    if (!buf) {
      buf = p;
    } else if (buf.length + 1 + p.length <= limit) {
      buf += ` ${p}`;
    } else {
      chunks.push(buf);
      buf = p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function pcmBase64ToWavUrl(base64, mimeType = "") {
  const bin = atob(base64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) pcm[i] = bin.charCodeAt(i);
  const rateMatch = /rate=(\d+)/i.exec(mimeType || "");
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;

  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  new Uint8Array(buffer, 44).set(pcm);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

let activeAudio = null;
let playbackSessionId = 0;
const activeControllers = new Set();
const ttsWavCache = new Map();
const TTS_CACHE_MAX = 40;

function rememberWavCache(key, entry) {
  if (ttsWavCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsWavCache.keys().next().value;
    const old = ttsWavCache.get(oldestKey);
    if (old?.wavUrl) URL.revokeObjectURL(old.wavUrl);
    ttsWavCache.delete(oldestKey);
  }
  ttsWavCache.set(key, entry);
}

export function stopTts() {
  playbackSessionId += 1;
  for (const ctrl of activeControllers) ctrl.abort();
  activeControllers.clear();
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
    activeAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export async function speakMessage({
  text,
  mode = "narrative",
  settings,
  usage,
  apiKey = "",
  paidApiKey = "",
  isPaid = false,
  onConfirmPaid = null,
  turnIndex = null,
  label = "",
  voiceSpec = null
}) {
  stopTts();
  const sessionId = playbackSessionId;
  const family = normalizeTtsFamily(settings?.ttsVoice || "gemini-tts");

  if (family === "browser") {
    if (!("speechSynthesis" in window)) throw new Error("Este navegador não suporta síntese de voz local.");
    const spec = resolveVoiceSpec("browser", mode, voiceSpec);
    const u = new SpeechSynthesisUtterance(cleanTextForSpeech(text) || text);
    u.lang = "pt-BR";
    u.pitch = spec.gender.startsWith("F") ? 1.15 : spec.gender === "M2" ? 0.85 : 1.0;
    u.rate = parseFloat(spec.rate) || 1.0;
    window.speechSynthesis.speak(u);
    return { chars: String(text || "").length, usd: 0, brlCents: 0, freeBrowser: true, withinFreeTier: true, tierKey: "browser" };
  }

  const freeKey = (apiKey || settings?.geminiKey || "").trim();
  const paidKey = (paidApiKey || settings?.geminiPaidKey || "").trim();
  if (!freeKey && !paidKey) {
    throw new Error("Configure sua Gemini API Key em ⚙ Configurações (ou mude para Navegador Local).");
  }

  const spec = resolveVoiceSpec(family, mode, voiceSpec);
  const chunks = splitSpeechChunks(text);
  if (!chunks.length) throw new Error("Nada para narrar.");

  let usedPaid = Boolean(isPaid && !freeKey);
  let activeKey = usedPaid ? paidKey : (freeKey || paidKey);
  usedPaid = activeKey === paidKey && activeKey !== freeKey;

  const sendTtsChunk = async (chunkText, allowConfirm) => {
    const cacheKey = `${GEMINI_TTS_MODEL}|${spec.voiceName}|${spec.tone}|${chunkText}`;
    if (ttsWavCache.has(cacheKey)) {
      const cached = ttsWavCache.get(cacheKey);
      return { ...cached, fromCache: true };
    }

    const promptText = `Leia em pt-BR, tom ${spec.tone}, sem adicionar palavras:\n${chunkText}`;
    const callWithKey = async (key) => {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TTS_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctrl) activeControllers.add(ctrl);
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 35000) : null;
      try {
        return await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: spec.voiceName }
                }
              }
            }
          }),
          ...(ctrl ? { signal: ctrl.signal } : {})
        });
      } catch (err) {
        if (err?.name === "AbortError") throw new Error("Tempo limite (35s) no Gemini TTS. Tente novamente.");
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (ctrl) activeControllers.delete(ctrl);
      }
    };

    let res = await callWithKey(activeKey);
    if (!res.ok && allowConfirm && !usedPaid && paidKey && paidKey !== activeKey && [400, 403, 404, 429].includes(res.status)) {
      const allowed = typeof onConfirmPaid === "function"
        ? await onConfirmPaid({ model: GEMINI_TTS_MODEL, roleLabel: "TTS Gemini", status: res.status })
        : false;
      if (!allowed) {
        throw new Error(`Cota gratuita de TTS Gemini atingida (${res.status}); Chave Paga não autorizada.`);
      }
      usedPaid = true;
      activeKey = paidKey;
      res = await callWithKey(paidKey);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Erro Gemini TTS (${res.status}): ${errText.slice(0, 220)}`);
    }

    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new Error("Gemini TTS não retornou áudio.");

    const tok = recordGeminiUsage(usage, data.usageMetadata, GEMINI_TTS_MODEL, usedPaid);
    const realUsd = tok.totalTokens
      ? (tok.promptTokens * 0.5 + tok.outputTokens * 10.0) / 1e6
      : estimateTtsCost(chunkText, family, mode, false, voiceSpec).usd;
    const wavUrl = pcmBase64ToWavUrl(inline.data, inline.mimeType);
    const result = { wavUrl, usd: realUsd, brlCents: realUsd * USD_TO_BRL_REF * 100, fromCache: false };
    rememberWavCache(cacheKey, result);
    return result;
  };

  // Gera e toca o 1º trecho imediatamente (baixa latência); demais trechos são pré-buscados em fila durante a reprodução.
  const first = await sendTtsChunk(chunks[0], true);
  if (sessionId !== playbackSessionId) {
    return { chars: String(text || "").length, usd: 0, brlCents: 0, voiceName: spec.voiceName, withinFreeTier: !usedPaid, cancelled: true };
  }

  const chars = String(text || "").length;
  const firstUsd = first.fromCache ? 0 : first.usd;
  const firstBrl = firstUsd * USD_TO_BRL_REF * 100;
  const rec = recordTtsUsage(usage, {
    turnIndex,
    label,
    chars,
    usd: firstUsd,
    brlCents: firstBrl,
    voiceName: `${spec.voiceName} (${spec.gender})`,
    usedPaid
  });

  // Reaproveita o mesmo elemento <audio> para manter permissão de autoplay contínua no mobile
  activeAudio = new Audio(first.wavUrl);

  if (chunks.length > 1) {
    let nextPromise = sendTtsChunk(chunks[1], false).catch(() => null);
    let idx = 1;
    const historyItem = usage.ttsHistory?.[usage.ttsHistory.length - 1] || null;

    activeAudio.onended = async () => {
      if (sessionId !== playbackSessionId || !activeAudio) return;
      const next = await nextPromise;
      if (sessionId !== playbackSessionId || !activeAudio || !next?.wavUrl) return;
      if (!next.fromCache) {
        const extraUsd = next.usd || 0;
        const extraBrl = extraUsd * USD_TO_BRL_REF * 100;
        usage.ttsMonthUsd = (usage.ttsMonthUsd || 0) + extraUsd;
        if (usedPaid) usage.ttsMonthBillableUsd = (usage.ttsMonthBillableUsd || 0) + extraUsd;
        if (historyItem) {
          historyItem.usd = (historyItem.usd || 0) + extraUsd;
          historyItem.brlCents = (historyItem.brlCents || 0) + extraBrl;
          if (usedPaid) historyItem.actualUsd = (historyItem.actualUsd || 0) + extraUsd;
        }
      }
      idx += 1;
      nextPromise = idx < chunks.length ? sendTtsChunk(chunks[idx], false).catch(() => null) : Promise.resolve(null);
      activeAudio.src = next.wavUrl;
      activeAudio.play().catch(() => {});
    };
  }

  await activeAudio.play();
  return { chars, usd: firstUsd, brlCents: firstBrl, voiceName: spec.voiceName, ...rec };
}
