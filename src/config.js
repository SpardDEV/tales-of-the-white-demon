export const BASE_RANKS = [
  "F", "E", "D", "C", "B", "A",
  "S", "SS", "SSS", "SSS+",
  "EX", "EX+"
];

export const DEFAULT_ART_STYLE =
  "Dark fantasy stylized comic-ink illustration, bold expressive black ink lineart, dramatic crosshatching and cel-shaded shadows, high-contrast rim lighting against a pitch-black background, vivid glowing mana accents, vertical 9:16 mobile portrait";

export const PROTAGONIST_APPEARANCE_BASE =
  "Lean athletic dark-fantasy warrior reminiscent of Grimmjow Jaegerjaquez: wild spiky ice-blue hair, sharp fierce cyan eyes with subtle teal markings under the eyes, jagged pale frost-bone crest along the right jawline, confident predator smirk, tattered white-and-black high-collar haori coat, swirling pale-cyan cryogenic mana shards";

// Marcos orgânicos de referência (não são travas rígidas: servem de guia lógico para o Árbitro de IA)
export const PROGRESSION_MILESTONES = [
  { approxLevel: 1, tag: "cryo_seed", desc: "Engenheiro recém-reencarnado: criocinese básica, sobrevivência pé no chão, estudo físico do novo mundo." },
  { approxLevel: 37, tag: "rough_bio_cryo", desc: "Manipulação grosseira de mana tentando imitar sistemas musculares e órgãos; estudo de morfologia de monstros para tentar replicar com gelo." },
  { approxLevel: 48, tag: "mana_awakening", desc: "Consciência da Mana nasce por ação e reação: clona a forma de agir e reagir do protagonista, mas com personalidade própria." },
  { approxLevel: 70, tag: "golem_1", desc: "Capacidade de forjar o 1º Golem de Gelo autossustentável (gera sua própria mana; construção demorada; nome e personalidade escolhidos pelo jogador; teto de 7 Golens Mestres)." },
  { approxLevel: 100, tag: "body_nanocryo", desc: "Alterações corporais reais com nanogerenciamento de gelo em fibras musculares, tendões e nervos." },
  { approxLevel: 120, tag: "golem_2", desc: "Forja do 2º Golem autossustentável." },
  { approxLevel: 330, tag: "time_freeze_proto", desc: "Primeiras tentativas reais de congelar o tempo (custo absurdo de mana e desgaste severo no corpo)." },
  { approxLevel: 370, tag: "golem_7", desc: "Conclusão prevista dos 7 Golens de Gelo autossustentáveis." },
  { approxLevel: 400, tag: "spatial_magic", desc: "Desbloqueio orgânico da 2ª habilidade: Magia Espacial (inicialmente criando um Mundo de Bolso para estocar quantidade absurda de mana, golens e armas de gelo)." },
  { approxLevel: 600, tag: "time_spatial_combat", desc: "Parar o tempo quase usável em combate contínuo + dano ofensivo direto com Magia Espacial." },
  { approxLevel: 1000, tag: "superdimensional", desc: "Existência quase superdimensional: exército de gelo e confrontos contra seres cósmicos em múltiplas esferas." }
];

export const CHAPTER_MAX_TURNS = 45;

export const DEFAULT_SETTINGS = {
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  geminiEpicModel: "gemini-2.5-pro", // "" = sem cascata
  monthlyBudgetUsd: 41,
  geminiRpdLimit: 250,
  geminiTpdLimit: 1000000,
  geminiRpmLimit: 15,
  supabaseUrl: "",
  supabaseAnonKey: "",
  slotId: "white-demon-01",
  supabaseStorageLimitMb: 500,
  artStylePrompt: DEFAULT_ART_STYLE
};

// US$ por 1M tokens (tarifa paga, prompt ≤200k). Thinking conta como saída.
export const MODEL_PRICES_USD = {
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 }
};

export function estimateCostUsd(models = {}) {
  return Object.entries(models).reduce((sum, [model, m]) => {
    const p = MODEL_PRICES_USD[model] || MODEL_PRICES_USD["gemini-2.5-flash"];
    return sum + (m.in * p.in + m.out * p.out) / 1e6;
  }, 0);
}

export const TERRAIN_GLYPHS = {
  forest: "♣♣",
  mountain: "▲▲",
  city: "[¤]",
  ruin: "╬╬",
  ice: "❄❄",
  void: "※",
  water: "≈≈",
  plain: "··",
  portal: "◎"
};

export function computeRankFromLevel(level, customTypology = null) {
  if (customTypology) return customTypology;
  if (level < 10) return "F";
  if (level < 25) return "E";
  if (level < 45) return "D";
  if (level < 70) return "C";
  if (level < 105) return "B";
  if (level < 150) return "A";
  if (level < 220) return "S";
  if (level < 310) return "SS";
  if (level < 420) return "SSS";
  if (level < 560) return "SSS+";
  if (level < 750) return "EX";
  if (level < 1000) return "EX+";
  const cosmicTier = Math.floor((level - 1000) / 250) + 1;
  return `Transcendente-${cosmicTier}`;
}
