import {
  applyStatePatches,
  clearAllLocal,
  createInitialGameData,
  createTestGameData,
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
import { buildChapterSummaryPrompt, buildClassifierPrompt, buildContextPayload, buildSystemPrompt, buildWebtoonPrompt, extractMentionTokens } from "./prompts.js";
import { enforceTurnRules } from "./rules.js";
import { callGemini, listGeminiModels } from "./gemini.js";
import {
  isSupabaseConfigured,
  pullGameFromSupabase,
  pullUserSettingsFromSupabase,
  pushChapterToSupabase,
  pushUserSettingsToSupabase,
  syncTurnToSupabase,
  signInSupabase,
  signOutSupabase,
  supabaseUserEmail
} from "./supabase.js";
import { SphereGlobe } from "./globe.js";
import { buildChatGptPrompt, compressImageToWebP9x16 } from "./media.js";
import { DEFAULT_ART_STYLE, estimateCostUsd } from "./config.js";
import { speakMessage, stopTts } from "./tts.js";
import {
  indexMemoryInBackground,
  reindexAllMemoryVectors,
  retrieveRelevantMemory,
  searchVectorMemory
} from "./memory.js";
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

function freeGeminiKey() {
  return (settings.geminiKey || settings.geminiPaidKey || "").trim();
}

function paidBudgetAllowed() {
  const month = todayKey().slice(0, 7);
  const paidModels = game.usage.monthKey === month ? game.usage.paidMonthModels || {} : {};
  return estimateCostUsd(paidModels) < (Number(settings.monthlyBudgetUsd) || 0);
}

function paidWithinBudgetKey() {
  const pk = (settings.geminiPaidKey || "").trim();
  return pk && paidBudgetAllowed() ? pk : "";
}

function isModelPaidUnlockedToday(model) {
  return Boolean(game.usage.paidUnlocked?.[todayKey()]?.[model]);
}

async function confirmPaidForModel({ model, roleLabel, status }) {
  const pk = (settings.geminiPaidKey || "").trim();
  if (!pk) return false;
  if (!paidBudgetAllowed()) {
    alert(`Orçamento mensal (US$ ${settings.monthlyBudgetUsd}) já atingido. ${model} não moverá para a Chave Paga.`);
    return false;
  }
  const day = todayKey();
  if (game.usage.paidUnlocked?.[day]?.[model]) return true;
  const reason = status === 429 ? "atingiu a cota gratuita diária (429)" : `exigiu conta paga/acesso (${status})`;
  const ok = confirm(
    `⚠ AVISO DE COTA — ${roleLabel}\n\n` +
    `O modelo "${model}" ${reason} na Chave Free.\n` +
    `Deseja liberar a Chave Paga SÓ para "${model}" hoje?\n\n` +
    `(Os outros modelos continuam tentando o Free primeiro.)`
  );
  if (!ok) return false;
  ((game.usage.paidUnlocked ||= {})[day] ||= {})[model] = true;
  transientMessages.push({
    mode: "system",
    text: `⚠ ${model} (${roleLabel}) movido para a Chave Paga hoje após confirmação. Demais modelos seguem no Free.`
  });
  return true;
}

function callModelPreferFree({ model, roleLabel, systemPrompt, userMessage, contextPayload = null, temperature = 0.82 }) {
  const pk = paidWithinBudgetKey();
  const alreadyPaid = isModelPaidUnlockedToday(model) && !!pk;
  return callGemini({
    apiKey: alreadyPaid ? pk : freeGeminiKey(),
    paidApiKey: alreadyPaid ? null : pk,
    model,
    isPaid: alreadyPaid,
    roleLabel,
    onConfirmPaid: confirmPaidForModel,
    systemPrompt,
    userMessage,
    contextPayload,
    usage: game.usage,
    temperature
  });
}

function consumeMagicConnectLink() {
  const hash = location.hash || "";
  const search = location.search || "";
  const rawParam =
    (hash.startsWith("#sb=") && hash.slice(4)) ||
    new URLSearchParams(search).get("sb");
  if (!rawParam) return;
  try {
    const b64 = decodeURIComponent(rawParam).replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(b64));
    if (data?.u && data?.k) {
      settings = {
        ...settings,
        supabaseUrl: String(data.u).trim(),
        supabaseAnonKey: String(data.k).trim(),
        ...(data.s ? { slotId: String(data.s).trim() } : {})
      };
      saveSettings(settings);
      history.replaceState(null, "", location.pathname);
    }
  } catch {
    // link inválido é ignorado silenciosamente
  }
}

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
  getTtsVoice: () => settings.ttsVoice || "pt-BR-Neural2-B",
  onSpeakTurn: async (turnIdx, btnEl) => {
    const turn = game.activeChapter.turns[turnIdx];
    if (!turn?.narrative) return;
    if (isMuted()) {
      alert("Modo Furtivo (Mute) está ligado no topo direito. Desative para ouvir falas.");
      return;
    }
    const prev = btnEl ? btnEl.textContent : "🔊 Ouvir";
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "🔊 ...";
    }
    try {
      const res = await speakMessage({
        text: turn.narrative,
        mode: turn.mode || "narrative",
        settings,
        usage: game.usage,
        turnIndex: turn.turn || turnIdx + 1,
        label: turn.mode || "narrative",
        onSwitchVoice: async (nextVoice) => {
          settings.ttsVoice = nextVoice;
          saveSettings(settings);
          fillSettingsModalFields();
          pushUserSettingsToSupabase(settings).catch(() => {});
        }
      });
      if (!res.freeBrowser) {
        turn.ttsPaid = {
          chars: res.chars,
          usd: res.usd,
          brlCents: res.brlCents,
          withinFreeTier: res.withinFreeTier
        };
      }
      await persistGameDataLocal(game);
      refreshAllViews();
    } catch (err) {
      alert(err.message);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = prev;
      }
    }
  },
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
    const { parsed } = await callModelPreferFree({
      model: settings.geminiModel,
      roleLabel: "Roteiro Webtoon",
      systemPrompt,
      userMessage,
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
  if (trimmed.startsWith("/epic")) {
    return { mode: "narrative", text: trimmed.slice(5).trim() || "(Confronto decisivo!)", forceEpic: true };
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
  if (!isSupabaseConfigured(settings) || game.core.meta.isTest) {
    setSyncBadge(game.core.meta.isTest ? "Teste" : "Local", "badge-muted");
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
    const { parsed } = await callModelPreferFree({
      model: settings.geminiModel,
      roleLabel: "Resumo de Capítulo",
      systemPrompt,
      userMessage: userPrompt
    });
    const closed = await rotateChapter(
      game,
      parsed.summary,
      parsed.title || `Capítulo ${game.activeChapter.chapterNumber}`
    );
    indexMemoryInBackground({ settings, game, apiKey: freeGeminiKey(), closedChapter: closed });
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

    // Gemma 4 na frente (classifica + busca memória) em paralelo com busca vetorial pgvector
    const isActiveTurn = game.core.meta.phase === "active_game" && !negotiationAction;
    const manualLock = settings.epicManualOnly === true;
    const routerPromise =
      isActiveTurn && settings.geminiClassifierModel && cmd.text && rawInput !== "__START_PROLOGUE__"
        ? (() => {
            const c = buildClassifierPrompt(game, cmd.text);
            return callModelPreferFree({
              model: settings.geminiClassifierModel,
              roleLabel: "Roteador Gemma 4",
              systemPrompt: c.systemPrompt,
              userMessage: c.userMessage,
              temperature: 0
            })
              .then((r) => r.parsed || {})
              .catch((err) => {
                console.warn("Roteador Gemma 4 falhou, seguindo com busca local:", err);
                return {};
              });
          })()
        : Promise.resolve({});

    const vectorPromise =
      isActiveTurn && rawInput !== "__START_PROLOGUE__"
        ? searchVectorMemory({
            settings,
            queryText: cmd.text,
            apiKey: freeGeminiKey(),
            usage: game.usage
          })
        : Promise.resolve([]);

    const [routerHints, vectorHits] = await Promise.all([routerPromise, vectorPromise]);
    const memoryBundle = await retrieveRelevantMemory(
      game,
      cmd.text,
      extractMentionTokens(cmd.text),
      routerHints,
      { settings, vectorHits }
    );
    const contextPayload = buildContextPayload(game, cmd.text, focusTarget, memoryBundle);

    // Cada modelo tenta sua cota Free primeiro; se UM modelo acabar a cota Free, avisa antes de liberar Paga só para ele.
    const epicCandidate = !!settings.geminiEpicModel && isActiveTurn;
    let epic = false;
    let epicBy = "";
    if (epicCandidate && cmd.forceEpic) {
      epic = true;
      epicBy = "comando /epic";
    } else if (epicCandidate && !manualLock) {
      if (game.core.meta.nextEpic) {
        epic = true;
        epicBy = "marca do turno anterior";
      } else if (cmd.mode === "narrative" && routerHints?.epico === true) {
        epic = true;
        epicBy = "Gemma 4 na frente";
      }
    }
    const chosenModel = epic ? settings.geminiEpicModel : settings.geminiModel;
    const roleLabel = epic ? "Narrador Épico" : "Narrador Comum";
    const { parsed, model: usedModel, usedPaid } = await callModelPreferFree({
      model: chosenModel,
      roleLabel,
      systemPrompt,
      userMessage: cmd.forceEpic ? cmd.text : rawInput,
      contextPayload
    });
    game.core.meta.nextEpic = parsed.epico === true;
    if (epic) {
      transientMessages.push({
        mode: "system",
        text: `⚡ Narrador Épico (${usedModel} · ${usedPaid ? "Chave Paga" : "Cota Free"}, por ${epicBy})`
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
      indexMemoryInBackground({ settings, game, apiKey: freeGeminiKey(), patches: parsed.statePatches });
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

function setSelectValue(id, value) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const v = value ?? "";
  if (v && ![...sel.options].some((o) => o.value === v)) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.prepend(opt);
  }
  sel.value = v;
}

function populateFetchedModels(models) {
  const targets = ["cfg-gemini-model", "cfg-gemini-epic", "cfg-gemini-classifier"];
  for (const id of targets) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const prev = sel.value;
    const allowOff = id !== "cfg-gemini-model";
    const existing = new Set([...sel.options].map((o) => o.value));
    for (const m of models) {
      if (existing.has(m.id)) continue;
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.displayName && m.displayName !== m.id ? `${m.id} (${m.displayName})` : m.id;
      sel.insertBefore(opt, allowOff && sel.lastElementChild?.value === "" ? sel.lastElementChild : null);
      existing.add(m.id);
    }
    sel.value = prev;
  }
}

function fillSettingsModalFields() {
  document.getElementById("cfg-gemini-key").value = settings.geminiKey || "";
  document.getElementById("cfg-gemini-paid-key").value = settings.geminiPaidKey || "";
  setSelectValue("cfg-gemini-model", settings.geminiModel || "gemini-3.5-flash-lite");
  setSelectValue("cfg-gemini-epic", settings.geminiEpicModel ?? "gemini-3.8-flash");
  setSelectValue("cfg-gemini-classifier", settings.geminiClassifierModel ?? "gemma-4-31b-it");
  document.getElementById("cfg-budget").value = settings.monthlyBudgetUsd ?? 5;
  const epManual = document.getElementById("cfg-epic-manual");
  if (epManual) epManual.checked = settings.epicManualOnly === true;
  setSelectValue("cfg-tts-voice", settings.ttsVoice || "pt-BR-Neural2-B");
  const ttsKeyEl = document.getElementById("cfg-tts-key");
  if (ttsKeyEl) ttsKeyEl.value = settings.ttsKey || "";
  document.getElementById("cfg-gemini-rpd").value = settings.geminiRpdLimit || 250;
  document.getElementById("cfg-gemini-tpd").value = settings.geminiTpdLimit || 1000000;
  document.getElementById("cfg-sb-url").value = settings.supabaseUrl || "";
  document.getElementById("cfg-sb-key").value = settings.supabaseAnonKey || "";
  document.getElementById("cfg-slot-id").value = settings.slotId || "white-demon-01";
  const adv = document.getElementById("sb-advanced-details");
  if (adv) adv.open = !(settings.supabaseUrl && settings.supabaseAnonKey);
  renderSbAuth();
  document.getElementById("cfg-art-style").value = settings.artStylePrompt || DEFAULT_ART_STYLE;
}

function openSettingsModal() {
  fillSettingsModalFields();
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
  document.getElementById("btn-fetch-models").addEventListener("click", async () => {
    const key =
      document.getElementById("cfg-gemini-key").value.trim() ||
      document.getElementById("cfg-gemini-paid-key").value.trim();
    const btn = document.getElementById("btn-fetch-models");
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Consultando API...";
    try {
      const models = await listGeminiModels(key);
      populateFetchedModels(models);
      btn.textContent = `✓ ${models.length} modelos`;
      setTimeout(() => { btn.textContent = prevText; }, 1800);
    } catch (err) {
      btn.textContent = prevText;
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-copy-connect-link").addEventListener("click", async () => {
    const u = document.getElementById("cfg-sb-url").value.trim();
    const k = document.getElementById("cfg-sb-key").value.trim();
    const s = document.getElementById("cfg-slot-id").value.trim() || "white-demon-01";
    if (!u || !k) return alert("Preencha primeiro a Supabase Project URL e a Publishable/Anon Key.");
    const payload = btoa(JSON.stringify({ u, k, s })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const link = `${location.origin}${location.pathname}#sb=${payload}`;
    try {
      await navigator.clipboard.writeText(link);
      alert("Link de conexão copiado! Abra esse link no celular/PC e só entre com seu e-mail e senha.");
    } catch {
      prompt("Copie o link abaixo para abrir em outro aparelho:", link);
    }
  });

  document.getElementById("btn-sb-login").addEventListener("click", async () => {
    const sb = {
      ...settings,
      supabaseUrl: document.getElementById("cfg-sb-url").value.trim(),
      supabaseAnonKey: document.getElementById("cfg-sb-key").value.trim()
    };
    if (!sb.supabaseUrl || !sb.supabaseAnonKey) {
      const adv = document.getElementById("sb-advanced-details");
      if (adv) adv.open = true;
      return alert("Preencha a Supabase Project URL e a Publishable/Anon Key abaixo antes de entrar.");
    }
    const passEl = document.getElementById("cfg-sb-pass");
    try {
      await signInSupabase(sb, document.getElementById("cfg-sb-email").value.trim(), passEl.value);
      settings = { ...settings, supabaseUrl: sb.supabaseUrl, supabaseAnonKey: sb.supabaseAnonKey };
      const remoteCfg = await pullUserSettingsFromSupabase(settings).catch(() => null);
      if (remoteCfg && typeof remoteCfg === "object") {
        settings = { ...settings, ...remoteCfg };
        fillSettingsModalFields();
      }
      saveSettings(settings);
      setSyncBadge(isSupabaseConfigured(settings) ? "Pronto" : "Local", "badge-muted");
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
      inp.value = cmd + inp.value.replace(/^\/(pray|world|system|mana|epic)\s*/i, "");
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
    if (isMuted()) stopTts();
    settings.muted = isMuted();
    saveSettings(settings);
    paintMute();
  });
  document.getElementById("btn-tts-breakdown")?.addEventListener("click", () => {
    document.getElementById("tts-breakdown-box")?.classList.toggle("hidden");
  });
  document.getElementById("btn-rag-reindex")?.addEventListener("click", async (e) => {
    const btnEl = e.currentTarget;
    const prev = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = "Indexando RAG...";
    try {
      const count = await reindexAllMemoryVectors({ settings, game, apiKey: freeGeminiKey() });
      btnEl.textContent = `✓ ${count} vetores`;
      setTimeout(() => { btnEl.textContent = prev; }, 2200);
    } catch (err) {
      btnEl.textContent = prev;
      alert(`${err.message}\n\n(Se ainda não criou a tabela pgvector, rode o bloco FASE 6 do supabase_schema.sql no SQL Editor.)`);
    } finally {
      btnEl.disabled = false;
    }
  });
  document.getElementById("quota-strip").addEventListener("click", openSettingsModal);
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    settings = {
      ...settings,
      geminiKey: document.getElementById("cfg-gemini-key").value.trim(),
      geminiPaidKey: document.getElementById("cfg-gemini-paid-key").value.trim(),
      ttsVoice: document.getElementById("cfg-tts-voice")?.value || "pt-BR-Neural2-B",
      ttsKey: document.getElementById("cfg-tts-key")?.value.trim() || "",
      geminiModel: document.getElementById("cfg-gemini-model").value,
      geminiEpicModel: document.getElementById("cfg-gemini-epic").value,
      geminiClassifierModel: document.getElementById("cfg-gemini-classifier").value,
      epicManualOnly: document.getElementById("cfg-epic-manual")?.checked ?? false,
      monthlyBudgetUsd: Number(document.getElementById("cfg-budget").value) || 0,
      geminiRpdLimit: Number(document.getElementById("cfg-gemini-rpd").value) || 250,
      geminiTpdLimit: Number(document.getElementById("cfg-gemini-tpd").value) || 1000000,
      supabaseUrl: document.getElementById("cfg-sb-url").value.trim(),
      supabaseAnonKey: document.getElementById("cfg-sb-key").value.trim(),
      slotId: document.getElementById("cfg-slot-id").value.trim() || "white-demon-01",
      artStylePrompt: document.getElementById("cfg-art-style").value.trim() || DEFAULT_ART_STYLE
    };
    saveSettings(settings);
    pushUserSettingsToSupabase(settings).catch((err) => console.warn("Config não enviada à nuvem:", err));
    document.getElementById("settings-modal").classList.add("hidden");
    renderHeaderAndQuotas(game, settings);
    setSyncBadge(isSupabaseConfigured(settings) ? "Pronto" : "Local", "badge-muted");

    if (
      freeGeminiKey() &&
      game.core.meta.phase === "prologue_world" &&
      game.activeChapter.turns.length === 0
    ) {
      await sendTurn("__START_PROLOGUE__");
    }
  });

  document.getElementById("btn-sb-push").addEventListener("click", async () => {
    if (game.core.meta.isTest) return alert("Modo Teste não vai para a nuvem. Reinicie a jornada para jogar de verdade.");
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

  document.getElementById("btn-test-game").addEventListener("click", async () => {
    if (!confirm("Modo Teste: substitui o jogo local por uma masmorra de teste (não vai para a nuvem). Continuar?")) return;
    await clearAllLocal();
    game = createTestGameData();
    viewingSphereId = game.core.meta.activeSphereId;
    transientMessages = [];
    await persistGameDataLocal(game);
    refreshAllViews();
    document.getElementById("settings-modal").classList.add("hidden");
    if (freeGeminiKey()) await sendTurn("Acordo zonzo no chão frio da masmorra. O que vejo ao meu redor?");
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
    if (freeGeminiKey()) {
      await sendTurn("__START_PROLOGUE__");
    }
  });
}

async function init() {
  consumeMagicConnectLink();
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
      freeGeminiKey() &&
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
