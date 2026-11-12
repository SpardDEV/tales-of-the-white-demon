// Motor de TTS nativo via Gemini API (gemini-2.5-flash-preview-tts · Free primeiro → Paga com aviso) + Fallback Web Speech grátis.
// Suporta múltiplas vozes por parágrafo (Narrador, Jogador, NPCs, Deusa, Sistema), ritmo ajustável (1.2x narrador / 1.4x fala) e toque individual por trecho.
import { TTS_TIERS, USD_TO_BRL_REF } from "./config.js";
import { todayKey } from "./state.js";
import { recordGeminiUsage, recordVertexCreditUsage } from "./gemini.js";
import { callVertexProxy, isSupabaseConfigured } from "./supabase.js";

export const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

const MODE_VOICE = {
  pray: { role: "deity", speaker: "Deusa", gender: "F2", pitch: "+2st", rate: 1.32, tone: "solene, acolhedor e místico" },
  prologue_deity: { role: "deity", speaker: "Deusa", gender: "F2", pitch: "+2st", rate: 1.32, tone: "solene, acolhedor e místico" },
  mana: { role: "mana", speaker: "Mana", gender: "F2", pitch: "+3st", rate: 1.38, tone: "leve, vibrante e etéreo" },
  system: { role: "system", speaker: "Sistema", gender: "F", pitch: "-1st", rate: 1.25, tone: "preciso, objetivo e firme" },
  world: { role: "narrator", speaker: "Mundo", gender: "M2", pitch: "-2st", rate: 1.20, tone: "profundo, antigo e grave" },
  prologue_world: { role: "narrator", speaker: "Mundo", gender: "M2", pitch: "-2st", rate: 1.20, tone: "profundo, antigo e grave" },
  narrative: { role: "narrator", speaker: "Narrador", gender: "M", pitch: "-1st", rate: 1.20, tone: "imersivo de dark fantasy" }
};

export const GEMINI_VOICES = {
  M: "Charon",
  M2: "Fenrir",
  P: "Puck",
  F: "Kore",
  F2: "Aoede"
};

export function normalizeTtsFamily(tierKey) {
  return String(tierKey || "gemini-tts") === "browser" ? "browser" : "gemini-tts";
}

