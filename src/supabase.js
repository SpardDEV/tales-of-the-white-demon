import { getAllChaptersLocal, saveChapterLocal, saveMediaLocal, todayKey } from "./state.js";
import { sumModels } from "./config.js";

export function isSupabaseConfigured(settings) {
  return Boolean(settings.supabaseUrl && settings.supabaseAnonKey && settings.slotId && loadSession());
}

function baseUrl(settings) {
  return settings.supabaseUrl.replace(/\/+$/, "");
}

function headers(settings, extra = {}) {
  const key = (settings.supabaseAnonKey || "").trim();
  return { apikey: key, "Content-Type": "application/json", ...extra };
}

// --- Supabase Auth (Fase 5.5): RLS exige owner = auth.uid(), então toda chamada leva o JWT da sessão.
const SESSION_KEY = "twd_sb_session";

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}

function storeSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user?.email || "",
    userId: data.user?.id || ""
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function sessionUserId() {
  const s = loadSession();
  if (s?.userId) return s.userId;
  try {
    const payload = s?.access_token?.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64))?.sub || null;
  } catch {
    return null;
  }
}

async function authToken(settings, grant, body) {
  const res = await fetch(`${baseUrl(settings)}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: (settings.supabaseAnonKey || "").trim(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login Supabase: ${data.error_description || data.msg || res.status}`);
  return storeSession(data);
}

export function signInSupabase(settings, email, password) {
  return authToken(settings, "password", { email, password });
}

export function signOutSupabase() {
  localStorage.removeItem(SESSION_KEY);
}

export function supabaseUserEmail() {
  return loadSession()?.email || "";
}

async function accessToken(settings) {
  let s = loadSession();
  if (!s) throw new Error("Entre com seu e-mail e senha do Supabase nas Configurações.");
  if (s.expires_at - 60 < Date.now() / 1000) {
    try {
      s = await authToken(settings, "refresh_token", { refresh_token: s.refresh_token });
    } catch (err) {
      signOutSupabase();
      throw err;
    }
  }
  return s.access_token;
}

async function sbFetch(settings, path, options = {}, usage = null) {
  if (usage) usage.supabaseRequests = (usage.supabaseRequests || 0) + 1;
  const token = await accessToken(settings);
  options = { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } };
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

function chapterRow(slotId, ch, now) {
  return {
    slot_id: slotId,
    chapter_id: ch.chapterId,
    chapter_number: ch.chapterNumber,
    title: ch.title || "",
    summary: ch.summary || "",
    turns: ch.turns || [],
    turn_count: ch.turnCount || 0,
    is_closed: Boolean(ch.isClosed),
    updated_at: now,
    // só manda a coluna quando existe: sem o SQL da Fase 5.6 o sync comum continua funcionando
    ...(ch.webtoonPrompts ? { webtoon_prompts: ch.webtoonPrompts } : {})
  };
}

// PostgREST exige as mesmas chaves em todas as linhas de um lote: separa quem tem webtoon.
async function upsertChapters(settings, slotId, chapters, now, usage) {
  const rows = chapters.map((ch) => chapterRow(slotId, ch, now));
  for (const group of [rows.filter((r) => !r.webtoon_prompts), rows.filter((r) => r.webtoon_prompts)]) {
    if (group.length) await upsert(settings, "twd_chapters", "slot_id,chapter_id", group, usage);
  }
}

export async function pushChapterToSupabase(settings, chapter, usage) {
  if (!isSupabaseConfigured(settings)) return false;
  await upsertChapters(settings, settings.slotId.trim(), [chapter], new Date().toISOString(), usage);
  return true;
}

