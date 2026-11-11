import {
  applyStatePatches,
  clearAllLocal,
  createInitialGameData,
  loadGameDataLocal,
  loadSettings,
  persistGameDataLocal,
  popUndoSnapshot,
  pushUndoSnapshot,
  rotateChapter,
  saveChapterLocal,
  saveMediaLocal,
  saveSettings,
  shouldRotateChapter,
  todayKey
} from "./state.js";
import { buildChapterSummaryPrompt, buildClassifierPrompt, buildContextPayload, buildSystemPrompt, buildWebtoonPrompt } from "./prompts.js";
import { enforceTurnRules } from "./rules.js";
import { callGemini } from "./gemini.js";
import { isSupabaseConfigured, pullGameFromSupabase, pushChapterToSupabase, syncTurnToSupabase, signInSupabase, signOutSupabase, supabaseUserEmail } from "./supabase.js";
import { SphereGlobe } from "./globe.js";
import { buildChatGptPrompt, compressImageToWebP9x16 } from "./media.js";
import { DEFAULT_ART_STYLE, estimateCostUsd } from "./config.js";
import { applyFx, initSensory, isMuted, playMusic, setBiome, setMuted, startQte, updateStatusFx } from "./sensory.js";
import {
  renderChatLog,
  renderCompendium,
  renderHeaderAndQuotas,
  renderMapNodeCard,
  renderNegotiationBox,
  renderPrologueBanner,
  renderQuests,
  renderSheet,
  renderSphereSelector,
  renderWebtoonStudio
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
  if (type === "golem") return game.core.golems.items.find((g) => (g.id || g.name) === id);
  if (type === "keyItem") return game.core.keyItems.find((k) => (k.id || k.name) === id);
  const list = game.compendium[type];
  if (Array.isArray(list)) return list.find((item) => (item.id || item.name) === id);
  return null;
}

async function openPromptModal(promptText) {
  document.getElementById("prompt-modal-text").value = promptText;
  document.getElementById("prompt-modal").classList.remove("hidden");
  try {
    await navigator.clipboard.writeText(promptText);
  } catch {
    // Modal permite copiar manualmente em WebViews restritas
  }
}

async function attachMediaToId(mediaId, file) {
  const webpDataUrl = await compressImageToWebP9x16(file);
  const saved = await saveMediaLocal(mediaId, webpDataUrl);
  game.mediaCache[mediaId] = saved;
  game.usage.dirtyMediaIds = Array.from(new Set([...(game.usage.dirtyMediaIds || []), mediaId]));
  return mediaId;
}

