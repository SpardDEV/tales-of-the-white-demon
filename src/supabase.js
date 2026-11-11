import { getAllChaptersLocal, saveChapterLocal, todayKey } from "./state.js";

export function isSupabaseConfigured(settings) {
  return Boolean(settings.supabaseUrl && settings.supabaseAnonKey && settings.slotId);
}

function baseUrl(settings) {
  return settings.supabaseUrl.replace(/\/+$/, "");
}

function headers(settings, extra = {}) {
  const key = (settings.supabaseAnonKey || "").trim();
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    ...extra
  };
  // Chaves modernas sb_publishable_ não são JWT; enviá-las em Authorization Bearer falha na API
  if (key && !key.startsWith("sb_")) {
    base.Authorization = `Bearer ${key}`;
  }
  return base;
}

async function sbFetch(settings, path, options = {}, usage = null) {
  if (usage) usage.supabaseRequests = (usage.supabaseRequests || 0) + 1;
  const res = await fetch(`${baseUrl(settings)}/rest/v1/${path}`, options);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Supabase (${res.status}): ${msg.slice(0, 180)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function upsert(settings, table, conflictCols, rows, usage) {
  return sbFetch(
    settings,
    `${table}?on_conflict=${encodeURIComponent(conflictCols)}`,
    {
      method: "POST",
      headers: headers(settings, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows)
    },
    usage
  );
}

export async function syncTurnToSupabase(settings, game, { fullSync = false } = {}) {
  if (!isSupabaseConfigured(settings)) return false;
  const slotId = settings.slotId.trim();
  const now = new Date().toISOString();

  // 1. Core sempre sincronizado
  await upsert(
    settings,
    "twd_saves",
    "slot_id",
    [{ slot_id: slotId, core_player: game.core, updated_at: now }],
    game.usage
  );

  // 2. Esferas (ativa por padrão, ou todas no fullSync)
  const sphereRows = (fullSync
    ? Object.values(game.spheres)
    : [game.spheres[game.core.meta.activeSphereId]].filter(Boolean)
  ).map((s) => ({
    slot_id: slotId,
    sphere_id: s.id,
    data: s,
    updated_at: now
  }));
  if (sphereRows.length) {
    await upsert(settings, "twd_spheres", "slot_id,sphere_id", sphereRows, game.usage);
  }

  // 3. Compêndio (3 categorias enxutas)
  await upsert(
    settings,
    "twd_compendium",
    "slot_id,category",
    [
      { slot_id: slotId, category: "npcs", items: game.compendium.npcs, updated_at: now },
      { slot_id: slotId, category: "bestiary", items: game.compendium.bestiary, updated_at: now },
      { slot_id: slotId, category: "concepts", items: game.compendium.concepts, updated_at: now }
    ],
    game.usage
  );

  // 4. Capítulo ativo (ou todos no fullSync)
  const chaptersToPush = fullSync
    ? await getAllChaptersLocal()
    : [game.activeChapter];
  const chapterRows = chaptersToPush.filter(Boolean).map((ch) => ({
    slot_id: slotId,
    chapter_id: ch.chapterId,
    chapter_number: ch.chapterNumber,
    title: ch.title || "",
    summary: ch.summary || "",
    turns: ch.turns || [],
    turn_count: ch.turnCount || 0,
    is_closed: Boolean(ch.isClosed),
    updated_at: now
  }));
  if (chapterRows.length) {
    await upsert(settings, "twd_chapters", "slot_id,chapter_id", chapterRows, game.usage);
  }

  // 5. Consumo do dia
  await upsert(
    settings,
    "twd_usage",
    "slot_id,day_key",
    [
      {
        slot_id: slotId,
        day_key: game.usage.dayKey || todayKey(),
        gemini_requests: game.usage.geminiRequests || 0,
        gemini_tokens: game.usage.geminiTokens || 0,
        supabase_requests: game.usage.supabaseRequests || 0,
        updated_at: now
      }
    ],
    game.usage
  );

  return true;
}

export async function pullGameFromSupabase(settings, currentUsage) {
  if (!isSupabaseConfigured(settings)) {
    throw new Error("Preencha URL, Anon Key e Slot ID do Supabase nas Configurações.");
  }
  const slot = encodeURIComponent(settings.slotId.trim());

  const saves = await sbFetch(
    settings,
    `twd_saves?slot_id=eq.${slot}&select=core_player`,
    { headers: headers(settings) },
    currentUsage
  );
  if (!saves || !saves.length) {
    throw new Error(`Nenhum save encontrado para o Slot ID "${settings.slotId}".`);
  }
  const core = saves[0].core_player;

  const sphereRows = await sbFetch(
    settings,
    `twd_spheres?slot_id=eq.${slot}&select=sphere_id,data`,
    { headers: headers(settings) },
    currentUsage
  );
  const spheres = {};
  for (const r of sphereRows || []) {
    spheres[r.sphere_id] = r.data;
  }

  const compRows = await sbFetch(
    settings,
    `twd_compendium?slot_id=eq.${slot}&select=category,items`,
    { headers: headers(settings) },
    currentUsage
  );
  const compendium = { npcs: [], bestiary: [], concepts: [] };
  for (const r of compRows || []) {
    if (compendium[r.category]) compendium[r.category] = r.items || [];
  }

  // Baixa apenas metadados/resumos de todos os capítulos (sem turnos brutos antigos)
  const idxRows = await sbFetch(
    settings,
    `twd_chapters?slot_id=eq.${slot}&select=chapter_id,chapter_number,title,summary,turn_count,is_closed&order=chapter_number.asc`,
    { headers: headers(settings) },
    currentUsage
  );
  const chaptersIndex = (idxRows || []).map((r) => ({
    chapterId: r.chapter_id,
    chapterNumber: r.chapter_number,
    title: r.title,
    summary: r.summary,
    turnCount: r.turn_count,
    isClosed: r.is_closed
  }));

  // Baixa os turnos apenas do capítulo ativo
  const activeId = encodeURIComponent(core.meta.activeChapterId);
  const activeRows = await sbFetch(
    settings,
    `twd_chapters?slot_id=eq.${slot}&chapter_id=eq.${activeId}&select=*`,
    { headers: headers(settings) },
    currentUsage
  );
  const ar = activeRows?.[0];
  const activeChapter = ar
    ? {
        chapterId: ar.chapter_id,
        chapterNumber: ar.chapter_number,
        title: ar.title,
        summary: ar.summary,
        turns: ar.turns || [],
        turnCount: ar.turn_count,
        isClosed: ar.is_closed
      }
    : {
        chapterId: core.meta.activeChapterId,
        chapterNumber: core.meta.activeChapterNumber,
        title: `Capítulo ${core.meta.activeChapterNumber}`,
        summary: "",
        turns: [],
        turnCount: 0,
        isClosed: false
      };

  const day = encodeURIComponent(todayKey());
  const usageRows = await sbFetch(
    settings,
    `twd_usage?slot_id=eq.${slot}&day_key=eq.${day}&select=*`,
    { headers: headers(settings) },
    currentUsage
  );
  const ur = usageRows?.[0];
  const usage = {
    dayKey: todayKey(),
    geminiRequests: ur?.gemini_requests ?? currentUsage.geminiRequests ?? 0,
    geminiTokens: Number(ur?.gemini_tokens ?? currentUsage.geminiTokens ?? 0),
    recentRequestTimestamps: currentUsage.recentRequestTimestamps || [],
    supabaseRequests: ur?.supabase_requests ?? currentUsage.supabaseRequests ?? 0,
    estimatedBytes: 0
  };

  return { core, spheres, compendium, chaptersIndex, activeChapter, usage };
}

export async function fetchChapterOnDemand(settings, chapterId, usage) {
  if (!isSupabaseConfigured(settings)) return null;
  const slot = encodeURIComponent(settings.slotId.trim());
  const ch = encodeURIComponent(chapterId);
  const rows = await sbFetch(
    settings,
    `twd_chapters?slot_id=eq.${slot}&chapter_id=eq.${ch}&select=*`,
    { headers: headers(settings) },
    usage
  );
  const ar = rows?.[0];
  if (!ar) return null;
  const chapter = {
    chapterId: ar.chapter_id,
    chapterNumber: ar.chapter_number,
    title: ar.title,
    summary: ar.summary,
    turns: ar.turns || [],
    turnCount: ar.turn_count,
    isClosed: ar.is_closed
  };
  await saveChapterLocal(chapter);
  return chapter;
}