export async function syncTurnToSupabase(settings, game, { fullSync = false } = {}) {
  if (!isSupabaseConfigured(settings)) return false;
  const slotId = settings.slotId.trim();
  const now = new Date().toISOString();

  await upsert(
    settings,
    "twd_saves",
    "slot_id",
    [{ slot_id: slotId, core_player: game.core, updated_at: now }],
    game.usage
  );

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

  const chaptersToPush = fullSync
    ? await getAllChaptersLocal()
    : [game.activeChapter];
  await upsertChapters(settings, slotId, chaptersToPush.filter(Boolean), now, game.usage);

  // Upload diferencial apenas das mídias novas/alteradas (ou todas no fullSync)
  const mediaIdsToPush = fullSync
    ? Object.keys(game.mediaCache || {})
    : (game.usage.dirtyMediaIds || []);
  if (mediaIdsToPush.length) {
    const mediaRows = mediaIdsToPush
      .map((id) => game.mediaCache?.[id])
      .filter((m) => m && m.webpData)
      .map((m) => ({
        slot_id: slotId,
        media_id: m.mediaId,
        webp_data: m.webpData,
        updated_at: m.updatedAt || now
      }));
    if (mediaRows.length) {
      await upsert(settings, "twd_media", "slot_id,media_id", mediaRows, game.usage);
    }
    game.usage.dirtyMediaIds = [];
  }

  const usageRow = {
    slot_id: slotId,
    day_key: game.usage.dayKey || todayKey(),
    gemini_requests: game.usage.geminiRequests || 0,
    gemini_tokens: game.usage.geminiTokens || 0,
    supabase_requests: game.usage.supabaseRequests || 0,
    models: game.usage.models || {},
    updated_at: now
  };
  try {
    await upsert(settings, "twd_usage", "slot_id,day_key", [usageRow], game.usage);
  } catch {
    // coluna "models" ainda não criada no SQL Editor: envia sem o custo por modelo
    const { models, ...legacy } = usageRow;
    await upsert(settings, "twd_usage", "slot_id,day_key", [legacy], game.usage);
  }

  return true;
}

export async function pullGameFromSupabase(settings, currentUsage, currentMediaCache = {}, lastMediaSyncAt = null) {
  if (!isSupabaseConfigured(settings)) {
    throw new Error("Preencha URL, Publishable Key e Slot ID do Supabase e entre com e-mail/senha nas Configurações.");
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
  for (const r of sphereRows || []) spheres[r.sphere_id] = r.data;

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
        isClosed: ar.is_closed,
        webtoonPrompts: ar.webtoon_prompts || null
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

  // Download diferencial de imagens: baixa apenas mídias mais novas que lastMediaSyncAt
  const mediaCache = { ...currentMediaCache };
  try {
    const filterSince = lastMediaSyncAt
      ? `&updated_at=gt.${encodeURIComponent(lastMediaSyncAt)}`
      : "";
    const mediaRows = await sbFetch(
      settings,
      `twd_media?slot_id=eq.${slot}${filterSince}&select=media_id,webp_data,updated_at`,
      { headers: headers(settings) },
      currentUsage
    );
    let newestIso = lastMediaSyncAt;
    for (const mr of mediaRows || []) {
      const saved = await saveMediaLocal(mr.media_id, mr.webp_data, mr.updated_at);
      mediaCache[mr.media_id] = saved;
      if (!newestIso || mr.updated_at > newestIso) newestIso = mr.updated_at;
    }
    if (newestIso) core.meta.lastMediaSyncAt = newestIso;
  } catch {
    // Se twd_media ainda não foi criada no SQL Editor, não quebra o pull principal
  }

  // Linhas do mês inteiro: hoje para as cotas do dia, a soma para o orçamento mensal (PC + celular).
  const today = todayKey();
  const month = today.slice(0, 7);
  const usageRows = await sbFetch(
    settings,
    `twd_usage?slot_id=eq.${slot}&day_key=like.${encodeURIComponent(month)}*&select=*`,
    { headers: headers(settings) },
    currentUsage
  );
  const ur = (usageRows || []).find((r) => r.day_key === today);
  const remoteHasModels = (usageRows || []).some((r) => r.models && Object.keys(r.models).length);
  const sameDay = currentUsage.dayKey === today;
  const usage = {
    dayKey: today,
    geminiRequests: ur?.gemini_requests ?? (sameDay ? currentUsage.geminiRequests : 0) ?? 0,
    geminiTokens: Number(ur?.gemini_tokens ?? (sameDay ? currentUsage.geminiTokens : 0) ?? 0),
    recentRequestTimestamps: currentUsage.recentRequestTimestamps || [],
    supabaseRequests: ur?.supabase_requests ?? currentUsage.supabaseRequests ?? 0,
    models: ur?.models ?? (sameDay ? currentUsage.models : null) ?? {},
    monthKey: month,
    monthModels: remoteHasModels
      ? sumModels(usageRows.map((r) => r.models))
      : (currentUsage.monthKey === month ? currentUsage.monthModels : null) || {},
    estimatedBytes: 0,
    dirtyMediaIds: []
  };

  return { core, spheres, compendium, chaptersIndex, activeChapter, usage, mediaCache };
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
    isClosed: ar.is_closed,
    webtoonPrompts: ar.webtoon_prompts || null
  };
  await saveChapterLocal(chapter);
  return chapter;
}

