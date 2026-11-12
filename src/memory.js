import { getChapterLocal } from "./state.js";
import { fetchChapterOnDemand, isSupabaseConfigured, matchMemoryVectors, upsertMemoryVectors } from "./supabase.js";

const STOPWORDS = new Set([
  "para", "com", "uma", "uns", "umas", "que", "como", "isso", "isto", "esse", "essa",
  "aquele", "aquela", "aqui", "ali", "onde", "quando", "sobre", "entre", "pelo", "pela",
  "pelos", "pelas", "dos", "das", "nos", "nas", "mais", "menos", "muito", "muita",
  "tudo", "nada", "meu", "minha", "seu", "sua", "dele", "dela", "esta", "este", "vou", "fazer"
]);

let vectorRagDisabled = false;

export function normText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function tokenize(str) {
  const words = normText(str).match(/[a-z0-9_]{3,}/g) || [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function stripHeavyFields(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (k === "imageWebp") return v ? "[has_portrait]" : null;
      if (k === "devLog" && Array.isArray(v)) return v.slice(-3);
      return v;
    })
  );
}

/** Gera um índice compacto de entidades e capítulos para o roteador Gemma 4 na frente. */
export function buildCompactCatalogForRouter(game) {
  const spheres = Object.values(game.spheres || {})
    .slice(0, 15)
    .map((s) => `${s.id}:${s.name}`)
    .join("; ");
  const summarizeArr = (arr, limit) =>
    (arr || [])
      .slice(-limit)
      .map((x) => {
        const links = Array.isArray(x.links) && x.links.length ? `->${x.links.slice(0, 3).join(",")}` : "";
        return `${x.name || x.id}${x.role ? `(${x.role})` : ""}${links}`;
      })
      .join("; ");
  const npcs = summarizeArr(game.compendium?.npcs, 55);
  const bestiary = summarizeArr(game.compendium?.bestiary, 35);
  const concepts = summarizeArr(game.compendium?.concepts, 55);
  const closed = (game.chaptersIndex || [])
    .filter((c) => c.isClosed)
    .slice(-50)
    .map((c) => `Cap.${c.chapterNumber}:${c.title || ""} — ${String(c.summary || "").slice(0, 90)}`)
    .join(" | ");

  return [
    spheres && `Esferas: ${spheres}`,
    npcs && `NPCs: ${npcs}`,
    bestiary && `Bestiário: ${bestiary}`,
    concepts && `Conceitos: ${concepts}`,
    closed && `Capítulos fechados: ${closed}`
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreItem(item, queryTokens, mentionNames) {
  const nameN = normText(item.name || item.id);
  const tagsN = Array.isArray(item.tags) ? item.tags.map(normText) : [];
  const linksN = Array.isArray(item.links) ? item.links.map(normText) : [];
  const blobN = normText([item.name, item.role, item.summary, item.desc, item.behavior, item.location].join(" "));

  let score = 0;
  for (const m of mentionNames) {
    if (nameN && (nameN.includes(m) || m.includes(nameN))) score += 12;
  }
  for (const tok of queryTokens) {
    if (nameN && nameN.includes(tok)) score += 6;
    if (tagsN.some((tg) => tg.includes(tok))) score += 3.5;
    if (linksN.some((lk) => lk.includes(tok))) score += 2.5;
    if (blobN.includes(tok)) score += 1;
  }
  return score;
}

/** Pontua compêndio e propaga 1 salto pelo mini-grafo (links + referências cruzadas). */
function retrieveGraphCompendium(game, queryTokens, mentionNames) {
  const cats = ["npcs", "bestiary", "concepts"];
  const allNodes = [];
  for (const cat of cats) {
    for (const item of game.compendium?.[cat] || []) {
      allNodes.push({
        cat,
        item,
        nameN: normText(item.name || item.id),
        idN: normText(item.id || ""),
        linksN: (Array.isArray(item.links) ? item.links : []).map(normText),
        blobN: normText([item.desc, item.role, item.relationship, item.location].join(" ")),
        score: scoreItem(item, queryTokens, mentionNames)
      });
    }
  }

  // Propagação 1-hop estilo grafo: nós fortes ativam vizinhos conectados
  const seeds = allNodes.filter((n) => n.score >= 3);
  for (const seed of seeds) {
    const boost = Math.min(4, seed.score * 0.45);
    for (const other of allNodes) {
      if (other === seed) continue;
      const connectedByLink =
        (other.nameN && seed.linksN.some((l) => l.includes(other.nameN) || other.nameN.includes(l))) ||
        (seed.nameN && other.linksN.some((l) => l.includes(seed.nameN) || seed.nameN.includes(l)));
      const connectedByText =
        (other.nameN.length >= 4 && seed.blobN.includes(other.nameN)) ||
        (seed.nameN.length >= 4 && other.blobN.includes(seed.nameN));
      if (connectedByLink || connectedByText) {
        other.score += boost;
      }
    }
  }

  const pickCat = (cat, limit) =>
    allNodes
      .filter((n) => n.cat === cat && n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((n) => stripHeavyFields(n.item));

  return {
    npcs: pickCat("npcs", 8),
    bestiary: pickCat("bestiary", 6),
    concepts: pickCat("concepts", 8)
  };
}

/** Resgata turnos específicos de capítulos antigos (localStorage ou Supabase sob demanda). */
async function recallPastChapterTurns(game, queryTokens, hintChapters = [], settings = null) {
  const closedList = (game.chaptersIndex || []).filter((c) => c.isClosed);
  if (!closedList.length) return [];

  const hintedSet = new Set((Array.isArray(hintChapters) ? hintChapters : []).map(Number).filter(Number.isFinite));
  const rankedChapters = closedList
    .map((c) => {
      const textN = normText(`${c.title || ""} ${c.summary || ""}`);
      let s = hintedSet.has(c.chapterNumber) ? 15 : 0;
      for (const tok of queryTokens) {
        if (textN.includes(tok)) s += 2;
      }
      return { c, score: s };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (!rankedChapters.length) return [];

  const snippets = [];
  for (const { c } of rankedChapters) {
    let ch = await getChapterLocal(c.chapterId);
    if (!ch && settings && isSupabaseConfigured(settings)) {
      ch = await fetchChapterOnDemand(settings, c.chapterId, game.usage).catch(() => null);
    }
    if (!ch?.turns?.length) continue;

    const scoredTurns = ch.turns
      .map((t) => {
        const tn = normText(`${t.user || ""} ${t.narrative || ""}`);
        let ts = 0;
        for (const tok of queryTokens) {
          if (tn.includes(tok)) ts += 1;
        }
        return { t, ts };
      })
      .sort((a, b) => b.ts - a.ts || (b.t.turn || 0) - (a.t.turn || 0))
      .slice(0, 2);

    for (const { t } of scoredTurns) {
      snippets.push({
        chapter: c.chapterNumber,
        title: c.title || "",
        turn: t.turn,
        user: String(t.user || "").slice(0, 180),
        narrative: String(t.narrative || "").slice(0, 420)
      });
    }
  }
  return snippets.slice(0, 4);
}

/** Gera embedding 768d via gemini-embedding-001 (cota Free 1.000 RPD disponível). */
export async function embedText(text, apiKey, taskType = "RETRIEVAL_DOCUMENT") {
  const key = (apiKey || "").trim();
  const clean = String(text || "").trim();
  if (!key || !clean) return null;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: clean.slice(0, 4000) }] },
          taskType,
          outputDimensionality: 768
        }),
        ...(ctrl ? { signal: ctrl.signal } : {})
      }
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const values = data?.embedding?.values;
    return Array.isArray(values) && values.length === 768 ? values : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isMissingVectorInfraError(err) {
  const msg = String(err?.message || "");
  return msg.includes("(404)") || msg.includes("PGRST") || msg.includes("twd_memory_vectors") || msg.includes("match_twd_memory");
}

