import {
  CHAPTER_MAX_TURNS,
  computeRankFromLevel,
  DEFAULT_SETTINGS,
  PROTAGONIST_APPEARANCE_BASE
} from "./config.js";

const DB_NAME = "twd_infinite_rpg_v1";
const DB_VERSION = 2;
const SETTINGS_KEY = "twd_local_settings_v1";
const MEM_FALLBACK = { kv: new Map(), chapters: new Map(), media: new Map() };

export function loadSettings() {
  const apkSecrets =
    typeof globalThis !== "undefined" && globalThis.__TWD_APK_SECRETS__ && typeof globalThis.__TWD_APK_SECRETS__ === "object"
      ? globalThis.__TWD_APK_SECRETS__
      : {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...apkSecrets,
      ...saved,
      supabaseUrl: saved.supabaseUrl || apkSecrets.supabaseUrl || DEFAULT_SETTINGS.supabaseUrl,
      supabaseAnonKey: saved.supabaseAnonKey || apkSecrets.supabaseAnonKey || DEFAULT_SETTINGS.supabaseAnonKey
    };
  } catch {
    return { ...DEFAULT_SETTINGS, ...apkSecrets };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // fallback silencioso
  }
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function createInitialGameData() {
  const chapterId = "chapter_001";
  const sphereId = "sphere_01";
  return {
    core: {
      meta: {
        version: 2,
        phase: "prologue_world",
        prologueQuestionCount: 0,
        prologueTargetMin: 30,
        prologueTargetMax: 30,
        deityTarget: 15,
        deityQuestionCount: 0,
        activeChapterId: chapterId,
        activeChapterNumber: 1,
        activeSphereId: sphereId,
        activeNodeId: "node_001",
        totalTurns: 0,
        lastMediaSyncAt: null
      },
      player: {
        name: "Engenheiro (Sem Nome)",
        origin: "Engenheiro da Terra (Recém-reencarnado)",
        appearance: PROTAGONIST_APPEARANCE_BASE,
        mediaId: null,
        level: 1,
        rank: "F",
        customRankTypology: null,
        xp: 0,
        xpToNext: 100,
        hp: 100,
        hpMax: 100,
        mana: 40,
        manaMax: 40,
        stamina: 100,
        staminaMax: 100,
        attributes: {
          vitalidade: 10,
          forca: 9,
          agilidade: 10,
          mana_espirito: 12,
          controle_precisao: 15,
          mente_engenharia: 18
        },
        currencies: [],
        bodyModifications: [],
        titles: ["Alma Deslocada"],
        statusEffects: [],
        armor: 0, // Fase 5.7: dano bruto − armadura bate nos 100% de HP
        injuries: {} // região -> { severity 0..100, effect } (estilo Fallout)
      },
      magicSystem: null, // Fase 5.7: leis/"física" da magia montadas nas 15 perguntas da Deusa
      patronDeity: {
        name: "Deusa Desconhecida",
        domain: "A definir",
        disposition: "Observadora",
        bond: 0,
        notes: ""
      },
      manaConsciousness: {
        unlocked: false,
        name: null,
        awakenedAtLevel: null,
        personality: "Dormente — aguardando nascimento por ação e reação.",
        sync: 0,
        lastRemarks: []
      },
      skills: [],
      projects: [],
      golems: {
        maxSlots: 7,
        items: []
      },
      spatialPocket: {
        unlocked: false,
        name: "Mundo de Bolso",
        storedMana: 0,
        storedManaCap: 0,
        storedItems: [],
        golemsInside: []
      },
      pet: {
        unlocked: false,
        name: null,
        species: null,
        rank: null,
        personality: "",
        appearance: "",
        mediaId: null,
        bond: 0,
        abilities: [],
        notes: ""
      },
      keyItems: [],
      inventory: [],
      nearbyActors: [],
      quests: {
        active: [],
        completed: []
      },
      pendingNegotiation: null
    },
    spheres: {
      [sphereId]: {
        id: sphereId,
        name: "Esfera Primordial (Em Formação)",
        order: 1,
        typologyCeiling: "EX+",
        canReturn: true,
        unlockedVia: "Reencarnação inicial",
        lawsSummary: "As leis desta esfera serão moldadas pelas respostas à Voz do Mundo.",
        nodes: [
          {
            id: "node_001",
            name: "Vazio Liminar",
            region: "Limiar",
            lat: 0,
            lon: 0,
            terrain: "void",
            asciiGlyph: "※",
            dangerRank: "N/A",
            discovered: true,
            summary: "Ponto de transição entre a morte na Terra e o despertar.",
            portalToSphereId: null,
            connectedTo: []
          }
        ]
      }
    },
    compendium: {
      npcs: [],
      bestiary: [],
      concepts: []
    },
    chaptersIndex: [
      {
        chapterId,
        chapterNumber: 1,
        title: "Prólogo: A Voz e a Patrona",
        summary: "",
        turnCount: 0,
        isClosed: false
      }
    ],
    activeChapter: {
      chapterId,
      chapterNumber: 1,
      title: "Prólogo: A Voz e a Patrona",
      summary: "",
      turns: [],
      turnCount: 0,
      isClosed: false
    },
    usage: {
      dayKey: todayKey(),
      geminiRequests: 0,
      geminiTokens: 0,
      recentRequestTimestamps: [],
      supabaseRequests: 0,
      estimatedBytes: 0,
      dirtyMediaIds: []
    },
    mediaCache: {} // { [mediaId]: { mediaId, webpData, updatedAt } } — não é serializado em core/compendium!
  };
}

