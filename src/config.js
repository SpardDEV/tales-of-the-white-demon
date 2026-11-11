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

// Opcional: se quiser já deixar o endereço público do Supabase pré-carregado no site,
// cole abaixo a Project URL e a Publishable/Anon Key (são chaves públicas protegidas pelo RLS).
export const PRELOADED_SUPABASE_URL = "https://zqxrbrkzgmtrozdatdcw.supabase.co";
export const PRELOADED_SUPABASE_ANON_KEY = "sb_publishable_nr_xmS7O95cUleEDfsXsbw_6T926AGw";

export const USD_TO_BRL_REF = 6.0; // referência aproximada (US$ 5 ≈ R$ 30)

export const TTS_TIERS = {
  "pt-BR-Neural2-B": { label: "Neural2 Masculina (1M grátis/mês · $16/1M)", freeMonthlyChars: 1000000, usdPerChar: 0.000016 },
  "pt-BR-Neural2-A": { label: "Neural2 Feminina (1M grátis/mês · $16/1M)", freeMonthlyChars: 1000000, usdPerChar: 0.000016 },
  "pt-BR-Wavenet-B": { label: "WaveNet Masculina (4M grátis/mês · $4/1M)", freeMonthlyChars: 4000000, usdPerChar: 0.000004 },
  browser: { label: "Voz do Navegador (R$ 0 · offline)", freeMonthlyChars: Infinity, usdPerChar: 0 }
};

export const DEFAULT_SETTINGS = {
  geminiKey: "", // API Free: sempre tentada primeiro em cada modelo
  geminiPaidKey: "", // API Paga (créditos): só usada por modelo após aviso/confirmação
  ttsKey: "", // Google Cloud TTS Key (se vazia, tenta geminiPaidKey)
  ttsVoice: "pt-BR-Neural2-B",
  geminiModel: "gemini-3.5-flash-lite",
  geminiEpicModel: "gemini-3.8-flash", // "" = sem cascata
  geminiClassifierModel: "gemma-4-31b-it", // "" = só a marca "epico" do turno anterior decide
  epicManualOnly: true, // Só aciona Narrador Épico via /epic (protege R$ 30)
  monthlyBudgetUsd: 5, // ~R$ 30 em dólares (teto da Chave Paga)
  geminiRpdLimit: 250,
  geminiTpdLimit: 1000000,
  geminiRpmLimit: 15,
  supabaseUrl: PRELOADED_SUPABASE_URL,
  supabaseAnonKey: PRELOADED_SUPABASE_ANON_KEY,
  slotId: "white-demon-01",
  supabaseStorageLimitMb: 500,
  artStylePrompt: DEFAULT_ART_STYLE
};

// US$ por 1M tokens (referência estimada para o medidor Heimdall; thinking conta como saída).
export const MODEL_PRICES_USD = {
  "gemini-4-carbon": { in: 2.0, out: 12.0 },
  "gemini-4-argon": { in: 1.25, out: 10.0 },
  "gemini-3.8-flash": { in: 0.3, out: 2.5 },
  "gemini-3.5-flash": { in: 0.3, out: 2.5 },
  "gemini-3.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-3.1-pro-preview": { in: 1.25, out: 10.0 },
  "gemini-2.5-pro": { in: 1.25, out: 10.0 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemma-4-31b-it": { in: 0, out: 0 }, // gratuito na API Gemini
  "gemma-4-26b-a4b-it": { in: 0, out: 0 }, // gratuito na API Gemini
  "gemma-3-27b-it": { in: 0, out: 0 } // gratuito na API Gemini
};

// Soma vários buckets { modelo: {req,in,out} } (dias do mês vindos do twd_usage).
export function sumModels(list) {
  const total = {};
  for (const models of list) {
    for (const [name, m] of Object.entries(models || {})) {
      const t = (total[name] ||= { req: 0, in: 0, out: 0 });
      t.req += m.req || 0;
      t.in += m.in || 0;
      t.out += m.out || 0;
    }
  }
  return total;
}

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
