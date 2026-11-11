import { DEFAULT_ART_STYLE, PROTAGONIST_APPEARANCE_BASE } from "./config.js";

/**
 * Redimensiona e recorta (center-crop) para proporção 9:16 (540x960) em WebP leve (~60-110 KB).
 */
export function compressImageToWebP9x16(file, targetW = 540, targetH = 960, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo de imagem."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Formato de imagem inválido."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");

        // Preenche fundo preto para manter padrão dark fantasy caso haja transparência
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
      img.src = reader.result;
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