// ============================================================================
// IndexedDB Persistence (local offline mirror + partitioned chapters & media)
// ============================================================================
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("chapters")) db.createObjectStore("chapters", { keyPath: "chapterId" });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "mediaId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    if (MEM_FALLBACK.kv.has(key)) return MEM_FALLBACK.kv.get(key);
    try {
      const raw = localStorage.getItem(`twd_kv_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

async function kvSet(key, val) {
  MEM_FALLBACK.kv.set(key, val);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`twd_kv_${key}`, JSON.stringify(val));
    } catch {
      // mantém em memória
    }
  }
}

export async function saveChapterLocal(chapter) {
  MEM_FALLBACK.chapters.set(chapter.chapterId, chapter);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("chapters", "readwrite");
      tx.objectStore("chapters").put(chapter);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`twd_ch_${chapter.chapterId}`, JSON.stringify(chapter));
    } catch {
      // mantém em memória
    }
  }
}

export async function getChapterLocal(chapterId) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chapters", "readonly");
      const req = tx.objectStore("chapters").get(chapterId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    if (MEM_FALLBACK.chapters.has(chapterId)) return MEM_FALLBACK.chapters.get(chapterId);
    try {
      const raw = localStorage.getItem(`twd_ch_${chapterId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export async function getAllChaptersLocal() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chapters", "readonly");
      const req = tx.objectStore("chapters").getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return Array.from(MEM_FALLBACK.chapters.values());
  }
}

export async function saveMediaLocal(mediaId, webpData, updatedAt = new Date().toISOString()) {
  const item = { mediaId, webpData, updatedAt };
  MEM_FALLBACK.media.set(mediaId, item);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // fallback em memória se localStorage não comportar blob
  }
  return item;
}

export async function getAllMediaLocal() {
  try {
    const db = await openDB();
    const list = await new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readonly");
      const req = tx.objectStore("media").getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    const map = {};
    for (const item of list) map[item.mediaId] = item;
    return map;
  } catch {
    const map = {};
    for (const [k, v] of MEM_FALLBACK.media.entries()) map[k] = v;
    return map;
  }
}

export async function clearAllLocal() {
  MEM_FALLBACK.kv.clear();
  MEM_FALLBACK.chapters.clear();
  MEM_FALLBACK.media.clear();
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["kv", "chapters", "media"], "readwrite");
      tx.objectStore("kv").clear();
      tx.objectStore("chapters").clear();
      tx.objectStore("media").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("twd_kv_") || k.startsWith("twd_ch_"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }
}