/** Busca memórias semanticamente próximas no Supabase pgvector (falha silenciosa se SQL Fase 6 não rodado). */
export async function searchVectorMemory({ settings, queryText, apiKey, usage, matchCount = 5 }) {
  if (vectorRagDisabled || !settings || !isSupabaseConfigured(settings) || !apiKey || !String(queryText || "").trim()) {
    return [];
  }
  try {
    const vec = await embedText(queryText, apiKey, "RETRIEVAL_QUERY");
    if (!vec) return [];
    const rows = await matchMemoryVectors(settings, vec, matchCount, usage);
    return (rows || []).map((r) => ({
      kind: r.kind,
      title: r.title,
      chapter: r.chapter_number,
      similarity: Number(r.similarity || 0).toFixed(2),
      content: String(r.content || "").slice(0, 420)
    }));
  } catch (err) {
    if (isMissingVectorInfraError(err)) vectorRagDisabled = true;
    return [];
  }
}

/** Recupera contexto híbrido (Gemma hints + menções + grafo 1-hop + capítulos antigos + vetores pgvector). */
export async function retrieveRelevantMemory(
  game,
  userText,
  mentions,
  routerHints = {},
  { settings = null, vectorHits = [] } = {}
) {
  const recentTurnText = (game.activeChapter?.turns || [])
    .slice(-4)
    .map((t) => `${t.user || ""} ${t.narrative || ""}`)
    .join(" ");
  const hintTerms = Array.isArray(routerHints?.searchTerms) ? routerHints.searchTerms.join(" ") : "";
  const queryTokens = tokenize([userText, recentTurnText, hintTerms].join(" "));
  const mentionNames = [
    ...(mentions?.actors || []),
    ...(mentions?.items || []),
    ...(mentions?.locations || []),
    ...(mentions?.currencies || [])
  ].map(normText);

  const relevantCompendium = retrieveGraphCompendium(game, queryTokens, mentionNames);
  const recalledTurns = await recallPastChapterTurns(
    game,
    queryTokens,
    routerHints?.relevantChapters || [],
    settings
  );

  return {
    relevantCompendium,
    recalledTurns,
    vectorHits: Array.isArray(vectorHits) ? vectorHits : []
  };
}