const uiHandlers = {
  onShowPromptText: (text) => openPromptModal(text),
  onGeneratePrompt: async (type, id) => {
    const entity = findEntity(type, id);
    if (!entity) return;
    await openPromptModal(buildChatGptPrompt(type, entity, settings.artStylePrompt));
  },
  onUploadImage: async (type, id, file) => {
    try {
      const entity = findEntity(type, id);
      if (!entity) return;
      const mediaId = entity.mediaId || `media_${type}_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      await attachMediaToId(mediaId, file);
      entity.mediaId = mediaId;
      delete entity.imageWebp;
      await persistGameDataLocal(game);
      refreshAllViews();
      await syncIfConfigured(false);
    } catch (err) {
      alert(`Falha ao processar imagem: ${err.message}`);
    }
  },
  onUploadSceneImage: async (turnIdx, file) => {
    try {
      const turn = game.activeChapter.turns[turnIdx];
      if (!turn) return;
      const mediaId = turn.sceneMediaId || `scene_${game.activeChapter.chapterId}_t${turn.turn || turnIdx}`;
      await attachMediaToId(mediaId, file);
      turn.sceneMediaId = mediaId;
      await persistGameDataLocal(game);
      refreshAllViews();
      await syncIfConfigured(false);
    } catch (err) {
      alert(`Falha ao processar cena: ${err.message}`);
    }
  },
  // Fase 5.6: gera os prompts de página uma vez e guarda no capítulo (imagens só sob demanda).
  onGenerateWebtoon: async (chapter) => {
    const cast = [
      { id: "player", name: game.core.player.name },
      ...game.compendium.npcs.map((n) => ({ id: n.id || n.name, name: n.name || n.id }))
    ];
    const { systemPrompt, userMessage } = buildWebtoonPrompt(chapter, cast, settings.artStylePrompt);
    const { parsed } = await callGemini({
      apiKey: settings.geminiKey,
      model: settings.geminiModel,
      systemPrompt,
      userMessage,
      contextPayload: null,
      usage: game.usage,
      temperature: 0.7
    });
    const ids = new Set(cast.map((c) => c.id));
    const pages = (Array.isArray(parsed.pages) ? parsed.pages : [])
      .filter((p) => p && typeof p.prompt === "string" && p.prompt.trim())
      .map((p, i) => ({
        page: i + 1,
        prompt: p.prompt.trim(),
        characters: (Array.isArray(p.characters) ? p.characters : []).filter((id) => ids.has(id))
      }));
    if (!pages.length) throw new Error("A IA não devolveu páginas de Webtoon.");
    chapter.webtoonPrompts = pages;
    await saveChapterLocal(chapter);
    await persistGameDataLocal(game); // grava o uso do Gemini
    await pushChapterToSupabase(settings, chapter, game.usage).catch((err) => console.warn("Webtoon sem sync:", err));
    return pages;
  },
  onSaveWebtoon: async (chapter) => {
    await saveChapterLocal(chapter);
    await pushChapterToSupabase(settings, chapter, game.usage).catch((err) => console.warn("Webtoon sem sync:", err));
  },
  onUploadWebtoonPage: async (chapter, i, file) => {
    try {
      const page = chapter.webtoonPrompts[i];
      page.mediaId = page.mediaId || `wt_${chapter.chapterId}_p${page.page}`;
      await attachMediaToId(page.mediaId, file);
      page.done = true;
      await uiHandlers.onSaveWebtoon(chapter);
      await persistGameDataLocal(game);
      await syncIfConfigured(false); // sobe a imagem pelo sync diferencial de mídia
    } catch (err) {
      alert(`Falha ao enviar página: ${err.message}`);
    }
  },
  onFocusChat: async (focusTarget, text) => {
    switchTab("chat");
    const prefix = focusTarget.kind === "mana_skill" ? "/mana " : "";
    await sendTurn(`${prefix}[${focusTarget.name}] ${text}`, null, focusTarget);
  }
};

// ============================================================================
// Mention Autocomplete (@, #, $, &)
// ============================================================================
function getMentionSuggestions(symbol, query = "") {
  const q = query.toLowerCase();
  let raw = [];

  if (symbol === "@") {
    const actors = new Set([
      ...(game.core.nearbyActors || []),
      ...game.core.golems.items.map((g) => g.name),
      ...(game.core.pet?.unlocked && game.core.pet.name ? [game.core.pet.name] : []),
      ...game.compendium.npcs.slice(-10).map((n) => n.name)
    ]);
    raw = Array.from(actors).filter(Boolean);
  } else if (symbol === "#") {
    const items = new Set([
      ...game.core.keyItems.map((k) => k.name),
      ...game.core.inventory
    ]);
    raw = Array.from(items).filter(Boolean);
  } else if (symbol === "$") {
    raw = (game.core.player.currencies || []).map((c) => `${c.name}(${c.amount})`);
  } else if (symbol === "&") {
    const sp = game.spheres[game.core.meta.activeSphereId];
    raw = (sp?.nodes || []).filter((n) => n.discovered !== false).map((n) => n.name);
  }

  return raw
    .filter((label) => !q || label.toLowerCase().includes(q))
    .slice(0, 10)
    .map((label) => ({
      label,
      token: `${symbol}${label.replace(/\([^)]*\)/g, "").trim().replace(/\s+/g, "_")}`
    }));
}

function updateMentionPopover(forceSymbol = null) {
  const pop = document.getElementById("mention-popover");
  const inp = document.getElementById("chat-input");
  const cursor = inp.selectionStart ?? inp.value.length;
  const before = inp.value.slice(0, cursor);
  const match = forceSymbol
    ? [null, forceSymbol, ""]
    : before.match(/(?:^|\s)([@#$&])([^\s]*)$/);

  if (!match) {
    pop.classList.add("hidden");
    return;
  }

  const symbol = match[1];
  const query = match[2] || "";
  const items = getMentionSuggestions(symbol, query);

  if (!items.length) {
    pop.innerHTML = `<span class="muted" style="font-size:0.75rem;">Nenhum registro para ${symbol} ainda.</span>`;
  } else {
    pop.innerHTML = items
      .map((it) => `<button type="button" class="mention-item" data-token="${it.token.replace(/"/g, "&quot;")}">${it.symbol || ""}${it.label}</button>`)
      .join("");
    pop.querySelectorAll(".mention-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tok = btn.dataset.token + " ";
        if (forceSymbol) {
          inp.value = inp.value + (inp.value && !inp.value.endsWith(" ") ? " " : "") + tok;
        } else {
          const prefixStart = before.lastIndexOf(symbol);
          inp.value = inp.value.slice(0, prefixStart) + tok + inp.value.slice(cursor);
        }
        pop.classList.add("hidden");
        inp.focus();
      });
    });
  }
  pop.classList.remove("hidden");
}

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

  if (tabName === "sheet") renderSheet(game, uiHandlers);
  if (tabName === "quests") renderQuests(game);
  if (tabName === "compendium") {
    const q = document.getElementById("compendium-search").value;
    renderCompendium(game, settings, activeCompSubtab, q, uiHandlers);
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
  updateStatusFx(game.core.player);
  setBiome(game.core.meta.ambient?.bioma);
  playMusic(game.core.meta.ambient?.musica);
  renderPrologueBanner(game);
  renderChatLog(game, transientMessages, uiHandlers);
  renderNegotiationBox(game);
  renderSheet(game, uiHandlers);
  renderQuests(game);
  renderCompendium(
    game,
    settings,
    activeCompSubtab,
    document.getElementById("compendium-search")?.value || "",
    uiHandlers
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

async function sendTurn(rawInput, negotiationAction = null, focusTarget = null) {
  if (isSending) return false;
  const cmd = parseCommand(rawInput);
  if (!cmd.text && !negotiationAction) return false;

  isSending = true;
  transientMessages = [];
  const btn = document.getElementById("btn-send");
  btn.disabled = true;
  btn.textContent = "...";

  pushUndoSnapshot(game);

  try {
    const systemPrompt = buildSystemPrompt(game, cmd.mode, negotiationAction, focusTarget);
    const contextPayload = buildContextPayload(game, cmd.text, focusTarget);

    // Cascata: turno comum no modelo barato; épico no modelo caro, se houver orçamento.
    // Épico = marcado pela IA no turno anterior OU pelo classificador barato sobre a ação atual.
    const monthModels = game.usage.monthKey === todayKey().slice(0, 7) ? game.usage.monthModels : {};
    const epicAllowed =
      !!settings.geminiEpicModel &&
      game.core.meta.phase === "active_game" &&
      !negotiationAction &&
      estimateCostUsd(monthModels) < (Number(settings.monthlyBudgetUsd) || 0);
    let epic = epicAllowed && !!game.core.meta.nextEpic;
    let epicBy = "marca do turno anterior";
    if (epicAllowed && !epic && settings.geminiClassifierModel && cmd.mode === "narrative") {
      try {
        const c = buildClassifierPrompt(game, cmd.text);
        const { parsed: cls } = await callGemini({
          apiKey: settings.geminiKey,
          model: settings.geminiClassifierModel,
          systemPrompt: c.systemPrompt,
          userMessage: c.userMessage,
          contextPayload: null,
          usage: game.usage,
          temperature: 0
        });
        epic = cls?.epico === true;
        epicBy = "classificador";
      } catch (err) {
        console.warn("Classificador falhou, turno segue no modelo comum:", err);
      }
    }
    const { parsed, model: usedModel, fellBack } = await callGemini({
      apiKey: settings.geminiKey,
      model: epic ? settings.geminiEpicModel : settings.geminiModel,
      fallbackModel: epic ? settings.geminiModel : null,
      systemPrompt,
      userMessage: rawInput,
      contextPayload,
      usage: game.usage
    });
    game.core.meta.nextEpic = parsed.epico === true;
    if (epic) {
      transientMessages.push({
        mode: "system",
        text: fellBack ? `⚡ Narrador Épico sem cota — turno narrado por ${usedModel}.` : `⚡ Narrador Épico (${usedModel}, por ${epicBy})`
      });
    }

    if (typeof parsed.combatLog === "string" && parsed.combatLog.trim()) {
      transientMessages.push({ mode: "system", text: `⚔ ${parsed.combatLog.trim()}` });
    }

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
      // /world é o modo de mestre do jogador: sem limites por turno
      const cuts = cmd.mode === "world" ? [] : enforceTurnRules(parsed.statePatches, game.core.player);
      if (cuts.length) transientMessages.push({ mode: "system", text: `◈ Árbitro cortou o excesso: ${cuts.join(", ")}` });
      applyStatePatches(game, parsed.statePatches);
    }

    applyFx(parsed);
    const ambient = (game.core.meta.ambient ||= {});
    if (parsed.bioma) ambient.bioma = parsed.bioma;
    if (typeof parsed.musica === "string") ambient.musica = parsed.musica;
    if (parsed.qte_fisico) {
      const kind = parsed.qte_fisico;
      // roda depois do finally (isSending já liberado) e devolve o resultado como próximo turno
      setTimeout(() => startQte(kind, (ok) => sendTurn(`[QTE físico "${kind}": ${ok ? "SUCESSO" : "FALHOU"}]`)), 0);
    }

    // Se veio de um mini-chat de Skill/Projeto e a IA não enviou devLogEntry explícito, registramos automaticamente!
    if (focusTarget) {
      const logItem = {
        user: rawInput.replace(/^\/mana\s*/i, ""),
        reply: parsed.narrative || ""
      };
      if (focusTarget.kind === "project") {
        const pr = game.core.projects.find((p) => (p.id || p.name) === focusTarget.id);
        if (pr) {
          pr.devLog = [...(pr.devLog || []), logItem].slice(-25);
        }
      } else {
        const sk = game.core.skills.find((s) => (s.id || s.name) === focusTarget.id);
        if (sk) {
          sk.devLog = [...(sk.devLog || []), logItem].slice(-25);
        }
      }
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
      narrative: parsed.narrative || "(Sem resposta narrativa)",
      scenePrompt: parsed.scenePrompt || null,
      sceneMediaId: null
    });
    game.activeChapter.turnCount = game.activeChapter.turns.length;

    await handleChapterRotationIfNeeded();
    await persistGameDataLocal(game);
    refreshAllViews();
    await syncIfConfigured(false);
    return true;
  } catch (err) {
    popUndoSnapshot(game);
    transientMessages.push({ mode: "error", text: err.message });
    renderChatLog(game, transientMessages, uiHandlers);
    renderHeaderAndQuotas(game, settings);
    return false;
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
  document.getElementById("cfg-gemini-epic").value = settings.geminiEpicModel ?? "gemini-2.5-pro";
  document.getElementById("cfg-gemini-classifier").value = settings.geminiClassifierModel ?? "gemini-2.5-flash-lite";
  document.getElementById("cfg-budget").value = settings.monthlyBudgetUsd ?? 41;
  document.getElementById("cfg-gemini-rpd").value = settings.geminiRpdLimit || 250;
  document.getElementById("cfg-gemini-tpd").value = settings.geminiTpdLimit || 1000000;
  document.getElementById("cfg-sb-url").value = settings.supabaseUrl || "";
  document.getElementById("cfg-sb-key").value = settings.supabaseAnonKey || "";
  document.getElementById("cfg-slot-id").value = settings.slotId || "white-demon-01";
  renderSbAuth();
  document.getElementById("cfg-art-style").value = settings.artStylePrompt || DEFAULT_ART_STYLE;
  renderHeaderAndQuotas(game, settings);
  document.getElementById("settings-modal").classList.remove("hidden");
}

function renderSbAuth() {
  const email = supabaseUserEmail();
  const el = document.getElementById("sb-auth-status");
  el.textContent = email ? `Conectado: ${email}` : "Desconectado";
  el.className = `badge ${email ? "badge-ok" : "badge-muted"}`;
  if (email) document.getElementById("cfg-sb-email").value = email;
}

function bindUI() {
  document.getElementById("btn-sb-login").addEventListener("click", async () => {
    const sb = {
      ...settings,
      supabaseUrl: document.getElementById("cfg-sb-url").value.trim(),
      supabaseAnonKey: document.getElementById("cfg-sb-key").value.trim()
    };
    const passEl = document.getElementById("cfg-sb-pass");
    try {
      await signInSupabase(sb, document.getElementById("cfg-sb-email").value.trim(), passEl.value);
    } catch (err) {
      alert(err.message);
    }
    passEl.value = "";
    renderSbAuth();
  });

  document.getElementById("btn-sb-logout").addEventListener("click", () => {
    signOutSupabase();
    renderSbAuth();
    setSyncBadge("Local", "badge-muted");
  });

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
        uiHandlers
      );
    });
  });

  document.getElementById("compendium-search").addEventListener("input", (e) => {
    renderCompendium(game, settings, activeCompSubtab, e.target.value, uiHandlers);
  });

  document.querySelectorAll(".chip[data-cmd]").forEach((chip) => {
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

  document.querySelectorAll(".chip-mention").forEach((chip) => {
    chip.addEventListener("click", () => {
      updateMentionPopover(chip.dataset.mention);
    });
  });

  document.getElementById("btn-undo-turn").addEventListener("click", async () => {
    if (isSending) return;
    if (popUndoSnapshot(game)) {
      transientMessages = [{ mode: "system", text: "↶ Último turno desfeito." }];
      await persistGameDataLocal(game);
      refreshAllViews();
      await syncIfConfigured(false);
    }
  });

  const chatInp = document.getElementById("chat-input");
  chatInp.addEventListener("input", () => updateMentionPopover());
  chatInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chat-form").requestSubmit();
    }
  });

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("mention-popover").classList.add("hidden");
    const val = chatInp.value.trim();
    if (!val) return;
    chatInp.value = "";
    const ok = await sendTurn(val);
    if (!ok && !chatInp.value) {
      // Restaura o texto caso falhe rede ou API
      chatInp.value = val;
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
  document.getElementById("btn-open-webtoon").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
    document.getElementById("webtoon-modal").classList.remove("hidden");
    renderWebtoonStudio(game, settings, uiHandlers);
  });
  document.getElementById("btn-close-webtoon").addEventListener("click", () => {
    document.getElementById("webtoon-modal").classList.add("hidden");
  });

  const muteBtn = document.getElementById("btn-mute");
  const paintMute = () => {
    muteBtn.firstElementChild.style.setProperty("--i", `url(assets_curated/icons/${isMuted() ? "ui/invisible" : "items/bullhorn"}.svg)`);
    muteBtn.title = isMuted() ? "Modo Furtivo ligado (sem som)" : "Som ligado — toque para Modo Furtivo";
  };
  paintMute();
  muteBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    settings.muted = isMuted();
    saveSettings(settings);
    paintMute();
  });
  document.getElementById("quota-strip").addEventListener("click", openSettingsModal);
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    settings = {
      ...settings,
      geminiKey: document.getElementById("cfg-gemini-key").value.trim(),
      geminiModel: document.getElementById("cfg-gemini-model").value,
      geminiEpicModel: document.getElementById("cfg-gemini-epic").value,
      geminiClassifierModel: document.getElementById("cfg-gemini-classifier").value,
      monthlyBudgetUsd: Number(document.getElementById("cfg-budget").value) || 0,
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
      const pulled = await pullGameFromSupabase(
        settings,
        game.usage,
        game.mediaCache,
        game.core.meta.lastMediaSyncAt
      );
      game = pulled;
      viewingSphereId = game.core.meta.activeSphereId;
      await persistGameDataLocal(game);
      refreshAllViews();
      setSyncBadge("Nuvem OK", "badge-ok");
      alert("Save carregado do Supabase (com mídias diferenciais)!");
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
  await initSensory(settings.muted);
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
    renderChatLog(game, transientMessages, uiHandlers);
  }
}

init();