function migrateLegacyCore(core) {
  const base = createInitialGameData().core;
  core.meta = { ...base.meta, ...(core.meta || {}), version: 2 };
  core.player = { ...base.player, ...(core.player || {}) };
  if (!Array.isArray(core.player.currencies)) core.player.currencies = [];
  if (!Array.isArray(core.projects)) core.projects = [];
  if (!Array.isArray(core.keyItems)) core.keyItems = [];
  if (!Array.isArray(core.nearbyActors)) core.nearbyActors = [];
  if (!core.player.injuries || typeof core.player.injuries !== "object") core.player.injuries = {};
  // Fase 5.7: HP é sempre percentual (0..100)
  if (core.player.hpMax !== 100) {
    core.player.hp = Math.round((core.player.hp / (core.player.hpMax || 100)) * 100);
    core.player.hpMax = 100;
  }
  core.skills = (core.skills || []).map((s) => ({ devLog: [], ...s }));
  return core;
}

export async function loadGameDataLocal() {
  let core = await kvGet("core");
  if (!core) {
    const fresh = createInitialGameData();
    await persistGameDataLocal(fresh);
    return fresh;
  }
  core = migrateLegacyCore(core);
  const spheres = (await kvGet("spheres")) || createInitialGameData().spheres;
  const compendium = (await kvGet("compendium")) || { npcs: [], bestiary: [], concepts: [] };
  const chaptersIndex = (await kvGet("chaptersIndex")) || [];
  let usage = (await kvGet("usage")) || createInitialGameData().usage;
  if (usage.dayKey !== todayKey()) {
    usage = {
      ...usage,
      dayKey: todayKey(),
      geminiRequests: 0,
      geminiTokens: 0,
      recentRequestTimestamps: [],
      models: {}
    };
  }
  if (!Array.isArray(usage.dirtyMediaIds)) usage.dirtyMediaIds = [];

  const activeChapter =
    (await getChapterLocal(core.meta.activeChapterId)) ||
    createInitialGameData().activeChapter;
  const mediaCache = await getAllMediaLocal();

  return { core, spheres, compendium, chaptersIndex, activeChapter, usage, mediaCache };
}

export async function persistGameDataLocal(game) {
  game.usage.estimatedBytes = estimateBytesSize(game);
  await kvSet("core", game.core);
  await kvSet("spheres", game.spheres);
  await kvSet("compendium", game.compendium);
  await kvSet("chaptersIndex", game.chaptersIndex);
  await kvSet("usage", game.usage);
  await saveChapterLocal(game.activeChapter);
}

export function estimateBytesSize(game) {
  try {
    const jsonBytes = new Blob([
      JSON.stringify({
        core: game.core,
        spheres: game.spheres,
        compendium: game.compendium,
        chaptersIndex: game.chaptersIndex,
        activeChapter: game.activeChapter
      })
    ]).size;
    let mediaBytes = 0;
    for (const m of Object.values(game.mediaCache || {})) {
      mediaBytes += m?.webpData?.length || 0;
    }
    return jsonBytes + mediaBytes;
  } catch {
    return 0;
  }
}

// ============================================================================
// Undo Snapshots (in-memory up to 5 recent turns)
// ============================================================================
const UNDO_STACK = [];

export function pushUndoSnapshot(game) {
  const clone = structuredClone({
    core: game.core,
    spheres: game.spheres,
    compendium: game.compendium,
    chaptersIndex: game.chaptersIndex,
    activeChapter: game.activeChapter
  });
  UNDO_STACK.push(clone);
  if (UNDO_STACK.length > 5) UNDO_STACK.shift();
}

export function canUndo() {
  return UNDO_STACK.length > 0;
}

export function popUndoSnapshot(game) {
  const prev = UNDO_STACK.pop();
  if (!prev) return false;
  game.core = prev.core;
  game.spheres = prev.spheres;
  game.compendium = prev.compendium;
  game.chaptersIndex = prev.chaptersIndex;
  game.activeChapter = prev.activeChapter;
  return true;
}