export function splitParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(/[❄◈❖⚔✦☰※▲►•—]/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSpeechChunks(rawText, firstMax = 260, nextMax = 380) {
  const clean = cleanTextForSpeech(rawText);
  if (!clean) return [];
  if (clean.length <= firstMax + 60) return [clean];

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

function guessNpcGender(npc) {
  const blob = `${npc?.name || ""} ${npc?.appearance || ""} ${npc?.personality || ""} ${npc?.relationship || ""}`.toLowerCase();
  if (/\b(mulher|garota|moça|mercenária|guerreira|sacerdotisa|maga|rainha|deusa|ela|dela)\b/.test(blob)) return "F";
  if (/\b(homem|rapaz|guerreiro|ferreiro|mercador|monstro|rei|ele|dele)\b/.test(blob)) return "M2";
  return "";
}

export function resolveVoiceSpec(tierKey = "gemini-tts", mode = "narrative", aiVoice = null) {
  const family = normalizeTtsFamily(tierKey);
  const def = MODE_VOICE[mode] || MODE_VOICE.narrative;
  const gRaw = String(aiVoice?.gender || "").toUpperCase();
  const role = String(aiVoice?.role || def.role || "narrator").toLowerCase();
  const gender = ["M", "M2", "F", "F2", "P"].includes(gRaw) ? gRaw : (role === "player" ? "P" : def.gender);
  const voiceName = family === "browser" ? "browser" : (GEMINI_VOICES[gender] || GEMINI_VOICES.M);
  const toneBits = [aiVoice?.emotion || def.tone];
  if (aiVoice?.pitch) toneBits.push(`altura ${aiVoice.pitch}`);
  const isDialogue = ["player", "npc", "deity", "mana"].includes(role);
  const parsedRate = Number(aiVoice?.rate);
  const playbackRate = Number.isFinite(parsedRate) && parsedRate >= 0.75 && parsedRate <= 1.8
    ? parsedRate
    : (isDialogue ? 1.40 : (def.rate || 1.20));
  return {
    family,
    role,
    speaker: aiVoice?.speaker || def.speaker || "Narrador",
    gender,
    voiceName,
    tone: toneBits.join(", "),
    pitch: aiVoice?.pitch || def.pitch,
    rate: String(playbackRate),
    playbackRate
  };
}

/** Resolve voz, personagem e velocidade (+20% narrador, +40% falas) para um parágrafo específico. */
export function resolveParagraphVoice({
  tierKey = "gemini-tts",
  mode = "narrative",
  paraText = "",
  aiParaVoice = null,
  turnVoice = null,
  knownNpcs = []
}) {
  if (aiParaVoice && (aiParaVoice.role || aiParaVoice.gender || aiParaVoice.speaker)) {
    return resolveVoiceSpec(tierKey, mode, aiParaVoice);
  }
  if (mode !== "narrative") {
    return resolveVoiceSpec(tierKey, mode, turnVoice);
  }

  const txt = String(paraText || "").trim();
  const lower = txt.toLowerCase();
  const hasDialogue = /(^|\n)\s*—|"[^"]{3,}"|:\s*\n?—/.test(txt);

  if (hasDialogue) {
    // 1. Verifica se algum NPC conhecido aparece no parágrafo
    for (const npc of knownNpcs || []) {
      const nName = String(npc?.name || "").trim();
      if (nName && lower.includes(nName.toLowerCase())) {
        const g = guessNpcGender(npc) || "F";
        return resolveVoiceSpec(tierKey, mode, {
          role: "npc",
          speaker: nName,
          gender: g,
          emotion: "expressivo e ágil"
        });
      }
    }
    // 2. Verifica se é fala/reação do protagonista
    if (/\b(você (responde|diz|murmura|grita|pergunta|fala)|eu (digo|respondo|grito|pergunto|não))\b/.test(lower)) {
      return resolveVoiceSpec(tierKey, mode, {
        role: "player",
        speaker: "Você",
        gender: "P",
        emotion: "direto e intenso"
      });
    }
    // 3. Pistas de gênero genéricas para falas sem nome mapeado
    if (/\b(mercenária|guerreira|mulher|garota|ela|dela|deusa|voz feminina)\b/.test(lower)) {
      return resolveVoiceSpec(tierKey, mode, { role: "npc", speaker: "NPC", gender: "F", emotion: "firme e expressivo" });
    }
    return resolveVoiceSpec(tierKey, mode, { role: "npc", speaker: "Personagem", gender: "M2", emotion: "intenso e direto" });
  }

  // Parágrafo de narração / cena (sempre usa voz de Narrador e ritmo +20%)
  return resolveVoiceSpec(tierKey, mode, {
    role: "narrator",
    speaker: "Narrador",
    gender: "M",
    pitch: turnVoice?.pitch || "-1st",
    emotion: turnVoice?.emotion || undefined
  });
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

function recordTtsUsage(usage, { turnIndex, label, chars, usd, brlCents, voiceName, usedPaid, usedVertex = false }) {
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
      usedVertex,
      tier: voiceName,
      at: new Date().toISOString()
    }
  ].slice(-40);
  return { withinFreeTier: !usedPaid, actualUsd, usedVertex };
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
let activeTarget = null; // { turnIndex, paraIndex } | null
const activeControllers = new Set();
const ttsWavCache = new Map();
const TTS_CACHE_MAX = 60;

function rememberWavCache(key, entry) {
  if (ttsWavCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsWavCache.keys().next().value;
    const old = ttsWavCache.get(oldestKey);
    if (old?.wavUrl) URL.revokeObjectURL(old.wavUrl);
    ttsWavCache.delete(oldestKey);
  }
  ttsWavCache.set(key, entry);
}

function delayAbortable(ms, sessionId) {
  return new Promise((resolve) => {
    if (sessionId !== playbackSessionId) return resolve(false);
    setTimeout(() => resolve(sessionId === playbackSessionId), ms);
  });
}

function applyAudioPlaybackRate(audio, rate) {
  if (!audio) return;
  const safeRate = Math.max(0.75, Math.min(1.8, Number(rate) || 1.2));
  audio.defaultPlaybackRate = safeRate;
  audio.playbackRate = safeRate;
  if ("preservesPitch" in audio) audio.preservesPitch = true;
}

export function getTtsPlaybackState() {
  return activeTarget ? { ...activeTarget, playing: true } : { playing: false, turnIndex: null, paraIndex: null };
}

export function stopTts() {
  playbackSessionId += 1;
  activeTarget = null;
  for (const ctrl of activeControllers) ctrl.abort();
  activeControllers.clear();
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.onloadedmetadata = null;
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
  paraIndex = null,
  label = "",
  voiceSpec = null,
  paraVoices = null,
  knownNpcs = [],
  onParagraphChange = null,
  onFinished = null,
  onError = null
}) {
  stopTts();
  const sessionId = playbackSessionId;
  activeTarget = { turnIndex, paraIndex };
  const family = normalizeTtsFamily(settings?.ttsVoice || "gemini-tts");

  const paragraphs = splitParagraphs(text);
  const selectedIndices = paraIndex != null
    ? (paragraphs[paraIndex] !== undefined ? [paraIndex] : [])
    : paragraphs.map((_, i) => i);

  if (!selectedIndices.length) {
    activeTarget = null;
    throw new Error("Nada para narrar neste trecho.");
  }

  const segments = [];
  for (const pIdx of selectedIndices) {
    const pText = paragraphs[pIdx];
    const aiPV = Array.isArray(paraVoices) ? paraVoices[pIdx] : null;
    const spec = resolveParagraphVoice({
      tierKey: family,
      mode,
      paraText: pText,
      aiParaVoice: aiPV,
      turnVoice: voiceSpec,
      knownNpcs
    });
    const subChunks = splitSpeechChunks(pText, 300, 380);
    for (const c of subChunks) {
      segments.push({ paraIndex: pIdx, text: c, spec });
    }
  }

  if (!segments.length) {
    activeTarget = null;
    throw new Error("Nada para narrar.");
  }

  if (family === "browser") {
    if (!("speechSynthesis" in window)) {
      activeTarget = null;
      throw new Error("Este navegador não suporta síntese de voz local.");
    }
    const playBrowserSeg = (i) => {
      if (sessionId !== playbackSessionId || i >= segments.length) {
        if (sessionId === playbackSessionId) {
          activeTarget = null;
          onParagraphChange?.(null);
          onFinished?.();
        }
        return;
      }
      const seg = segments[i];
      onParagraphChange?.(seg.paraIndex, seg.spec);
      const u = new SpeechSynthesisUtterance(seg.text);
      u.lang = "pt-BR";
      u.pitch = seg.spec.gender.startsWith("F") ? 1.15 : seg.spec.gender === "P" ? 1.05 : seg.spec.gender === "M2" ? 0.88 : 0.96;
      u.rate = Math.min(1.6, seg.spec.playbackRate || 1.2);
      u.onend = () => playBrowserSeg(i + 1);
      u.onerror = () => playBrowserSeg(i + 1);
      window.speechSynthesis.speak(u);
    };
    playBrowserSeg(0);
    return { chars: String(text || "").length, usd: 0, brlCents: 0, freeBrowser: true, withinFreeTier: true, tierKey: "browser" };
  }

  const useVertex = Boolean(settings?.vertexProxyEnabled && isSupabaseConfigured(settings));
  const freeKey = (apiKey || settings?.geminiKey || "").trim();
  const paidKey = (paidApiKey || settings?.geminiPaidKey || "").trim();
  if (!useVertex && !freeKey && !paidKey) {
    activeTarget = null;
    throw new Error("Configure sua Gemini API Key ou ative a ponte Vertex AI em ⚙ Configurações.");
  }

  let usedPaid = !useVertex && Boolean(isPaid && !freeKey);
  let activeKey = usedPaid ? paidKey : (freeKey || paidKey);
  usedPaid = !useVertex && activeKey === paidKey && activeKey !== freeKey;

  const sendTtsSegment = async (seg) => {
    const cacheKey = `${useVertex ? "vertex-tts" : GEMINI_TTS_MODEL}|${seg.spec.voiceName}|${seg.spec.tone}|${seg.text}`;
    if (ttsWavCache.has(cacheKey)) {
      return { ...ttsWavCache.get(cacheKey), fromCache: true };
    }

    const promptText = `Leia em português do Brasil com ritmo natural e ágil, interpretação ${seg.spec.tone}, sem adicionar palavras:\n${seg.text}`;

    if (useVertex) {
      const vData = await callVertexProxy(
        settings,
        {
          action: "tts",
          model: "gemini-2.5-flash-tts",
          promptText,
          voiceName: seg.spec.voiceName
        },
        usage
      );
      const inline = vData?.inlineData;
      if (!inline?.data) throw new Error("Vertex TTS não retornou áudio.");
      const um = vData.usageMetadata || {};
      const pTok = um.promptTokenCount || 0;
      const oTok = (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
      const realUsd = (pTok || oTok)
        ? (pTok * 0.5 + oTok * 10.0) / 1e6
        : estimateTtsCost(seg.text, family, mode, false, seg.spec).usd;
      recordVertexCreditUsage(usage, {
        model: vData.model || "gemini-2.5-flash-tts",
        costUsd: realUsd,
        usageMetadata: um
      });
      const wavUrl = pcmBase64ToWavUrl(inline.data, inline.mimeType);
      const result = { wavUrl, usd: realUsd, brlCents: realUsd * USD_TO_BRL_REF * 100, fromCache: false, usedVertex: true };
      rememberWavCache(cacheKey, result);
      return result;
    }

    const callOnce = async (key) => {
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
                  prebuiltVoiceConfig: { voiceName: seg.spec.voiceName }
                }
              }
            }
          }),
          ...(ctrl ? { signal: ctrl.signal } : {})
        });
      } catch (err) {
        if (err?.name === "AbortError") {
          const abortErr = new Error("Tempo limite (35s) no Gemini TTS. Tente novamente.");
          abortErr.isAbort = sessionId !== playbackSessionId;
          throw abortErr;
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (ctrl) activeControllers.delete(ctrl);
      }
    };

    let res = await callOnce(activeKey);
    // Se bater limite momentâneo de RPM (429/503), aguarda breve pausa e tenta uma vez antes de escalar para Paga ou falhar.
    if ((res.status === 429 || res.status === 503) && sessionId === playbackSessionId) {
      const ok = await delayAbortable(1300, sessionId);
      if (ok) res = await callOnce(activeKey);
    }

    if (!res.ok && !usedPaid && paidKey && paidKey !== activeKey && [400, 403, 404, 429].includes(res.status)) {
      const allowed = typeof onConfirmPaid === "function"
        ? await onConfirmPaid({ model: GEMINI_TTS_MODEL, roleLabel: "TTS Gemini", status: res.status })
        : false;
      if (!allowed) {
        throw new Error(`Cota gratuita de TTS Gemini atingida (${res.status}); Chave Paga não autorizada.`);
      }
      usedPaid = true;
      activeKey = paidKey;
      res = await callOnce(paidKey);
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
      : estimateTtsCost(seg.text, family, mode, false, seg.spec).usd;
    const wavUrl = pcmBase64ToWavUrl(inline.data, inline.mimeType);
    const result = { wavUrl, usd: realUsd, brlCents: realUsd * USD_TO_BRL_REF * 100, fromCache: false };
    rememberWavCache(cacheKey, result);
    return result;
  };

  // Busca e inicia o 1º trecho imediatamente; busca os próximos em paralelo respeitando erro real caso aconteça.
  const first = await sendTtsSegment(segments[0]);
  if (sessionId !== playbackSessionId) {
    return { chars: 0, usd: 0, brlCents: 0, voiceName: segments[0].spec.voiceName, withinFreeTier: !usedPaid, cancelled: true };
  }

  const chars = segments.reduce((acc, s) => acc + s.text.length, 0);
  const firstUsd = first.fromCache ? 0 : first.usd;
  const firstBrl = firstUsd * USD_TO_BRL_REF * 100;
  const voiceSummary = paraIndex != null
    ? `${segments[0].spec.speaker}·${segments[0].spec.voiceName}`
    : `Multi (${segments.length} bl.)`;

  const rec = recordTtsUsage(usage, {
    turnIndex,
    label: paraIndex != null ? `${label || "trecho"}#p${paraIndex + 1}` : label,
    chars,
    usd: firstUsd,
    brlCents: firstBrl,
    voiceName: voiceSummary,
    usedPaid,
    usedVertex: useVertex
  });
  const historyItem = usage.ttsHistory?.[usage.ttsHistory.length - 1] || null;

  activeAudio = new Audio(first.wavUrl);
  applyAudioPlaybackRate(activeAudio, segments[0].spec.playbackRate);
  activeAudio.onloadedmetadata = () => applyAudioPlaybackRate(activeAudio, segments[0].spec.playbackRate);
  onParagraphChange?.(segments[0].paraIndex, segments[0].spec);

  if (segments.length > 1) {
    // Dispara pré-busca do segmento 1 assim que segmento 0 começa; erro NÃO é engolido silenciosamente!
    let nextPromise = sendTtsSegment(segments[1]);
    let idx = 1;

    activeAudio.onended = async () => {
      if (sessionId !== playbackSessionId || !activeAudio) return;
      try {
        const next = await nextPromise;
        if (sessionId !== playbackSessionId || !activeAudio) return;
        const curSeg = segments[idx];
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
        onParagraphChange?.(curSeg.paraIndex, curSeg.spec);
        applyAudioPlaybackRate(activeAudio, curSeg.spec.playbackRate);
        activeAudio.onloadedmetadata = () => applyAudioPlaybackRate(activeAudio, curSeg.spec.playbackRate);
        activeAudio.src = next.wavUrl;

        idx += 1;
        if (idx < segments.length) {
          nextPromise = sendTtsSegment(segments[idx]);
        } else {
          activeAudio.onended = () => {
            if (sessionId === playbackSessionId) {
              activeTarget = null;
              onParagraphChange?.(null);
              onFinished?.();
            }
          };
        }
        await activeAudio.play();
      } catch (err) {
        if (sessionId !== playbackSessionId || err?.isAbort) return;
        stopTts();
        onParagraphChange?.(null);
        onError?.(err);
      }
    };
  } else {
    activeAudio.onended = () => {
      if (sessionId === playbackSessionId) {
        activeTarget = null;
        onParagraphChange?.(null);
        onFinished?.();
      }
    };
  }

  await activeAudio.play();
  return { chars, usd: firstUsd, brlCents: firstBrl, voiceName: voiceSummary, ...rec };
}
