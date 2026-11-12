// Motor de TTS sob demanda (Google Cloud TTS com SSML pitch + Fallback Web Speech grátis).
// Mede exatamente quantos caracteres (incluindo SSML) e centavos cada mensagem consome.
import { TTS_TIERS, USD_TO_BRL_REF } from "./config.js";
import { todayKey } from "./state.js";

const MODE_VOICE = {
  pray: { gender: "F", pitch: "+2st", rate: "0.95", label: "Deusa" },
  prologue_deity: { gender: "F", pitch: "+2st", rate: "0.95", label: "Deusa" },
  mana: { gender: "F2", pitch: "+3st", rate: "1.04", label: "Mana" },
  system: { gender: "F", pitch: "-1st", rate: "1.08", label: "Sistema" },
  world: { gender: "M2", pitch: "-2st", rate: "0.93", label: "Voz do Mundo" },
  prologue_world: { gender: "M2", pitch: "-2st", rate: "0.93", label: "Voz do Mundo" },
  narrative: { gender: "M", pitch: "-1st", rate: "0.98", label: "Crônica" }
};

const VOICE_ROSTER = {
  neural2: { M: "pt-BR-Neural2-B", M2: "pt-BR-Neural2-B", F: "pt-BR-Neural2-A", F2: "pt-BR-Neural2-C" },
  wavenet: { M: "pt-BR-Wavenet-B", M2: "pt-BR-Wavenet-E", F: "pt-BR-Wavenet-C", F2: "pt-BR-Wavenet-D" }
};

export function normalizeTtsFamily(tierKey) {
  const raw = String(tierKey || "neural2");
  if (raw === "browser") return "browser";
  if (raw === "wavenet" || raw.startsWith("pt-BR-Wavenet")) return "wavenet";
  return "neural2";
}

function sanitizePitch(p, fallback) {
  if (typeof p === "string" && /^[+-]?\d+(\.\d+)?st$/i.test(p.trim())) {
    const n = parseFloat(p);
    return `${Math.max(-6, Math.min(6, n)) >= 0 && !String(n).startsWith("-") ? "+" : ""}${Math.max(-6, Math.min(6, n))}st`;
  }
  return fallback;
}

function sanitizeRate(r, fallback) {
  const n = parseFloat(r);
  if (Number.isFinite(n)) return String(Math.max(0.75, Math.min(1.35, n)));
  return fallback;
}

export function resolveVoiceSpec(tierKey = "neural2", mode = "narrative", aiVoice = null) {
  const family = normalizeTtsFamily(tierKey);
  const def = MODE_VOICE[mode] || MODE_VOICE.narrative;
  const gRaw = String(aiVoice?.gender || "").toUpperCase();
  const gender = ["M", "M2", "F", "F2"].includes(gRaw) ? gRaw : def.gender;
  const pitch = sanitizePitch(aiVoice?.pitch, def.pitch);
  const rate = sanitizeRate(aiVoice?.rate, def.rate);
  const voiceName = family === "browser" ? "browser" : (VOICE_ROSTER[family]?.[gender] || VOICE_ROSTER.neural2.M);
  return { family, gender, pitch, rate, voiceName };
}

function escXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSsml(text, mode = "narrative", aiVoice = null) {
  const { pitch, rate } = resolveVoiceSpec("neural2", mode, aiVoice);
  return `<speak><prosody pitch="${pitch}" rate="${rate}">${escXml(text)}</prosody></speak>`;
}

export function estimateTtsCost(text, tierKey = "neural2", mode = "narrative", useSsml = true, aiVoice = null) {
  const family = normalizeTtsFamily(tierKey);
  const tier = TTS_TIERS[family] || TTS_TIERS.neural2;
  const spec = resolveVoiceSpec(family, mode, aiVoice);
  const ssml = useSsml ? buildSsml(text, mode, aiVoice) : String(text || "");
  const chars = ssml.length;
  const usd = chars * tier.usdPerChar;
  const brlCents = usd * USD_TO_BRL_REF * 100;
  return { chars, usd, brlCents, ssml, tier, voiceName: spec.voiceName, gender: spec.gender };
}

export function formatTtsCost(usd, brlCents, chars) {
  return `${chars} chars · US$ ${usd.toFixed(5)} (~${brlCents.toFixed(2)} centavos)`;
}

function getTierFamily(tierKey) {
  const fam = normalizeTtsFamily(tierKey);
  return fam === "browser" ? null : fam;
}

function ensureTtsMonth(usage) {
  const month = todayKey().slice(0, 7);
  if (usage.ttsMonthKey !== month) {
    usage.ttsMonthKey = month;
    usage.ttsMonthChars = 0;
    usage.ttsMonthUsd = 0;
    usage.ttsMonthBillableUsd = 0;
    usage.ttsMonthByTier = { neural2: 0, wavenet: 0 };
    usage.ttsNeural2Prompted = false;
    usage.ttsWavenetPrompted = false;
    usage.ttsHistory = [];
  }
  if (!usage.ttsMonthByTier) {
    usage.ttsMonthByTier = { neural2: 0, wavenet: 0 };
  }
  return month;
}

