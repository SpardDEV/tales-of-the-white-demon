// Motor de TTS sob demanda (Google Cloud TTS com SSML pitch + Fallback Web Speech grátis).
// Mede exatamente quantos caracteres (incluindo SSML) e centavos cada mensagem consome.
import { TTS_TIERS, USD_TO_BRL_REF } from "./config.js";
import { todayKey } from "./state.js";

const MODE_VOICE = {
  pray: { pitch: "+2st", rate: "0.95", label: "Deusa" },
  mana: { pitch: "+3st", rate: "1.04", label: "Mana" },
  system: { pitch: "-1st", rate: "1.08", label: "Sistema" },
  world: { pitch: "-2st", rate: "0.94", label: "Voz do Mundo" },
  narrative: { pitch: "-1st", rate: "0.98", label: "Crônica" }
};

function escXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSsml(text, mode = "narrative", customPitch = null) {
  const v = MODE_VOICE[mode] || MODE_VOICE.narrative;
  const pitch = customPitch || v.pitch;
  return `<speak><prosody pitch="${pitch}" rate="${v.rate}">${escXml(text)}</prosody></speak>`;
}

export function estimateTtsCost(text, tierKey = "pt-BR-Neural2-B", mode = "narrative", useSsml = true) {
  const tier = TTS_TIERS[tierKey] || TTS_TIERS["pt-BR-Neural2-B"];
  const ssml = useSsml ? buildSsml(text, mode) : String(text || "");
  const chars = ssml.length;
  const usd = chars * tier.usdPerChar;
  const brlCents = usd * USD_TO_BRL_REF * 100;
  return { chars, usd, brlCents, ssml, tier };
}

export function formatTtsCost(usd, brlCents, chars) {
  return `${chars} chars · US$ ${usd.toFixed(5)} (~${brlCents.toFixed(2)} centavos)`;
}

function getTierFamily(tierKey) {
  if (String(tierKey || "").startsWith("pt-BR-Neural2")) return "neural2";
  if (String(tierKey || "").startsWith("pt-BR-Wavenet")) return "wavenet";
  return null;
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
  onSwitchVoice = null
}) {
  stopTts();
  let tierKey = settings.ttsVoice || "pt-BR-Neural2-B";

  if (tierKey !== "browser") {
    ensureTtsMonth(usage);
    let est = estimateTtsCost(text, tierKey, mode, true);
    const fam = getTierFamily(tierKey);

    if (
      fam === "neural2" &&
      (usage.ttsMonthByTier.neural2 + est.chars) > est.tier.freeMonthlyChars &&
      !usage.ttsNeural2Prompted
    ) {
      const switchToWavenet =
        typeof window !== "undefined" &&
        window.confirm(
          "⚠ TTS Neural2 atingiu a franquia gratuita de 1.000.000 caracteres neste mês!\n\n" +
          "Clique OK para trocar agora para WaveNet (mais 4.000.000 chars grátis/mês).\n" +
          "Clique Cancelar para decidir depois ou liberar Neural2 pago."
        );
      if (switchToWavenet) {
        tierKey = "pt-BR-Wavenet-B";
        usage.ttsNeural2Prompted = true;
        est = estimateTtsCost(text, tierKey, mode, true);
        if (onSwitchVoice) await onSwitchVoice(tierKey);
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

    const famAfter = getTierFamily(tierKey);
    if (
      famAfter === "wavenet" &&
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
        tierKey = "browser";
        if (onSwitchVoice) await onSwitchVoice("browser");
      }
    }
  }

  if (tierKey === "browser") {
    if (!("speechSynthesis" in window)) throw new Error("Este navegador não suporta síntese de voz local.");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.pitch = mode === "mana" ? 1.15 : mode === "world" ? 0.85 : 1.0;
    window.speechSynthesis.speak(u);
    return { chars: text.length, usd: 0, brlCents: 0, freeBrowser: true, withinFreeTier: true, tierKey };
  }

  const key = (settings.ttsKey || settings.geminiPaidKey || "").trim();
  if (!key) {
    throw new Error("Configure a Google Cloud TTS Key (ou mude a voz para Grátis do Navegador em ⚙ Configurações).");
  }

  const est = estimateTtsCost(text, tierKey, mode, true);
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { ssml: est.ssml },
      voice: { languageCode: "pt-BR", name: tierKey },
      audioConfig: { audioEncoding: "MP3" }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Erro Google TTS (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.audioContent) throw new Error("Google TTS não retornou áudio.");

  const rec = recordTtsUsage(usage, { turnIndex, label, chars: est.chars, usd: est.usd, brlCents: est.brlCents, tierKey });
  activeAudio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
  await activeAudio.play();
  return { ...est, ...rec, tierKey };
}
