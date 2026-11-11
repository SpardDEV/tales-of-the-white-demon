import {
  applyStatePatches,
  clearAllLocal,
  createInitialGameData,
  loadGameDataLocal,
  loadSettings,
  persistGameDataLocal,
  rotateChapter,
  saveSettings,
  shouldRotateChapter
} from "./state.js";
import { buildChapterSummaryPrompt, buildContextPayload, buildSystemPrompt } from "./prompts.js";
import { callGemini } from "./gemini.js";
import { isSupabaseConfigured, pullGameFromSupabase, syncTurnToSupabase } from "./supabase.js";
import { SphereGlobe } from "./globe.js";
import { buildChatGptPrompt, compressImageToWebP9x16 } from "./media.js";
import { DEFAULT_ART_STYLE } from "./config.js";
import {
  renderChatLog,
  renderCompendium,
  renderHeaderAndQuotas,
  renderMapNodeCard,
  renderNegotiationBox,
  renderPrologueBanner,
  renderQuests,
  renderSheet,
  renderSphereSelector
} from "./ui.js";

let settings = loadSettings();
let game = createInitialGameData();
let globe = null;
let viewingSphereId = null;
let activeCompSubtab = "npcs";
let isSending = false;
let transientMessages = [];

function setSyncBadge(text, cls = "badge-muted") {
  const b = document.getElementById("sync-badge");
  if (!b) return;
  b.textContent = text;
  b.className = `badge ${cls}`;
}

function findEntity(type, id) {
  if (type === "player") return game.core.player;
  if (type === "pet") return game.core.pet;
  if (type === "golem") {
    return game.core.golems.items.find((g) => (g.id || g.name) === id);
  }
  const list = game.compendium[type];
  if (Array.isArray(list)) {
    return list.find((item) => (item.id || item.name) === id);
  }
  return null;
}

const mediaHandlers = {
  onGeneratePrompt: async (type, id) => {
    const entity = findEntity(type, id);
    if (!entity) return;
    const promptText = buildChatGptPrompt(type, entity, settings.artStylePrompt);
    document.getElementById("prompt-modal-text").value = promptText;
    document.getElementById("prompt-modal").classList.remove("hidden");
    try {
      await navigator.clipboard.writeText(promptText);
    } catch {
      // Clipboard pode ser bloqueado em WebView; o modal já deixa pronto para copiar
    }
  },
  onUploadImage: async (type, id, file) => {
    try {
      const entity = findEntity(type, id);
      if (!entity) return;
      const webpDataUrl = await compressImageToWebP9x16(file);
      entity.imageWebp = webpDataUrl;
      await persistGameDataLocal(game);
      refreshAllViews();
      await syncIfConfigured(false);
    } catch (err) {
      alert(`Falha ao processar imagem: ${err.message}`);
    }
  }
};