export function getTtsMonthlyByTier(usage) {
  const month = todayKey().slice(0, 7);
  if (!usage || usage.ttsMonthKey !== month) return { neural2: 0, wavenet: 0 };
  return {
    neural2: usage.ttsMonthByTier?.neural2 || 0,
    wavenet: usage.ttsMonthByTier?.wavenet || 0
  };
}

function recordTtsUsage(usage, { turnIndex, label, chars, usd, brlCents, tierKey }) {
  ensureTtsMonth(usage);
  const fam = getTierFamily(tierKey);
  const tier = TTS_TIERS[tierKey] || TTS_TIERS["pt-BR-Neural2-B"];
  const prevChars = fam ? (usage.ttsMonthByTier[fam] || 0) : 0;
  const nextChars = prevChars + chars;
  const freeCap = Number.isFinite(tier.freeMonthlyChars) ? tier.freeMonthlyChars : 0;
  const billableChars = Math.max(0, nextChars - freeCap) - Math.max(0, prevChars - freeCap);
  const actualUsd = billableChars * (tier.usdPerChar || 0);
  const withinFreeTier = billableChars === 0;

  if (fam) usage.ttsMonthByTier[fam] = nextChars;
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
      withinFreeTier,
      tier: tierKey,
      at: new Date().toISOString()
    }
  ].slice(-40);
  return { withinFreeTier, actualUsd };
}

let activeAudio = null;

export function stopTts() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export async function speakMessage({
  text,
  mode = "narrative",
  settings,
  usage,
  turnIndex = null,
  label = "",
  voiceSpec = null,
  onSwitchVoice = null
}) {
  stopTts();
  let family = normalizeTtsFamily(settings.ttsVoice || "neural2");

  if (family !== "browser") {
    ensureTtsMonth(usage);
    let est = estimateTtsCost(text, family, mode, true, voiceSpec);

    if (
      family === "neural2" &&
      (usage.ttsMonthByTier.neural2 + est.chars) > est.tier.freeMonthlyChars &&
      !usage.ttsNeural2Prompted
    ) {
      const switchToWavenet =
        typeof window !== "undefined" &&
        window.confirm(
          "⚠ TTS Neural2 atingiu a franquia gratuita de 1.000.000 caracteres neste mês!\n\n" +
          "Clique OK para trocar agora para WaveNet Automática (mais 4.000.000 chars grátis/mês).\n" +
          "Clique Cancelar para decidir depois ou liberar Neural2 pago."
        );
      if (switchToWavenet) {
        family = "wavenet";
        usage.ttsNeural2Prompted = true;
        est = estimateTtsCost(text, family, mode, true, voiceSpec);
        if (onSwitchVoice) await onSwitchVoice(family);
      } else {
        const allowPaidNeural2 =
          typeof window !== "undefined" &&
          window.confirm(
            "Deseja realmente continuar usando Neural2 PAGO (~US$ 16 por 1M chars) neste mês?\n\n" +
            "Clique Cancelar para interromper a fala sem cobrança."
          );
        if (!allowPaidNeural2) {
          throw new Error("Fala cancelada para evitar cobrança no Neural2 pago.");
        }
        usage.ttsNeural2Prompted = true;
      }
    }

    if (
      family === "wavenet" &&
      (usage.ttsMonthByTier.wavenet + est.chars) > est.tier.freeMonthlyChars &&
      !usage.ttsWavenetPrompted
    ) {
      const allowPaidWavenet =
        typeof window !== "undefined" &&
        window.confirm(
          "⚠ TTS WaveNet atingiu a franquia gratuita de 4.000.000 caracteres neste mês!\n\n" +
          "Clique OK para continuar usando WaveNet PAGO (~US$ 4 por 1M chars).\n" +
          "Clique Cancelar para trocar para Voz Local Grátis (navegador)."
        );
      if (allowPaidWavenet) {
        usage.ttsWavenetPrompted = true;
      } else {
        family = "browser";
        if (onSwitchVoice) await onSwitchVoice("browser");
      }
    }
  }

  if (family === "browser") {
    if (!("speechSynthesis" in window)) throw new Error("Este navegador não suporta síntese de voz local.");
    const spec = resolveVoiceSpec("browser", mode, voiceSpec);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.pitch = spec.gender.startsWith("F") ? 1.15 : spec.gender === "M2" ? 0.85 : 1.0;
    u.rate = parseFloat(spec.rate) || 1.0;
    window.speechSynthesis.speak(u);
    return { chars: text.length, usd: 0, brlCents: 0, freeBrowser: true, withinFreeTier: true, tierKey: "browser" };
  }

  const key = (settings.ttsKey || settings.geminiPaidKey || "").trim();
  if (!key) {
    throw new Error("Configure a Google Cloud TTS Key (ou mude a voz para Navegador Local em ⚙ Configurações).");
  }

  const est = estimateTtsCost(text, family, mode, true, voiceSpec);
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { ssml: est.ssml },
      voice: { languageCode: "pt-BR", name: est.voiceName },
      audioConfig: { audioEncoding: "MP3" }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Erro Google TTS (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.audioContent) throw new Error("Google TTS não retornou áudio.");

  const rec = recordTtsUsage(usage, { turnIndex, label, chars: est.chars, usd: est.usd, brlCents: est.brlCents, tierKey: est.voiceName });
  activeAudio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
  await activeAudio.play();
  return { ...est, ...rec, tierKey: est.voiceName };
}
