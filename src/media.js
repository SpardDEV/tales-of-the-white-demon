import { DEFAULT_ART_STYLE, PROTAGONIST_APPEARANCE_BASE, USD_TO_BRL_REF } from "./config.js";
import { recordGeminiUsage, recordVertexCreditUsage } from "./gemini.js";
import { callVertexProxy, isSupabaseConfigured } from "./supabase.js";

/**
 * Redimensiona e recorta (center-crop) uma data URL para proporção 9:16 (540x960) em WebP leve.
 */
export function compressDataUrlToWebP9x16(srcDataUrl, targetW = 540, targetH = 960, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Formato de imagem inválido."));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#05070c";
      ctx.fillRect(0, 0, targetW, targetH);

      const srcRatio = img.width / img.height;
      const dstRatio = targetW / targetH;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;

      if (srcRatio > dstRatio) {
        sw = img.height * dstRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / dstRatio;
        sy = (img.height - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

      let dataUrl = canvas.toDataURL("image/webp", quality);
      if (!dataUrl.startsWith("data:image/webp")) {
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(dataUrl);
    };
    img.src = srcDataUrl;
  });
}

/**
 * Redimensiona e recorta (center-crop) File para proporção 9:16 (540x960) em WebP leve (~60-110 KB).
 */
export function compressImageToWebP9x16(file, targetW = 540, targetH = 960, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo de imagem."));
    reader.onload = () => {
      compressDataUrlToWebP9x16(reader.result, targetW, targetH, quality).then(resolve, reject);
    };
    reader.readAsDataURL(file);
  });
}

export function buildChatGptPrompt(entityType, entity, artStyle = DEFAULT_ART_STYLE) {
  const style = (artStyle || DEFAULT_ART_STYLE).trim();

  if (entityType === "player") {
    const desc = entity.appearance || PROTAGONIST_APPEARANCE_BASE;
    const mods = entity.bodyModifications?.length
      ? `Body enhancements: ${entity.bodyModifications.join(", ")}.`
      : "";
    return (
      `Generate an image in vertical 9:16 aspect ratio (mobile wallpaper/portrait).\n` +
      `Style: ${style}.\n` +
      `Subject: ${entity.name} (Rank ${entity.rank}, Lv.${entity.level}) — ${desc}. ${mods}\n` +
      `Mood: fierce dark fantasy cryo-mage engineer, icy cyan aura, sharp shadows, pure black background.`
    );
  }

  if (entityType === "golem") {
    return (
      `Generate an image in vertical 9:16 aspect ratio.\n` +
      `Style: ${style}.\n` +
      `Subject: Cryogenic Mana Golem named "${entity.name}" (Rank ${entity.rank || "?"}). ` +
      `Personality/Vibe: ${entity.personality || "stoic sentinel"}. ` +
      `Appearance: ${entity.appearance || "armored translucent dark-ice construct with glowing cyan mana core runes, jagged frost armor"}.\n` +
      `Background: pure pitch-black with subtle drifting ice embers.`
    );
  }

  if (entityType === "pet") {
    return (
      `Generate an image in vertical 9:16 aspect ratio.\n` +
      `Style: ${style}.\n` +
      `Subject: Frost companion creature "${entity.name || "Ice Beast"}" (${entity.species || "cryo familiar"}, Rank ${entity.rank || "?"}). ` +
      `Personality: ${entity.personality || "fierce yet loyal"}. ` +
      `Appearance: ${entity.appearance || entity.notes || "crystalline ice-furred dark fantasy beast with glowing cyan eyes"}.`
    );
  }

  if (entityType === "keyItem") {
    return (
      `Generate an image in vertical 9:16 aspect ratio.\n` +
      `Style: ${style}.\n` +
      `Subject (Dark Fantasy Artifact / Weapon): "${entity.name}"${entity.rarity ? ` [${entity.rarity}]` : ""}.\n` +
      `Visual details: ${entity.appearance || entity.description || "ornate cryogenic dark-fantasy relic forged with glowing ice runes"}.\n` +
      `Composition: dramatic vertical item showcase floating against a pure pitch-black background with cold cyan mist.`
    );
  }

  const facts = Array.isArray(entity.knownFacts) ? entity.knownFacts.join("; ") : "";
  return (
    `Generate an image in vertical 9:16 aspect ratio.\n` +
    `Style: ${style}.\n` +
    `Subject (${entityType}): ${entity.name}${entity.rank ? ` (Rank ${entity.rank})` : ""}. ` +
    `${entity.role || entity.species || entity.category || ""}\n` +
    `Visual details & personality: ${entity.appearance || ""} ${entity.personality || ""} ${facts}\n` +
    `Composition: dramatic full-waist or full-body vertical character/creature card on pure pitch-black background.`
  );
}