// ============================================================================
// Deterministic Patch Application
// ============================================================================
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function upsertByKey(list, incoming, key = "id") {
  if (!incoming) return;
  const renameTarget = incoming.renameFrom;
  const idVal = incoming[key] || incoming.name;
  let idx = list.findIndex((item) => (item[key] || item.name) === idVal);
  if (idx < 0 && renameTarget) {
    idx = list.findIndex(
      (item) =>
        item[key] === renameTarget ||
        (item.name && item.name.toLowerCase() === String(renameTarget).toLowerCase())
    );
  }
  const cleanIncoming = { ...incoming };
  delete cleanIncoming.renameFrom;
  const logEntry = cleanIncoming.devLogEntry;
  delete cleanIncoming.devLogEntry;

  if (idx >= 0) {
    const prev = list[idx];
    const mergedFacts = Array.isArray(prev.knownFacts) || Array.isArray(cleanIncoming.knownFacts)
      ? Array.from(new Set([...(prev.knownFacts || []), ...(cleanIncoming.knownFacts || [])]))
      : undefined;
    const prevLogs = Array.isArray(prev.devLog) ? prev.devLog : [];
    const nextLogs = logEntry ? [...prevLogs, logEntry].slice(-25) : prevLogs;
    list[idx] = { ...prev, ...cleanIncoming, devLog: nextLogs };
    if (!cleanIncoming.mediaId && prev.mediaId) list[idx].mediaId = prev.mediaId;
    if (mergedFacts) list[idx].knownFacts = mergedFacts;
  } else {
    const devLog = logEntry ? [logEntry] : Array.isArray(cleanIncoming.devLog) ? cleanIncoming.devLog : [];
    list.push({ ...cleanIncoming, [key]: idVal, devLog });
  }
}

