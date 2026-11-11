// Motor de regras: limites por turno aplicados pelo código, não pelo narrador.
// Ajuste os números aqui; o prompt (regra 11) lê os mesmos valores.
export const TURN_RULES = {
  maxXpFactor: 1.5, // xpDelta ≤ xpToNext × fator (no máx. ~1,5 nível por turno)
  maxLevelJump: 1, // setLevel sobe no máx. 1 nível
  maxAttributeDelta: 5, // por atributo, por turno
  maxPoolMaxDelta: 50 // hpMax/manaMax/staminaMax por turno
};

const clampAbs = (v, max) => Math.max(-max, Math.min(max, v));

// Corta os excessos de statePatches no lugar e devolve a lista do que foi cortado.
export function enforceTurnRules(patches, player, rules = TURN_RULES) {
  const cuts = [];
  if (!patches || typeof patches !== "object") return cuts;

  const maxXp = Math.round((player.xpToNext || 100) * rules.maxXpFactor);
  if (typeof patches.xpDelta === "number" && patches.xpDelta > maxXp) {
    cuts.push(`XP ${patches.xpDelta}→${maxXp}`);
    patches.xpDelta = maxXp;
  }
  const maxLevel = player.level + rules.maxLevelJump;
  if (typeof patches.setLevel === "number" && patches.setLevel > maxLevel) {
    cuts.push(`nível ${patches.setLevel}→${maxLevel}`);
    patches.setLevel = maxLevel;
  }
  for (const k of ["hpMaxDelta", "manaMaxDelta", "staminaMaxDelta"]) {
    const v = patches[k];
    if (typeof v === "number" && Math.abs(v) > rules.maxPoolMaxDelta) {
      patches[k] = clampAbs(v, rules.maxPoolMaxDelta);
      cuts.push(`${k} ${v}→${patches[k]}`);
    }
  }
  for (const [k, v] of Object.entries(patches.attributeDeltas || {})) {
    if (typeof v === "number" && Math.abs(v) > rules.maxAttributeDelta) {
      patches.attributeDeltas[k] = clampAbs(v, rules.maxAttributeDelta);
      cuts.push(`${k} ${v}→${patches.attributeDeltas[k]}`);
    }
  }
  return cuts;
}