function parseCommand(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/pray")) {
    return { mode: "pray", text: trimmed.slice(5).trim() || "(Oração silenciosa à Deusa Patrona)" };
  }
  if (trimmed.startsWith("/world")) {
    return { mode: "world", text: trimmed.slice(6).trim() || "(Observar leis atuais do mundo)" };
  }
  if (trimmed.startsWith("/system")) {
    return { mode: "system", text: trimmed.slice(7).trim() || "Exibir status completo e parecer do Sistema.", openSheet: true };
  }
  if (trimmed.startsWith("/mana")) {
    return { mode: "mana", text: trimmed.slice(5).trim() || "(Tentar sentir ou conversar com a Consciência da Mana)" };
  }
  return { mode: "narrative", text: trimmed };
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabName}`);
  });

  if (tabName === "sheet") renderSheet(game, mediaHandlers);
  if (tabName === "quests") renderQuests(game);
  if (tabName === "compendium") {
    const q = document.getElementById("compendium-search").value;
    renderCompendium(game, settings, activeCompSubtab, q, mediaHandlers);
  }
  if (tabName === "map" && globe) {
    viewingSphereId = viewingSphereId || game.core.meta.activeSphereId;
    renderSphereSelector(game, viewingSphereId);
    requestAnimationFrame(() => {
      globe.setSphere(game.spheres[viewingSphereId], game.core.meta.activeNodeId);
      globe.centerOnActive();
    });
    const curNode = game.spheres[viewingSphereId]?.nodes?.find(
      (n) => n.id === game.core.meta.activeNodeId
    );
    renderMapNodeCard(game, viewingSphereId, curNode, travelToSphere);
  }
}

function refreshAllViews() {
  renderHeaderAndQuotas(game, settings);
  renderPrologueBanner(game);
  renderChatLog(game, transientMessages);
  renderNegotiationBox(game);
  renderSheet(game, mediaHandlers);
  renderQuests(game);
  renderCompendium(
    game,
    settings,
    activeCompSubtab,
    document.getElementById("compendium-search")?.value || "",
    mediaHandlers
  );
  renderSphereSelector(game, viewingSphereId || game.core.meta.activeSphereId);
  if (globe && game.spheres[viewingSphereId || game.core.meta.activeSphereId]) {
    globe.setSphere(
      game.spheres[viewingSphereId || game.core.meta.activeSphereId],
      game.core.meta.activeNodeId
    );
  }
}

async function syncIfConfigured(fullSync = false) {
  if (!isSupabaseConfigured(settings)) {
    setSyncBadge("Local", "badge-muted");
    return;
  }
  try {
    setSyncBadge("Sync...", "badge-warn");
    await syncTurnToSupabase(settings, game, { fullSync });
    setSyncBadge("Nuvem OK", "badge-ok");
  } catch (err) {
    console.warn(err);
    setSyncBadge("Sync erro", "badge-warn");
  }
}

async function handleChapterRotationIfNeeded() {
  if (!shouldRotateChapter(game)) return;
  try {
    const { systemPrompt, userPrompt } = buildChapterSummaryPrompt(game.activeChapter);
    const { parsed } = await callGemini({
      apiKey: settings.geminiKey,
      model: settings.geminiModel,
      systemPrompt,
      userMessage: userPrompt,
      contextPayload: null,
      usage: game.usage
    });
    const closed = await rotateChapter(
      game,
      parsed.summary,
      parsed.title || `Capítulo ${game.activeChapter.chapterNumber}`
    );
    transientMessages.push({
      mode: "system",
      text: `☰ Capítulo ${closed.chapterNumber} arquivado na memória longa ("${closed.title}"). Novo capítulo iniciado!`
    });
  } catch (err) {
    console.warn("Falha ao fechar capítulo automaticamente:", err);
  }
}

async function sendTurn(rawInput, negotiationAction = null) {
  if (isSending) return;
  const cmd = parseCommand(rawInput);
  if (!cmd.text && !negotiationAction) return;

  isSending = true;
  transientMessages = [];
  const btn = document.getElementById("btn-send");
  btn.disabled = true;
  btn.textContent = "...";

  try {
    const systemPrompt = buildSystemPrompt(game, cmd.mode, negotiationAction);
    const contextPayload = buildContextPayload(game, cmd.text);

    const { parsed } = await callGemini({
      apiKey: settings.geminiKey,
      model: settings.geminiModel,
      systemPrompt,
      userMessage: rawInput,
      contextPayload,
      usage: game.usage
    });

    const prevPhase = game.core.meta.phase;
    if (prevPhase === "prologue_world" && parsed.questionAsked) {
      game.core.meta.prologueQuestionCount += 1;
    }
    if (prevPhase === "prologue_deity" && parsed.questionAsked) {
      game.core.meta.deityQuestionCount += 1;
    }

    if (parsed.nextPhase && parsed.nextPhase !== prevPhase) {
      game.core.meta.phase = parsed.nextPhase;
      if (parsed.nextPhase === "active_game" && game.activeChapter.chapterNumber === 1) {
        game.activeChapter.title = "Capítulo 1: O Despertar Criogênico";
      }
    }

    if (parsed.statePatches) {
      applyStatePatches(game, parsed.statePatches);
    }

    if (parsed.chapterMeta?.suggestedTitle && !game.activeChapter.isClosed) {
      game.activeChapter.title = parsed.chapterMeta.suggestedTitle;
      const idx = game.chaptersIndex.find((c) => c.chapterId === game.activeChapter.chapterId);
      if (idx) idx.title = parsed.chapterMeta.suggestedTitle;
    }

    if (parsed.negotiation?.active) {
      game.core.pendingNegotiation = parsed.negotiation;
    } else if (
      negotiationAction ||
      ["approved", "forced_with_cost", "scolded_blocked", "none"].includes(parsed.negotiation?.status)
    ) {
      game.core.pendingNegotiation = null;
    }

    game.core.meta.totalTurns += 1;
    game.activeChapter.turns.push({
      turn: game.core.meta.totalTurns,
      mode: parsed.mode || cmd.mode,
      user: rawInput === "__START_PROLOGUE__" ? "" : rawInput,
      narrative: parsed.narrative || "(Sem resposta narrativa)"
    });
    game.activeChapter.turnCount = game.activeChapter.turns.length;

    await handleChapterRotationIfNeeded();
    await persistGameDataLocal(game);
    refreshAllViews();
    await syncIfConfigured(false);
  } catch (err) {
    transientMessages.push({ mode: "error", text: err.message });
    renderChatLog(game, transientMessages);
  } finally {
    isSending = false;
    btn.disabled = false;
    btn.textContent = "Enviar";
  }
}

async function travelToSphere(targetSphereId) {
  if (!game.spheres[targetSphereId]) return;
  const target = game.spheres[targetSphereId];
  const firstNode = target.nodes?.[0];
  game.core.meta.activeSphereId = targetSphereId;
  if (firstNode) game.core.meta.activeNodeId = firstNode.id;
  await persistGameDataLocal(game);
  refreshAllViews();
  switchTab("chat");
  await sendTurn(`/world O protagonista atravessou para a esfera "${target.name}". Descreva a chegada e as condições atuais desta esfera.`);
}

function openSettingsModal() {
  document.getElementById("cfg-gemini-key").value = settings.geminiKey || "";
  document.getElementById("cfg-gemini-model").value = settings.geminiModel || "gemini-2.5-flash";
  document.getElementById("cfg-gemini-rpd").value = settings.geminiRpdLimit || 250;
  document.getElementById("cfg-gemini-tpd").value = settings.geminiTpdLimit || 1000000;
  document.getElementById("cfg-sb-url").value = settings.supabaseUrl || "";
  document.getElementById("cfg-sb-key").value = settings.supabaseAnonKey || "";
  document.getElementById("cfg-slot-id").value = settings.slotId || "white-demon-01";
  document.getElementById("cfg-art-style").value = settings.artStylePrompt || DEFAULT_ART_STYLE;
  renderHeaderAndQuotas(game, settings);
  document.getElementById("settings-modal").classList.remove("hidden");
}

function bindUI() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll(".subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".subtab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCompSubtab = btn.dataset.comp;
      renderCompendium(
        game,
        settings,
        activeCompSubtab,
        document.getElementById("compendium-search").value,
        mediaHandlers
      );
    });
  });

  document.getElementById("compendium-search").addEventListener("input", (e) => {
    renderCompendium(game, settings, activeCompSubtab, e.target.value, mediaHandlers);
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const inp = document.getElementById("chat-input");
      const cmd = chip.dataset.cmd;
      if (cmd.trim() === "/system" && !inp.value.trim()) {
        switchTab("sheet");
        return;
      }
      inp.value = cmd + inp.value.replace(/^\/(pray|world|system|mana)\s*/i, "");
      inp.focus();
    });
  });

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = document.getElementById("chat-input");
    const val = inp.value.trim();
    if (!val) return;
    inp.value = "";
    await sendTurn(val);
  });

  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chat-form").requestSubmit();
    }
  });

  // Negociação / Teimosia
  document.getElementById("btn-neg-accept").addEventListener("click", () => {
    sendTurn("Aceito o meio-termo proposto pelo Sistema. Aplique na minha ficha.", "accept_counter");
  });
  document.getElementById("btn-neg-force").addEventListener("click", () => {
    sendTurn("Recuso recuar — vou FORÇAR a técnica usando minha lógica de engenharia e mana mesmo que custe caro!", "force_action");
  });
  document.getElementById("btn-neg-cancel").addEventListener("click", () => {
    game.core.pendingNegotiation = null;
    persistGameDataLocal(game);
    renderNegotiationBox(game);
  });

  // Mapa
  document.getElementById("btn-zoom-in").addEventListener("click", () => globe?.zoomBy(1.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => globe?.zoomBy(0.83));
  document.getElementById("btn-globe-reset").addEventListener("click", () => globe?.centerOnActive());
  document.getElementById("sphere-select").addEventListener("change", (e) => {
    viewingSphereId = e.target.value;
    globe?.setSphere(game.spheres[viewingSphereId], game.core.meta.activeNodeId);
    globe?.centerOnActive();
    renderMapNodeCard(game, viewingSphereId, null, travelToSphere);
  });

  // Prompt Modal
  document.getElementById("btn-close-prompt").addEventListener("click", () => {
    document.getElementById("prompt-modal").classList.add("hidden");
  });
  document.getElementById("btn-copy-prompt").addEventListener("click", async () => {
    const txt = document.getElementById("prompt-modal-text").value;
    try {
      await navigator.clipboard.writeText(txt);
      document.getElementById("btn-copy-prompt").textContent = "✓ Copiado!";
      setTimeout(() => {
        document.getElementById("btn-copy-prompt").textContent = "◈ Copiar Prompt";
      }, 1500);
    } catch {
      document.getElementById("prompt-modal-text").select();
    }
  });

  // Modal Settings
  document.getElementById("btn-open-settings").addEventListener("click", openSettingsModal);
  document.getElementById("quota-strip").addEventListener("click", openSettingsModal);
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    settings = {
      ...settings,
      geminiKey: document.getElementById("cfg-gemini-key").value.trim(),
      geminiModel: document.getElementById("cfg-gemini-model").value,
      geminiRpdLimit: Number(document.getElementById("cfg-gemini-rpd").value) || 250,
      geminiTpdLimit: Number(document.getElementById("cfg-gemini-tpd").value) || 1000000,
      supabaseUrl: document.getElementById("cfg-sb-url").value.trim(),
      supabaseAnonKey: document.getElementById("cfg-sb-key").value.trim(),
      slotId: document.getElementById("cfg-slot-id").value.trim() || "white-demon-01",
      artStylePrompt: document.getElementById("cfg-art-style").value.trim() || DEFAULT_ART_STYLE
    };
    saveSettings(settings);
    document.getElementById("settings-modal").classList.add("hidden");
    renderHeaderAndQuotas(game, settings);
    setSyncBadge(isSupabaseConfigured(settings) ? "Pronto" : "Local", "badge-muted");

    if (
      settings.geminiKey &&
      game.core.meta.phase === "prologue_world" &&
      game.activeChapter.turns.length === 0
    ) {
      await sendTurn("__START_PROLOGUE__");
    }
  });

  document.getElementById("btn-sb-push").addEventListener("click", async () => {
    try {
      setSyncBadge("Enviando...", "badge-warn");
      await syncTurnToSupabase(settings, game, { fullSync: true });
      setSyncBadge("Nuvem OK", "badge-ok");
      renderHeaderAndQuotas(game, settings);
      alert("Campanha completa enviada para o Supabase!");
    } catch (err) {
      setSyncBadge("Sync erro", "badge-warn");
      alert(err.message);
    }
  });

  document.getElementById("btn-sb-pull").addEventListener("click", async () => {
    try {
      setSyncBadge("Baixando...", "badge-warn");
      const pulled = await pullGameFromSupabase(settings, game.usage);
      game = pulled;
      viewingSphereId = game.core.meta.activeSphereId;
      await persistGameDataLocal(game);
      refreshAllViews();
      setSyncBadge("Nuvem OK", "badge-ok");
      alert("Save carregado do Supabase com sucesso!");
    } catch (err) {
      setSyncBadge("Sync erro", "badge-warn");
      alert(err.message);
    }
  });

  document.getElementById("btn-export-save").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `white-demon-cap-${game.core.meta.activeChapterNumber}.json`;
    a.click();
  });

  document.getElementById("input-import-save").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.core || !parsed.activeChapter) throw new Error("Arquivo de save inválido.");
      game = parsed;
      viewingSphereId = game.core.meta.activeSphereId;
      await persistGameDataLocal(game);
      refreshAllViews();
      alert("Save importado com sucesso!");
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("btn-new-game").addEventListener("click", async () => {
    if (!confirm("Isso apagará o progresso local atual e iniciará uma nova jornada do Prólogo. Continuar?")) {
      return;
    }
    await clearAllLocal();
    game = createInitialGameData();
    viewingSphereId = game.core.meta.activeSphereId;
    transientMessages = [];
    await persistGameDataLocal(game);
    refreshAllViews();
    document.getElementById("settings-modal").classList.add("hidden");
    if (settings.geminiKey) {
      await sendTurn("__START_PROLOGUE__");
    }
  });
}

async function init() {
  // Liga todos os botões imediatamente antes de qualquer operação assíncrona
  bindUI();
  refreshAllViews();

  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => null);
    }

    game = await loadGameDataLocal();
    viewingSphereId = game.core.meta.activeSphereId;

    globe = new SphereGlobe(document.getElementById("globe-canvas"), (node) => {
      renderMapNodeCard(game, viewingSphereId, node, travelToSphere);
    });

    refreshAllViews();
    setSyncBadge(isSupabaseConfigured(settings) ? "Pronto" : "Local", "badge-muted");

    if (
      settings.geminiKey &&
      game.core.meta.phase === "prologue_world" &&
      game.activeChapter.turns.length === 0
    ) {
      await sendTurn("__START_PROLOGUE__");
    }
  } catch (err) {
    transientMessages.push({
      mode: "error",
      text: `Erro ao inicializar armazenamento local: ${err.message}. O jogo continuará em modo de memória.`
    });
    renderChatLog(game, transientMessages);
  }
}

init();