export function applyStatePatches(game, patches) {
  if (!patches || typeof patches !== "object") return;
  const { core, spheres, compendium } = game;
  const p = core.player;

  if (typeof patches.playerName === "string" && patches.playerName.trim()) {
    p.name = patches.playerName.trim();
  }
  if (typeof patches.playerAppearance === "string" && patches.playerAppearance.trim()) {
    p.appearance = patches.playerAppearance.trim();
  }

  if (typeof patches.manaMaxDelta === "number") p.manaMax = Math.max(0, p.manaMax + patches.manaMaxDelta);
  if (typeof patches.staminaMaxDelta === "number") p.staminaMax = Math.max(10, p.staminaMax + patches.staminaMaxDelta);

  if (typeof patches.hpDelta === "number") p.hp = clamp(p.hp + patches.hpDelta, 0, p.hpMax);
  if (typeof patches.manaDelta === "number") p.mana = clamp(p.mana + patches.manaDelta, 0, p.manaMax);
  if (typeof patches.staminaDelta === "number") p.stamina = clamp(p.stamina + patches.staminaDelta, 0, p.staminaMax);

  if (typeof patches.xpDelta === "number" && patches.xpDelta > 0) {
    p.xp += patches.xpDelta;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level += 1;
      p.manaMax += 8;
      p.staminaMax += 8;
      p.hp = p.hpMax;
      p.mana = p.manaMax;
      p.stamina = p.staminaMax;
      p.xpToNext = Math.round(100 * Math.pow(1.12, Math.min(p.level, 80)) + p.level * 35);
    }
  }

  if (typeof patches.setLevel === "number" && patches.setLevel > p.level) {
    p.level = patches.setLevel;
  }
  if (typeof patches.customRankTypology === "string" && patches.customRankTypology.trim()) {
    p.customRankTypology = patches.customRankTypology.trim();
  }
  p.rank = computeRankFromLevel(p.level, p.customRankTypology);

  if (patches.attributeDeltas && typeof patches.attributeDeltas === "object") {
    for (const [k, v] of Object.entries(patches.attributeDeltas)) {
      if (typeof v === "number") {
        p.attributes[k] = Math.max(1, (p.attributes[k] || 10) + v);
      }
    }
  }

  if (Array.isArray(patches.currenciesUpdates)) {
    for (const cu of patches.currenciesUpdates) {
      if (!cu || !cu.name) continue;
      const cid = cu.id || cu.name.toLowerCase().replace(/\s+/g, "_");
      const existing = p.currencies.find((c) => c.id === cid || c.name.toLowerCase() === cu.name.toLowerCase());
      if (existing) {
        if (typeof cu.setAmount === "number") existing.amount = Math.max(0, cu.setAmount);
        else if (typeof cu.delta === "number") existing.amount = Math.max(0, existing.amount + cu.delta);
      } else {
        const initAmt = typeof cu.setAmount === "number" ? cu.setAmount : Math.max(0, cu.delta || 0);
        p.currencies.push({ id: cid, name: cu.name, amount: initAmt });
      }
    }
  }

  if (Array.isArray(patches.bodyModifications)) {
    for (const mod of patches.bodyModifications) {
      if (mod && !p.bodyModifications.includes(mod)) p.bodyModifications.push(mod);
    }
  }
  if (Array.isArray(patches.titlesAdded)) {
    for (const t of patches.titlesAdded) {
      if (t && !p.titles.includes(t)) p.titles.push(t);
    }
  }
  if (typeof patches.armor === "number") p.armor = Math.max(0, Math.round(patches.armor));
  if (Array.isArray(patches.injuryUpdates)) {
    for (const inj of patches.injuryUpdates) {
      if (!inj || typeof inj.region !== "string" || !inj.region.trim()) continue;
      const sev = clamp(Math.round(Number(inj.severity) || 0), 0, 100);
      if (sev === 0) delete p.injuries[inj.region];
      else p.injuries[inj.region] = { severity: sev, effect: String(inj.effect || "") };
    }
  }
  if (patches.magicSystemPatch && typeof patches.magicSystemPatch === "object") {
    core.magicSystem = { ...(core.magicSystem || {}), ...patches.magicSystemPatch };
  }

  if (Array.isArray(patches.statusEffects)) {
    p.statusEffects = patches.statusEffects;
  }

  if (patches.patronDeityPatch && typeof patches.patronDeityPatch === "object") {
    core.patronDeity = { ...core.patronDeity, ...patches.patronDeityPatch };
  }

  if (patches.manaConsciousnessPatch && typeof patches.manaConsciousnessPatch === "object") {
    const mc = core.manaConsciousness;
    const patch = patches.manaConsciousnessPatch;
    if (patch.unlocked === true && !mc.unlocked) {
      mc.unlocked = true;
      mc.awakenedAtLevel = p.level;
    }
    if (patch.name) mc.name = patch.name;
    if (patch.personality) mc.personality = patch.personality;
    if (typeof patch.syncDelta === "number") mc.sync = clamp(mc.sync + patch.syncDelta, 0, 100);
    if (patch.remark) {
      mc.lastRemarks = [patch.remark, ...mc.lastRemarks].slice(0, 6);
    }
  }

  if (Array.isArray(patches.skillUpdates)) {
    for (const su of patches.skillUpdates) {
      upsertByKey(core.skills, su, "id");
    }
  }

  if (Array.isArray(patches.projectUpdates)) {
    for (const pr of patches.projectUpdates) {
      if (pr?.remove && (pr.id || pr.name)) {
        core.projects = core.projects.filter(
          (x) => x.id !== pr.id && x.name !== pr.name
        );
      } else {
        upsertByKey(core.projects, pr, "id");
      }
    }
  }

  if (Array.isArray(patches.golemUpdates)) {
    for (const g of patches.golemUpdates) {
      const exists = core.golems.items.some((x) => x.id === g.id || x.name === g.name || x.name === g.renameFrom);
      if (exists || core.golems.items.length < core.golems.maxSlots) {
        upsertByKey(core.golems.items, g, "id");
      }
    }
  }

  if (patches.spatialPocketPatch && typeof patches.spatialPocketPatch === "object") {
    core.spatialPocket = { ...core.spatialPocket, ...patches.spatialPocketPatch };
  }

  if (patches.petPatch && typeof patches.petPatch === "object") {
    core.pet = { ...core.pet, ...patches.petPatch };
  }

  if (Array.isArray(patches.keyItemUpdates)) {
    for (const ki of patches.keyItemUpdates) {
      if (ki?.remove && (ki.id || ki.name)) {
        core.keyItems = core.keyItems.filter((x) => x.id !== ki.id && x.name !== ki.name);
      } else {
        upsertByKey(core.keyItems, ki, "id");
      }
    }
  }

  if (Array.isArray(patches.itemsAdded)) {
    for (const item of patches.itemsAdded) {
      if (item) core.inventory.push(item);
    }
  }
  if (Array.isArray(patches.itemsRemoved)) {
    core.inventory = core.inventory.filter((it) => !patches.itemsRemoved.includes(it));
  }

  if (Array.isArray(patches.nearbyActors)) {
    core.nearbyActors = patches.nearbyActors.slice(0, 14);
  }

  if (Array.isArray(patches.questUpdates)) {
    for (const q of patches.questUpdates) {
      if (!q || !q.title) continue;
      const qId = q.id || q.title.toLowerCase().replace(/\s+/g, "_");
      if (q.status === "completed") {
        core.quests.active = core.quests.active.filter((x) => x.id !== qId && x.title !== q.title);
        upsertByKey(core.quests.completed, { ...q, id: qId }, "id");
      } else {
        upsertByKey(core.quests.active, { ...q, id: qId }, "id");
      }
    }
  }

  if (patches.compendiumUpdates && typeof patches.compendiumUpdates === "object") {
    const cu = patches.compendiumUpdates;
    if (Array.isArray(cu.npcs)) cu.npcs.forEach((n) => upsertByKey(compendium.npcs, n, "id"));
    if (Array.isArray(cu.bestiary)) cu.bestiary.forEach((b) => upsertByKey(compendium.bestiary, b, "id"));
    if (Array.isArray(cu.concepts)) cu.concepts.forEach((c) => upsertByKey(compendium.concepts, c, "id"));
  }

  if (patches.newSphere && patches.newSphere.id) {
    const s = patches.newSphere;
    spheres[s.id] = {
      order: Object.keys(spheres).length + 1,
      canReturn: true,
      nodes: [],
      ...s
    };
  }

  if (patches.sphereUpdate && typeof patches.sphereUpdate === "object") {
    const targetId = patches.sphereUpdate.id || core.meta.activeSphereId;
    if (spheres[targetId]) {
      spheres[targetId] = { ...spheres[targetId], ...patches.sphereUpdate, nodes: spheres[targetId].nodes };
    }
  }

  if (Array.isArray(patches.mapUpdates)) {
    for (const node of patches.mapUpdates) {
      const sId = node.sphereId || core.meta.activeSphereId;
      const sphere = spheres[sId];
      if (!sphere) continue;
      upsertByKey(sphere.nodes, { discovered: true, connectedTo: [], ...node }, "id");
    }
  }

  if (patches.activeSphereId && spheres[patches.activeSphereId]) {
    core.meta.activeSphereId = patches.activeSphereId;
  }
  if (patches.activeNodeId) {
    core.meta.activeNodeId = patches.activeNodeId;
  }
}