/** Indexa em segundo plano novidades do compêndio e capítulos recém-fechados no pgvector. */
export async function indexMemoryInBackground({ settings, game, apiKey, patches = null, closedChapter = null }) {
  if (vectorRagDisabled || !settings || !isSupabaseConfigured(settings) || !apiKey) return;
  const itemsToIndex = [];
  const cu = patches?.compendiumUpdates;
  if (cu && typeof cu === "object") {
    for (const [cat, prefix] of [["npcs", "NPC"], ["bestiary", "Criatura"], ["concepts", "Conceito"]]) {
      for (const it of cu[cat] || []) {
        if (!it?.name && !it?.id) continue;
        itemsToIndex.push({
          mem_id: `${cat}:${it.id || it.name}`,
          kind: cat,
          title: it.name || it.id,
          chapter_number: game.activeChapter?.chapterNumber || 1,
          content: `${prefix}: ${it.name || it.id}. ${it.role || ""} ${it.desc || ""} ${it.behavior || ""} ${(it.links || []).join(", ")}`.trim()
        });
      }
    }
  }
  if (closedChapter) {
    itemsToIndex.push({
      mem_id: `chapter:${closedChapter.chapterId}`,
      kind: "chapter",
      title: closedChapter.title || `Capítulo ${closedChapter.chapterNumber}`,
      chapter_number: closedChapter.chapterNumber,
      content: `Capítulo ${closedChapter.chapterNumber} (${closedChapter.title || ""}): ${closedChapter.summary || ""}`
    });
  }
  if (!itemsToIndex.length) return;

  try {
    const now = new Date().toISOString();
    const slotId = settings.slotId.trim();
    const rows = [];
    for (const item of itemsToIndex.slice(0, 8)) {
      const vec = await embedText(item.content, apiKey, "RETRIEVAL_DOCUMENT");
      if (!vec) continue;
      rows.push({ slot_id: slotId, ...item, embedding: vec, updated_at: now });
    }
    if (rows.length) await upsertMemoryVectors(settings, rows, game.usage);
  } catch (err) {
    if (isMissingVectorInfraError(err)) vectorRagDisabled = true;
  }
}

/** Reindexa todo o compêndio e resumos de capítulos fechados para quem ativar a Fase 6 depois de meses de jogo. */
export async function reindexAllMemoryVectors({ settings, game, apiKey }) {
  if (!isSupabaseConfigured(settings)) throw new Error("Entre no Supabase antes de indexar o RAG.");
  if (!apiKey) throw new Error("Configure a Gemini API Key primeiro.");
  vectorRagDisabled = false;

  const queue = [];
  for (const [cat, prefix] of [["npcs", "NPC"], ["bestiary", "Criatura"], ["concepts", "Conceito"]]) {
    for (const it of game.compendium?.[cat] || []) {
      queue.push({
        mem_id: `${cat}:${it.id || it.name}`,
        kind: cat,
        title: it.name || it.id,
        chapter_number: null,
        content: `${prefix}: ${it.name || it.id}. ${it.role || ""} ${it.desc || ""} ${it.behavior || ""} ${(it.links || []).join(", ")}`.trim()
      });
    }
  }
  for (const c of (game.chaptersIndex || []).filter((ch) => ch.isClosed && ch.summary)) {
    queue.push({
      mem_id: `chapter:${c.chapterId}`,
      kind: "chapter",
      title: c.title || `Capítulo ${c.chapterNumber}`,
      chapter_number: c.chapterNumber,
      content: `Capítulo ${c.chapterNumber} (${c.title || ""}): ${c.summary}`
    });
  }

  const slotId = settings.slotId.trim();
  const now = new Date().toISOString();
  let indexed = 0;
  for (let i = 0; i < queue.length; i += 5) {
    const batch = [];
    for (const item of queue.slice(i, i + 5)) {
      const vec = await embedText(item.content, apiKey, "RETRIEVAL_DOCUMENT");
      if (vec) batch.push({ slot_id: slotId, ...item, embedding: vec, updated_at: now });
    }
    if (batch.length) {
      await upsertMemoryVectors(settings, batch, game.usage);
      indexed += batch.length;
    }
  }
  return indexed;
}