/** Gera arte vertical 9:16 dentro do app via Vertex AI (R$ 1.830,55) ou fallback Gemini Image (AI Studio). */
export async function generateImage9x16({
  prompt,
  settings,
  usage,
  apiKey = "",
  paidApiKey = "",
  isPaid = false,
  onConfirmPaid = null
}) {
  const style = (settings?.artStylePrompt || DEFAULT_ART_STYLE).trim();
  const fullPrompt = String(prompt || "").includes(style.slice(0, 24))
    ? String(prompt || "").trim()
    : `Style: ${style}.\nVertical 9:16 portrait composition.\n${String(prompt || "").trim()}`;

  const useVertex = Boolean(settings?.vertexProxyEnabled && isSupabaseConfigured(settings));
  if (useVertex) {
    const model = settings?.vertexImageModel || "imagen-4.0-fast-generate-001";
    const data = await callVertexProxy(
      settings,
      { action: "image", model, prompt: fullPrompt, aspectRatio: "9:16" },
      usage
    );
    const costUsd = Number(data.costUsd) || 0.02;
    recordVertexCreditUsage(usage, { model: data.model || model, costUsd, usageMetadata: data.usageMetadata });
    const rawUrl = `data:${data.mimeType || "image/jpeg"};base64,${data.imageBase64}`;
    const webpDataUrl = await compressDataUrlToWebP9x16(rawUrl);
    return {
      webpDataUrl,
      costUsd,
      brlCents: costUsd * USD_TO_BRL_REF * 100,
      model: data.model || model,
      sourceLabel: "Vertex AI (Créditos GCP)"
    };
  }

  const aiStudioModel = "gemini-2.5-flash-image";
  const freeKey = (apiKey || settings?.geminiKey || "").trim();
  const paidKey = (paidApiKey || settings?.geminiPaidKey || "").trim();
  if (!freeKey && !paidKey) {
    throw new Error("Ative a ponte Vertex AI (Supabase) ou configure sua Gemini Key em ⚙ Configurações.");
  }

  let usedPaid = Boolean(isPaid && !freeKey);
  let activeKey = usedPaid ? paidKey : (freeKey || paidKey);
  usedPaid = activeKey === paidKey && activeKey !== freeKey;

  const callStudio = async (key) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${aiStudioModel}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: { aspectRatio: "9:16" }
        }
      })
    });

  let res = await callStudio(activeKey);
  if (!res.ok && !usedPaid && paidKey && paidKey !== activeKey && [400, 403, 404, 429].includes(res.status)) {
    const allowed = typeof onConfirmPaid === "function"
      ? await onConfirmPaid({ model: aiStudioModel, roleLabel: "Gerar Imagem 9:16", status: res.status })
      : false;
    if (!allowed) throw new Error(`Cota gratuita de ${aiStudioModel} atingida (${res.status}); Chave Paga não autorizada.`);
    usedPaid = true;
    res = await callStudio(paidKey);
  }
  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`Erro Gemini Image (${res.status}): ${errTxt.slice(0, 220)}`);
  }
  const data = await res.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!imgPart?.data) throw new Error("Gemini Image não retornou imagem (tente ajustar o prompt).");

  const tok = recordGeminiUsage(usage, data.usageMetadata, aiStudioModel, usedPaid);
  const costUsd = ((tok.promptTokens || 0) * 0.3 + (tok.outputTokens || 1290) * 2.5) / 1e6;
  const rawUrl = `data:${imgPart.mimeType || "image/png"};base64,${imgPart.data}`;
  const webpDataUrl = await compressDataUrlToWebP9x16(rawUrl);
  return {
    webpDataUrl,
    costUsd,
    brlCents: costUsd * USD_TO_BRL_REF * 100,
    model: aiStudioModel,
    sourceLabel: usedPaid ? "AI Studio (Chave Paga)" : "AI Studio (Cota Free · US$ 0)"
  };
}