export function shouldRotateChapter(game) {
  return (
    game.core.meta.phase === "active_game" &&
    game.activeChapter.turnCount >= CHAPTER_MAX_TURNS
  );
}

export async function rotateChapter(game, summaryText, nextTitle = "") {
  const closed = {
    ...game.activeChapter,
    summary: summaryText || game.activeChapter.summary || "Capítulo concluído.",
    isClosed: true
  };
  await saveChapterLocal(closed);

  const idxEntry = game.chaptersIndex.find((c) => c.chapterId === closed.chapterId);
  if (idxEntry) {
    idxEntry.summary = closed.summary;
    idxEntry.turnCount = closed.turnCount;
    idxEntry.isClosed = true;
    idxEntry.title = closed.title;
  }

  const nextNum = game.core.meta.activeChapterNumber + 1;
  const nextId = `chapter_${String(nextNum).padStart(3, "0")}`;
  const nextChapter = {
    chapterId: nextId,
    chapterNumber: nextNum,
    title: nextTitle || `Capítulo ${nextNum}`,
    summary: "",
    turns: [],
    turnCount: 0,
    isClosed: false
  };

  game.core.meta.activeChapterId = nextId;
  game.core.meta.activeChapterNumber = nextNum;
  game.chaptersIndex.push({
    chapterId: nextId,
    chapterNumber: nextNum,
    title: nextChapter.title,
    summary: "",
    turnCount: 0,
    isClosed: false
  });
  game.activeChapter = nextChapter;
  await persistGameDataLocal(game);
  return closed;
}