const SYNCED_SETTING_KEYS = [
  "geminiKey",
  "geminiPaidKey",
  "ttsKey",
  "ttsVoice",
  "vertexProxyEnabled",
  "vertexImageModel",
  "geminiModel",
  "geminiEpicModel",
  "geminiClassifierModel",
  "epicManualOnly",
  "monthlyBudgetUsd",
  "geminiRpdLimit",
  "geminiTpdLimit",
  "slotId",
  "artStylePrompt"
];

export async function pushUserSettingsToSupabase(settings) {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !loadSession()) return false;
  const owner = sessionUserId();
  if (!owner) return false;
  const payload = {};
  for (const k of SYNCED_SETTING_KEYS) {
    if (settings[k] !== undefined) payload[k] = settings[k];
  }
  await upsert(
    settings,
    "twd_user_settings",
    "owner",
    [{ owner, settings: payload, updated_at: new Date().toISOString() }],
    null
  );
  return true;
}

export async function pullUserSettingsFromSupabase(settings) {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !loadSession()) return null;
  const rows = await sbFetch(
    settings,
    "twd_user_settings?select=settings&limit=1",
    { headers: headers(settings) },
    null
  );
  return rows?.[0]?.settings || null;
}

export async function upsertMemoryVectors(settings, rows, usage = null) {
  if (!isSupabaseConfigured(settings) || !rows?.length) return false;
  const owner = sessionUserId();
  const payload = rows.map((r) => ({ ...r, ...(owner ? { owner } : {}) }));
  await upsert(settings, "twd_memory_vectors", "slot_id,mem_id", payload, usage);
  return true;
}

export async function matchMemoryVectors(settings, queryEmbedding, matchCount = 5, usage = null) {
  if (!isSupabaseConfigured(settings) || !Array.isArray(queryEmbedding)) return [];
  return sbFetch(
    settings,
    "rpc/match_twd_memory",
    {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        p_slot_id: settings.slotId.trim(),
        match_count: matchCount
      })
    },
    usage
  );
}

export async function callVertexProxy(settings, payload, usage = null) {
  if (!settings?.supabaseUrl || !settings?.supabaseAnonKey) {
    throw new Error("Configure URL e Anon Key do Supabase nas Configurações.");
  }
  if (!loadSession()) {
    throw new Error("Entre com seu e-mail e senha do Supabase nas Configurações para usar a ponte Vertex AI.");
  }
  if (usage) usage.supabaseRequests = (usage.supabaseRequests || 0) + 1;
  const token = await accessToken(settings);
  const res = await fetch(`${baseUrl(settings)}/functions/v1/vertex-proxy`, {
    method: "POST",
    headers: {
      ...headers(settings),
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Edge Function 'vertex-proxy' ainda não publicada no seu Supabase.");
    }
    throw new Error(data?.error || `Vertex Proxy (${res.status})`);
  }
  return data;
}