// Modo Teste: pula o prólogo e larga o jogador numa masmorra com um NPC. Não sincroniza com a nuvem.
export function createTestGameData() {
  const game = createInitialGameData();
  const { core } = game;
  core.meta.phase = "active_game";
  core.meta.isTest = true;
  core.player.name = "Engenheiro (Teste)";
  core.player.armor = 3;
  core.player.statusEffects = ["Zonzo (acordou de uma queda)"];
  core.patronDeity = { name: "Deusa Velada", domain: "Gelo e Preservação", disposition: "Curiosa", bond: 10, notes: "Perfil de teste." };
  core.magicSystem = {
    source: "Mana é calor latente do ambiente que a alma consegue mover.",
    laws: [
      "Congelar exige retirar calor: o calor sai por algum lugar (mãos, ar, alvo).",
      "Quanto mais longe e mais rápido, mais mana e menos precisão.",
      "Mana usada além do limite queima os canais do corpo."
    ],
    costs: "Mana proporcional à massa e à distância; estamina para precisão fina.",
    limits: "Sobrecarga causa queimadura de canal e tontura.",
    schools: ["Criocinese", "Construção com mana"]
  };
  core.skills = [
    {
      id: "skill_cryo_seed",
      name: "Semente Criogênica",
      tier: "F",
      level: 1,
      currentScope: "Congelar superfícies ao toque e lançar estilhaços de gelo a curta distância.",
      hardLimits: "Até ~3 m; estilhaços do tamanho de pregos; 5 mana por uso.",
      evolutionNorth: ["Lança de Gelo", "Estase de Objetos"],
      devLog: []
    }
  ];
  core.quests.active = [
    { id: "q_test", title: "Sair da Masmorra Rachada", description: "Encontre a saída antes que a coisa nas profundezas acorde.", status: "active" }
  ];
  core.nearbyActors = ["Kaelen"];
  game.compendium.npcs = [
    {
      id: "npc_kaelen",
      name: "Kaelen",
      personality: "Mercenária cínica, sobrevivente, fala pouco e cobra tudo.",
      relationship: "Desconfiada — acabou de te encontrar caído.",
      appearance: "Mulher de cabelo curto grisalho, armadura de couro remendada, besta pesada nas costas, cicatriz no queixo."
    }
  ];
  const sphere = game.spheres[core.meta.activeSphereId];
  sphere.name = "Esfera de Teste";
  sphere.lawsSummary = "Mundo de teste para playtest de combate.";
  sphere.nodes = [
    {
      id: "node_001",
      name: "Masmorra Rachada — 1º Nível",
      region: "Profundezas",
      lat: 10,
      lon: 20,
      terrain: "ruin",
      asciiGlyph: "▼",
      dangerRank: "E",
      discovered: true,
      summary: "Corredores de pedra úmida, ossos antigos e marcas de garras no teto.",
      portalToSphereId: null,
      connectedTo: []
    }
  ];
  game.chaptersIndex[0].title = "Teste: A Masmorra Rachada";
  game.chaptersIndex[0].turnCount = 1;
  game.core.meta.totalTurns = 1;
  game.activeChapter.title = "Teste: A Masmorra Rachada";
  game.activeChapter.turns = [
    {
      turn: 1,
      mode: "narrative",
      user: "",
      voice: { gender: "F", pitch: "-1st", rate: "0.97" },
      narrative:
        "Você desperta com a têmpora latejando sobre lajes úmidas da Masmorra Rachada. Uma bruma fria escorre pelas frestas do teto cobertas por marcas fundas de garras, enquanto uma camada fina de geada estala sob os dedos da sua mão direita.\n\nA poucos passos, encostada num pilar quebrado, Kaelen aponta uma besta pesada para o seu peito. Os olhos cinzentos dela medem sua respiração antes de murmurar:\n— Se vai congelar alguma coisa, garoto, aponte para o corredor escuro atrás de você. Tem algo arrastando garras lá dentro."
    }
  ];
  game.activeChapter.turnCount = 1;
  return game;
}
