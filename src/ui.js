import { canUndo, getChapterLocal, todayKey } from "./state.js";
import { estimateCostUsd } from "./config.js";
import { fetchChapterOnDemand } from "./supabase.js";

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function barClass(pct) {
  if (pct >= 90) return "fill-danger";
  if (pct >= 70) return "fill-warn";
  return "";
}

function textMeter(val, max, width = 10) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, val / max)) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function resolveMediaUrl(game, entity) {
  if (!entity) return null;
  if (entity.mediaId && game.mediaCache?.[entity.mediaId]?.webpData) {
    return game.mediaCache[entity.mediaId].webpData;
  }
  return entity.imageWebp || null;
}

function renderMediaControls({ type, id, imageUrl, hasInfo = true }) {
  const thumb = imageUrl
    ? `<div class="portrait-wrap"><img class="portrait-img" src="${imageUrl}" alt="Arte 9:16" /></div>`
    : `<div class="portrait-wrap"><span>9:16<br/>Sem Arte</span></div>`;

  const btns = `<div class="card-actions">
    ${hasInfo
      ? `<button class="btn btn-ghost btn-sm btn-gen-prompt" data-type="${esc(type)}" data-id="${esc(id)}">✧ Prompt 9:16</button>`
      : ""}
    <label class="btn btn-ice btn-sm file-label">
      ◈ ${imageUrl ? "Trocar 9:16" : "Anexar 9:16"}
      <input type="file" accept="image/*" class="input-attach-img" data-type="${esc(type)}" data-id="${esc(id)}" hidden />
    </label>
  </div>`;

  return { thumb, btns };
}

function renderDevLogAndMiniChat({ kind, id, name, devLog = [], placeholder }) {
  const logsHtml = devLog.length
    ? `<div class="devlog-box">
        ${devLog
          .map(
            (e) => `<div class="devlog-entry">
              <div style="color:var(--ice);">▶ ${esc(e.user)}</div>
              <div style="white-space:pre-wrap;">${esc(e.reply)}</div>
            </div>`
          )
          .join("")}
      </div>`
    : `<div class="muted" style="margin-top:6px;font-size:0.76rem;">Sem histórico específico registrado ainda.</div>`;

  return `
    ${logsHtml}
    <div class="mini-chat-row">
      <input
        type="text"
        class="mini-chat-input"
        data-focus-kind="${esc(kind)}"
        data-focus-id="${esc(id)}"
        data-focus-name="${esc(name)}"
        placeholder="${esc(placeholder)}"
      />
      <button
        class="btn btn-mana btn-sm btn-focus-send"
        data-focus-kind="${esc(kind)}"
        data-focus-id="${esc(id)}"
        data-focus-name="${esc(name)}"
      >Enviar</button>
    </div>
  `;
}

// Heimdall: custo por modelo (hoje e no mês) contra o orçamento mensal.
function costReport(usage, settings) {
  const month = todayKey().slice(0, 7);
  const monthModels = usage.monthKey === month ? usage.monthModels || {} : {};
  const lines = (models) =>
    Object.entries(models)
      .map(([name, m]) => `  ${name}: ${m.req} req · ${(m.in / 1000).toFixed(1)}k in / ${(m.out / 1000).toFixed(1)}k out · US$ ${estimateCostUsd({ [name]: m }).toFixed(3)}`)
      .join("\n") || "  (sem chamadas)";
  const budget = Number(settings.monthlyBudgetUsd) || 0;
  const spent = estimateCostUsd(monthModels);
  const pct = budget ? ((spent / budget) * 100).toFixed(1) : "—";
  return (
    `Heimdall — custo estimado (tarifa paga; no free tier o real é US$ 0):\n` +
    `Hoje (US$ ${estimateCostUsd(usage.models || {}).toFixed(3)}):\n${lines(usage.models || {})}\n` +
    `Mês ${month} (US$ ${spent.toFixed(2)} / ${budget} · ${pct}%):\n${lines(monthModels)}\n` +
    `Cascata: comum ${settings.geminiModel} → épico ${settings.geminiEpicModel || "desligado"} · classificador ${settings.geminiClassifierModel || "desligado"}`
  );
}

export function renderHeaderAndQuotas(game, settings) {
  const { core, usage } = game;
  const sub = document.getElementById("header-sub");
  sub.textContent = `Rank ${core.player.rank} · Lv. ${core.player.level} · Cap. ${core.meta.activeChapterNumber}`;

  const rpdLimit = Math.max(1, Number(settings.geminiRpdLimit) || 250);
  const tpdLimit = Math.max(1000, Number(settings.geminiTpdLimit) || 1000000);
  const rpdPct = Math.min(100, (usage.geminiRequests / rpdLimit) * 100);
  const tokPct = Math.min(100, (usage.geminiTokens / tpdLimit) * 100);
  const maxGemPct = Math.max(rpdPct, tokPct);

  document.getElementById("gemini-quota-text").textContent =
    `${usage.geminiRequests}/${rpdLimit} req · ${(usage.geminiTokens / 1000).toFixed(1)}k tok`;
  const gBar = document.getElementById("gemini-quota-bar");
  gBar.style.width = `${maxGemPct.toFixed(1)}%`;
  gBar.className = `progress-fill ${barClass(maxGemPct) || "fill-ice"}`;

  const sbLimitMb = Math.max(1, Number(settings.supabaseStorageLimitMb) || 500);
  const usedMb = (usage.estimatedBytes || 0) / (1024 * 1024);
  const sbPct = Math.min(100, (usedMb / sbLimitMb) * 100);

  document.getElementById("supabase-quota-text").textContent =
    `${usedMb.toFixed(2)}/${sbLimitMb} MB · ${usage.supabaseRequests || 0} req`;
  const sBar = document.getElementById("supabase-quota-bar");
  sBar.style.width = `${Math.max(sbPct, usedMb > 0 ? 1.5 : 0).toFixed(1)}%`;
  sBar.className = `progress-fill ${barClass(sbPct) || "fill-mana"}`;

  const now = Date.now();
  const rpm = (usage.recentRequestTimestamps || []).filter((t) => now - t < 60000).length;
  const detailBox = document.getElementById("quota-detail-box");
  if (detailBox) {
    detailBox.textContent =
      `Consumo Medido (Dia ${usage.dayKey}):\n` +
      `• Gemini: ${usage.geminiRequests} reqs hoje (${rpm}/${settings.geminiRpmLimit} RPM no último min)\n` +
      `• Tokens Gemini reais (usageMetadata): ${usage.geminiTokens.toLocaleString("pt-BR")} / ${tpdLimit.toLocaleString("pt-BR")}\n` +
      `• Save + Imagens WebP 9:16: ${(usage.estimatedBytes / 1024).toFixed(1)} KB (${usedMb.toFixed(3)} MB / ${sbLimitMb} MB)\n` +
      `• Chamadas Supabase na sessão/dia: ${usage.supabaseRequests || 0}\n\n` +
      costReport(usage, settings);
  }

  const undoBtn = document.getElementById("btn-undo-turn");
  if (undoBtn) {
    undoBtn.classList.toggle("hidden", !canUndo());
  }
}

export function renderPrologueBanner(game) {
  const banner = document.getElementById("prologue-banner");
  const { phase, prologueQuestionCount, prologueTargetMax, deityQuestionCount } = game.core.meta;
  if (phase === "prologue_world") {
    banner.classList.remove("hidden");
    banner.textContent = `✦ Prólogo — Voz do Mundo (${prologueQuestionCount}/${prologueTargetMax} perguntas abertas · Construindo leis do mundo)`;
  } else if (phase === "prologue_deity") {
    banner.classList.remove("hidden");
    banner.textContent = `☽ Prólogo — Deusa Patrona (${deityQuestionCount}/${game.core.meta.deityTarget || 15} perguntas · Moldando o sistema mágico)`;
  } else {
    banner.classList.add("hidden");
  }
}

const MODE_LABELS = {
  prologue_world: { label: "✦ Voz do Mundo", cls: "msg-world" },
  prologue_deity: { label: "☽ Deusa Patrona", cls: "msg-pray" },
  pray: { label: "☽ Deusa Patrona (/pray)", cls: "msg-pray" },
  world: { label: "⌖ Arquiteto do Mundo (/world)", cls: "msg-world" },
  system: { label: "❖ Tela do Sistema (/system)", cls: "msg-system" },
  mana: { label: "◈ Consciência da Mana (/mana)", cls: "msg-mana" },
  narrative: { label: "✧ Crônica", cls: "" },
  error: { label: "▲ Aviso", cls: "msg-error" }
};

export function renderChatLog(game, transientMessages = [], handlers = {}) {
  const log = document.getElementById("chat-log");
  const turns = game?.activeChapter?.turns || [];
  let html = "";

  if (!turns.length && !transientMessages.length) {
    html += `<div class="msg msg-ai msg-world">
      <div class="msg-tag">❄ Bem-vindo · Dark Fantasy</div>
      Toque em <b>⚙</b> no topo direito, cole sua <b>Gemini API Key</b> (e os dados do Supabase se quiser sincronizar) e salve para iniciar o Prólogo com a <b>Voz do Mundo</b>.
    </div>`;
  }

  turns.forEach((t, idx) => {
    if (t.user) {
      html += `<div class="msg msg-user">${esc(t.user)}</div>`;
    }
    if (t.narrative) {
      const m = MODE_LABELS[t.mode] || MODE_LABELS.narrative;
      const sceneImg = t.sceneMediaId ? game.mediaCache?.[t.sceneMediaId]?.webpData : null;
      const sceneBlock = (t.scenePrompt || sceneImg)
        ? `<div class="scene-art-box">
            ${sceneImg ? `<img class="scene-art-thumb" src="${sceneImg}" alt="Cena 9:16" />` : ""}
            <div class="card-actions">
              ${t.scenePrompt ? `<button class="btn btn-ghost btn-sm btn-scene-prompt" data-turn-idx="${idx}">✧ Prompt Cena 9:16</button>` : ""}
              <label class="btn btn-ice btn-sm file-label">
                ◈ ${sceneImg ? "Trocar Cena" : "Anexar Cena 9:16"}
                <input type="file" accept="image/*" class="input-attach-scene" data-turn-idx="${idx}" hidden />
              </label>
            </div>
          </div>`
        : "";

      html += `<div class="msg msg-ai ${m.cls}">
        <div class="msg-tag">${m.label}</div>${esc(t.narrative)}${sceneBlock}
      </div>`;
    }
  });

  for (const tm of transientMessages) {
    const m = MODE_LABELS[tm.mode] || MODE_LABELS.error;
    html += `<div class="msg msg-ai ${m.cls}">
      <div class="msg-tag">${m.label}</div>${esc(tm.text)}
    </div>`;
  }

  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;

  log.querySelectorAll(".btn-scene-prompt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const turn = turns[Number(btn.dataset.turnIdx)];
      if (turn?.scenePrompt && handlers.onShowPromptText) {
        handlers.onShowPromptText(turn.scenePrompt);
      }
    });
  });

  log.querySelectorAll(".input-attach-scene").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file && handlers.onUploadSceneImage) {
        handlers.onUploadSceneImage(Number(inp.dataset.turnIdx), file);
      }
    });
  });
}

export function renderNegotiationBox(game) {
  const box = document.getElementById("negotiation-box");
  const neg = game.core.pendingNegotiation;
  if (!neg || !neg.active) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  document.getElementById("negotiation-title").textContent =
    `⚖ ${neg.title || "Negociação de Evolução / Limite"}`;
  const missing = neg.requirementsMissing?.length
    ? `\nRequisitos pendentes: ${neg.requirementsMissing.join(", ")}`
    : "";
  document.getElementById("negotiation-desc").textContent =
    `${neg.proposalSummary || "Proposta fora do patamar atual."}${missing}`;
}

export function renderSheet(game, handlers = {}) {
  const {
    player,
    patronDeity,
    manaConsciousness,
    skills,
    projects,
    golems,
    spatialPocket,
    pet,
    keyItems,
    inventory
  } = game.core;
  const el = document.getElementById("sheet-content");

  const attrLines = Object.entries(player.attributes)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");

  const currencyLines = player.currencies?.length
    ? player.currencies.map((c) => `• ${c.name}: ${c.amount}`).join("\n")
    : "Nenhuma moeda registrada.";

  const statusText =
    `❄ NOME: ${player.name}\n` +
    `✦ Origem: ${player.origin}\n` +
    `◈ Rank: ${player.rank}  |  Nível: ${player.level}\n` +
    `✧ XP: ${player.xp} / ${player.xpToNext} [${textMeter(player.xp, player.xpToNext)}]\n` +
    `♥ HP:   ${player.hp}/${player.hpMax} [${textMeter(player.hp, player.hpMax)}]\n` +
    `◈ Mana: ${player.mana}/${player.manaMax} [${textMeter(player.mana, player.manaMax)}]\n` +
    `⚡ Est.: ${player.stamina}/${player.staminaMax} [${textMeter(player.stamina, player.staminaMax)}]\n\n` +
    `⌖ ATRIBUTOS:\n${attrLines}\n\n` +
    `$ MOEDAS:\n${currencyLines}\n` +
    (player.titles.length ? `\n✦ Títulos: ${player.titles.join(" · ")}` : "") +
    `\n⛨ Armadura: ${player.armor || 0}` +
    (Object.keys(player.injuries || {}).length
      ? `\n✚ LESÕES:\n${Object.entries(player.injuries)
          .map(([r, i]) => `• ${r} [${textMeter(i.severity, 100)}] ${i.effect}`)
          .join("\n")}`
      : "") +
    (game.core.magicSystem?.laws?.length
      ? `\n\n✦ LEIS DA MAGIA:\n${game.core.magicSystem.laws.map((l) => `• ${l}`).join("\n")}`
      : "") +
    (player.bodyModifications.length
      ? `\n❄ Modificações Corporais: ${player.bodyModifications.join(", ")}`
      : "");

  const playerMedia = renderMediaControls({
    type: "player",
    id: "player",
    imageUrl: resolveMediaUrl(game, player),
    hasInfo: true
  });

  const manaCard = manaConsciousness.unlocked
    ? `<div class="card">
        <h3>◈ Consciência da Mana: ${esc(manaConsciousness.name || "Eco Criogênico")}</h3>
        <div class="muted">Despertou no Lv. ${manaConsciousness.awakenedAtLevel} · Sincronia: ${manaConsciousness.sync}%</div>
        <p style="margin:6px 0 4px;font-size:0.85rem;">${esc(manaConsciousness.personality)}</p>
        ${manaConsciousness.lastRemarks?.length
          ? `<pre class="pre-sheet">“${esc(manaConsciousness.lastRemarks[0])}”</pre>`
          : ""}
      </div>`
    : `<div class="card">
        <h3>◈ Consciência da Mana (Dormente)</h3>
        <div class="muted">Ainda não nasceu por ação e reação (~Lv 45-50). O /system permanece mudo e objetivo.</div>
      </div>`;

  const skillsHtml = skills.length
    ? skills
        .map((s) => {
          const sId = s.id || s.name;
          const focusKind = (s.isManaCore || manaConsciousness.unlocked) ? "mana_skill" : "skill";
          const ph = focusKind === "mana_skill"
            ? "Conversar com a Mana / evoluir esta habilidade..."
            : "Testar, anotar ou treinar esta habilidade...";
          return `<div class="card skill-card">
            <h3>❄ ${esc(s.name)} <span class="tag-pill">Tier ${esc(s.tier || "?")} · Lv.${s.level || 1}</span></h3>
            <div style="font-size:0.83rem;margin-bottom:4px;"><b>Escopo Atual:</b> ${esc(s.currentScope || "—")}</div>
            <div style="font-size:0.82rem;color:#fbbf24;margin-bottom:4px;"><b>Trava Lógica:</b> ${esc(s.hardLimits || "—")}</div>
            ${Array.isArray(s.evolutionNorth) && s.evolutionNorth.length
              ? `<div style="font-size:0.8rem;" class="muted"><b>Norte Evolutivo:</b> ${s.evolutionNorth.map(esc).join(" → ")}</div>`
              : ""}
            ${Array.isArray(s.forcedScars) && s.forcedScars.length
              ? `<div style="font-size:0.8rem;color:#f87171;margin-top:4px;">▲ Sobrecargas: ${s.forcedScars.map(esc).join(" | ")}</div>`
              : ""}
            ${renderDevLogAndMiniChat({
              kind: focusKind,
              id: sId,
              name: s.name,
              devLog: s.devLog || [],
              placeholder: ph
            })}
          </div>`;
        })
        .join("")
    : `<div class="card"><div class="muted">Nenhuma habilidade selada ainda. Complete o Prólogo com a Deusa Patrona.</div></div>`;

  const projectsHtml = projects?.length
    ? projects
        .map((pr) => {
          const pId = pr.id || pr.name;
          return `<div class="card">
            <h3>⌖ ${esc(pr.name)} <span class="tag-pill">${pr.progress ?? 0}%</span></h3>
            <div class="muted">${esc(pr.stage || pr.category || "Em pesquisa")}</div>
            ${pr.notes ? `<div style="font-size:0.82rem;margin-top:4px;">${esc(pr.notes)}</div>` : ""}
            ${renderDevLogAndMiniChat({
              kind: "project",
              id: pId,
              name: pr.name,
              devLog: pr.devLog || [],
              placeholder: "Avançar ou ajustar este projeto de engenharia..."
            })}
          </div>`;
        })
        .join("")
    : `<div class="card"><div class="muted">Nenhum projeto de engenharia ativo (ex.: estudos anatômicos, forja de golens).</div></div>`;

  const golemCards = [];
  for (let i = 0; i < golems.maxSlots; i++) {
    const g = golems.items[i];
    if (g) {
      const gm = renderMediaControls({
        type: "golem",
        id: g.id || g.name,
        imageUrl: resolveMediaUrl(game, g),
        hasInfo: true
      });
      golemCards.push(`
        <div class="card">
          <h3>❖ Slot ${i + 1}: ${esc(g.name)} <span class="tag-pill">Rank ${esc(g.rank || "?")}</span></h3>
          <div class="card-flex">
            ${gm.thumb}
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.83rem;"><b>Personalidade:</b> ${esc(g.personality || "Definida por você")}</div>
              <div class="muted" style="margin-top:3px;">Mana Própria: ${esc(g.manaPool || "Autossustentável")} · ${esc(g.status || "Ativo")}</div>
              ${g.appearance ? `<div class="muted" style="margin-top:3px;">Visual: ${esc(g.appearance)}</div>` : ""}
              ${gm.btns}
            </div>
          </div>
        </div>
      `);
    } else {
      golemCards.push(`<div class="card"><div class="muted">❖ Slot ${i + 1}: [ Vazio — Nome e personalidade serão definidos por você ao forjar ]</div></div>`);
    }
  }

  const keyItemsHtml = keyItems?.length
    ? keyItems
        .map((ki) => {
          const km = renderMediaControls({
            type: "keyItem",
            id: ki.id || ki.name,
            imageUrl: resolveMediaUrl(game, ki),
            hasInfo: true
          });
          return `<div class="card">
            <h3>⚔ ${esc(ki.name)} ${ki.rarity ? `<span class="tag-pill">${esc(ki.rarity)}</span>` : ""}</h3>
            <div class="card-flex">
              ${km.thumb}
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.83rem;">${esc(ki.description || "")}</div>
                ${km.btns}
              </div>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="card"><div class="muted">Nenhum artefato ou arma importante registrada ainda.</div></div>`;

  const pocketHtml = spatialPocket.unlocked
    ? `<pre class="pre-sheet">✦ ${esc(spatialPocket.name)}\n◈ Mana Estocada: ${spatialPocket.storedMana} / ${spatialPocket.storedManaCap}\n❖ Golens Guardados: ${(spatialPocket.golemsInside || []).join(", ") || "Nenhum"}\n⚔ Arsenal: ${(spatialPocket.storedItems || []).join(", ") || "Vazio"}</pre>`
    : `<div class="muted">Bloqueado — reservado para o desbloqueio orgânico de Magia Espacial (~Lv 400).</div>`;

  let petHtml = `<div class="muted">Nenhum companheiro criogênico vinculado ainda.</div>`;
  if (pet.unlocked) {
    const pm = renderMediaControls({
      type: "pet",
      id: "pet",
      imageUrl: resolveMediaUrl(game, pet),
      hasInfo: true
    });
    petHtml = `
      <div class="card-flex">
        ${pm.thumb}
        <div style="flex:1;min-width:0;">
          <pre class="pre-sheet">⚔ ${esc(pet.name || "Companheiro")} (${esc(pet.species || "Criatura de Gelo")})\n◈ Rank: ${esc(pet.rank || "?")} · Vínculo: ${pet.bond || 0}%\n✦ Personalidade: ${esc(pet.personality || "Em formação")}\n❄ Habilidades: ${(pet.abilities || []).join(", ") || "—"}\n${esc(pet.notes || "")}</pre>
          ${pm.btns}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="card">
      <h3>❖ Tela do Sistema (/system)</h3>
      <div class="card-flex">
        ${playerMedia.thumb}
        <div style="flex:1;min-width:0;">
          <pre class="pre-sheet">${esc(statusText)}</pre>
          ${playerMedia.btns}
        </div>
      </div>
    </div>
    ${manaCard}
    <div class="card"><h3>☽ Deusa Patrona</h3><pre class="pre-sheet">${esc(patronDeity.name)} · Domínio: ${esc(patronDeity.domain)}\nVínculo: ${patronDeity.bond} · Postura: ${esc(patronDeity.disposition)}</pre></div>
    <h3 style="font-size:0.9rem;color:var(--ice);margin:10px 2px 6px;">❄ Habilidades & Mini-Chat</h3>
    ${skillsHtml}
    <h3 style="font-size:0.9rem;color:var(--ice);margin:10px 2px 6px;">⌖ Projetos de Engenharia</h3>
    ${projectsHtml}
    <h3 style="font-size:0.9rem;color:var(--ice);margin:10px 2px 6px;">❖ 7 Golens Autossustentáveis (${golems.items.length}/7)</h3>
    ${golemCards.join("")}
    <div class="card"><h3>✦ Mundo de Bolso (Magia Espacial)</h3>${pocketHtml}</div>
    <div class="card"><h3>⚔ Pet de Gelo</h3>${petHtml}</div>
    <h3 style="font-size:0.9rem;color:var(--ice);margin:10px 2px 6px;">⚔ Itens-Chave & Arsenal (#)</h3>
    ${keyItemsHtml}
    <div class="card"><h3>☰ Mochila Geral (#)</h3><pre class="pre-sheet">${inventory.length ? esc(inventory.map((i) => `• ${i}`).join("\n")) : "Mochila vazia."}</pre></div>
  `;

  bindMediaHandlers(el, handlers);
  bindFocusChatHandlers(el, handlers);
}

export function renderQuests(game) {
  const { active, completed } = game.core.quests;
  const el = document.getElementById("quests-content");
  const renderList = (arr, emptyMsg) =>
    arr.length
      ? arr
          .map(
            (q) => `<div class="card">
              <h3>${q.status === "completed" ? "✓" : "⚔"} ${esc(q.title)}</h3>
              <div style="font-size:0.84rem;">${esc(q.description || "")}</div>
              ${q.reward ? `<div class="muted" style="margin-top:4px;">✦ ${esc(q.reward)}</div>` : ""}
            </div>`
          )
          .join("")
      : `<div class="card"><div class="muted">${emptyMsg}</div></div>`;

  el.innerHTML = `
    <h3 style="font-size:0.9rem;color:var(--ice);margin:0 0 8px;">⚔ Quests Ativas</h3>
    ${renderList(active, "Nenhuma quest ativa no momento.")}
    <h3 style="font-size:0.9rem;color:var(--muted);margin:14px 0 8px;">✓ Concluídas</h3>
    ${renderList(completed, "Nenhuma quest concluída ainda.")}
  `;
}

async function loadChapterAnywhere(game, settings, chId) {
  if (chId === game.activeChapter.chapterId) return game.activeChapter;
  return (
    (await getChapterLocal(chId)) ||
    (await fetchChapterOnDemand(settings, chId, game.usage).catch(() => null))
  );
}

// Estúdio Webtoon (aberto pelas Configurações): capítulos → 60 páginas com envio e checklist.
export async function renderWebtoonStudio(game, settings, handlers = {}, chapterId = null) {
  const el = document.getElementById("webtoon-content");
  const rerender = (id) => renderWebtoonStudio(game, settings, handlers, id);

  if (!chapterId) {
    const closed = [...game.chaptersIndex].filter((c) => c.isClosed).reverse();
    el.innerHTML = closed.length
      ? closed
          .map(
            (c) => `<button class="btn btn-ghost wt-open-ch" data-ch="${esc(c.chapterId)}" style="display:block;width:100%;text-align:left;margin-bottom:6px;">
              ☰ Cap. ${c.chapterNumber}: ${esc(c.title || "Sem título")}</button>`
          )
          .join("")
      : `<div class="muted">Nenhum capítulo fechado ainda. O Webtoon nasce quando um capítulo fecha.</div>`;
    el.querySelectorAll(".wt-open-ch").forEach((b) => b.addEventListener("click", () => rerender(b.dataset.ch)));
    return;
  }

  el.innerHTML = `<span class="muted">Carregando capítulo...</span>`;
  const ch = await loadChapterAnywhere(game, settings, chapterId);
  const back = `<button class="btn btn-ghost btn-sm wt-back">← Capítulos</button>`;
  const bindBack = () => el.querySelector(".wt-back")?.addEventListener("click", () => rerender(null));
  if (!ch?.turns?.length) {
    el.innerHTML = `${back}<div class="muted" style="margin-top:8px;">Sem turnos salvos para este capítulo.</div>`;
    return bindBack();
  }

  const pages = ch.webtoonPrompts;
  if (!pages?.length) {
    el.innerHTML = `${back}<div style="margin-top:8px;">
      <div class="muted">Cap. ${ch.chapterNumber} ainda não tem roteiro.</div>
      <button class="btn btn-ice btn-sm wt-gen" style="margin-top:8px;">🎞 Roteirizar páginas</button></div>`;
    bindBack();
    el.querySelector(".wt-gen").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = `Roteirizando ${ch.turns.length} turnos...`;
      try {
        await handlers.onGenerateWebtoon(ch);
        rerender(chapterId);
      } catch (err) {
        ev.target.disabled = false;
        ev.target.textContent = `Falhou (${err.message}) — tentar de novo`;
      }
    });
    return;
  }

  const cast = { player: game.core.player };
  for (const n of game.compendium.npcs || []) cast[n.id || n.name] = n;
  const doneCount = pages.filter((p) => p.done).length;

  el.innerHTML = `${back}
    <h3 style="margin:8px 0;">Cap. ${ch.chapterNumber}: ${esc(ch.title || "")} · ${doneCount}/${pages.length} enviadas</h3>
    ${pages
      .map((p, i) => {
        const refs = p.characters.map((id) => cast[id]).filter(Boolean);
        const own = p.mediaId ? resolveMediaUrl(game, p) : null;
        return `<div style="border-top:1px solid var(--border);padding:6px 0;font-size:0.8rem;">
          <label style="color:var(--ice);display:flex;gap:6px;align-items:center;">
            <input type="checkbox" class="wt-done" data-i="${i}" ${p.done ? "checked" : ""} /> Pág. ${p.page} ${p.done ? "✓ enviada" : ""}
          </label>
          <div style="margin:3px 0;white-space:pre-wrap;">${esc(p.prompt)}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${own ? `<img src="${own}" alt="Página ${p.page}" style="height:72px;aspect-ratio:9/16;object-fit:cover;border:1px solid var(--ice);" />` : ""}
            ${refs
              .map((r) => {
                const url = resolveMediaUrl(game, r);
                return url
                  ? `<img src="${url}" alt="${esc(r.name || "")}" title="${esc(r.name || "")}" style="height:48px;aspect-ratio:9/16;object-fit:cover;border:1px solid var(--border);" />`
                  : `<span class="muted">${esc(r.name || "?")} (sem arte)</span>`;
              })
              .join("")}
            <button class="btn btn-ghost btn-sm wt-copy" data-i="${i}">⧉ Copiar</button>
            <label class="btn btn-ice btn-sm file-label">⬆ ${own ? "Trocar" : "Enviar"}
              <input type="file" accept="image/*" class="wt-upload" data-i="${i}" hidden />
            </label>
          </div>
        </div>`;
      })
      .join("")}`;
  bindBack();

  el.querySelectorAll(".wt-copy").forEach((b) =>
    b.addEventListener("click", () => {
      const p = pages[Number(b.dataset.i)];
      const names = p.characters.map((id) => cast[id]?.name).filter(Boolean);
      handlers.onShowPromptText?.(p.prompt + (names.length ? `\n\nReference art attached for: ${names.join(", ")}.` : ""));
    })
  );
  el.querySelectorAll(".wt-done").forEach((cb) =>
    cb.addEventListener("change", async () => {
      pages[Number(cb.dataset.i)].done = cb.checked;
      await handlers.onSaveWebtoon?.(ch);
      rerender(chapterId);
    })
  );
  el.querySelectorAll(".wt-upload").forEach((inp) =>
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      await handlers.onUploadWebtoonPage?.(ch, Number(inp.dataset.i), file);
      rerender(chapterId);
    })
  );
}

export async function renderCompendium(game, settings, activeSubtab, query = "", handlers = {}) {
  const el = document.getElementById("compendium-content");
  const q = query.trim().toLowerCase();

  if (activeSubtab === "chapters") {
    const list = [...game.chaptersIndex].reverse();
    el.innerHTML = list.length
      ? list
          .map(
            (c) => `<div class="card">
              <h3>☰ Cap. ${c.chapterNumber}: ${esc(c.title || "Sem título")} ${c.isClosed ? "[Fechado]" : "[Ativo]"}</h3>
              <div class="muted">Turnos: ${c.turnCount}</div>
              <p style="font-size:0.84rem;margin:6px 0;">${esc(c.summary || "Capítulo em andamento...")}</p>
              <button class="btn btn-ghost btn-sm btn-read-chapter" data-ch="${esc(c.chapterId)}">✧ Ler Turnos</button>
              <div id="ch-preview-${esc(c.chapterId)}" style="margin-top:8px;"></div>
            </div>`
          )
          .join("")
      : `<div class="card"><div class="muted">Nenhum capítulo registrado.</div></div>`;

    const loadChapter = (chId) => loadChapterAnywhere(game, settings, chId);

    el.querySelectorAll(".btn-read-chapter").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const chId = btn.dataset.ch;
        const target = document.getElementById(`ch-preview-${chId}`);
        target.innerHTML = `<span class="muted">Carregando...</span>`;
        const ch = await loadChapter(chId);
        if (!ch || !ch.turns?.length) {
          target.innerHTML = `<span class="muted">Sem turnos salvos localmente para este capítulo.</span>`;
          return;
        }
        target.innerHTML = ch.turns
          .map(
            (t) => `<div style="border-top:1px solid var(--border);padding:6px 0;font-size:0.8rem;">
              <div style="color:var(--ice);">▶ ${esc(t.user)}</div>
              <div style="margin-top:3px;white-space:pre-wrap;">${esc(t.narrative)}</div>
            </div>`
          )
          .join("");
      });
    });
    return;
  }

  const list = game.compendium[activeSubtab] || [];
  const filtered = q
    ? list.filter((item) => JSON.stringify(item).toLowerCase().includes(q))
    : list;

  if (!filtered.length) {
    el.innerHTML = `<div class="card"><div class="muted">Nada registrado aqui ainda. Descubra jogando!</div></div>`;
    return;
  }

  el.innerHTML = filtered
    .map((item) => {
      const facts = Array.isArray(item.knownFacts)
        ? item.knownFacts.map((f) => `• ${f}`).join("\n")
        : item.description || "";
      const hasEnoughInfo = Boolean(
        item.appearance || item.personality || (Array.isArray(item.knownFacts) && item.knownFacts.length > 0)
      );
      const media = renderMediaControls({
        type: activeSubtab,
        id: item.id || item.name,
        imageUrl: resolveMediaUrl(game, item),
        hasInfo: hasEnoughInfo
      });

      return `<div class="card">
        <h3>${esc(item.name)} ${item.rank ? `<span class="tag-pill">${esc(item.rank)}</span>` : ""}</h3>
        <div class="card-flex">
          ${media.thumb}
          <div style="flex:1;min-width:0;">
            ${item.role || item.species || item.category
              ? `<div class="muted" style="margin-bottom:4px;">${esc(item.role || item.species || item.category)}</div>`
              : ""}
            ${item.personality
              ? `<div style="font-size:0.81rem;color:var(--mana);margin-bottom:4px;"><b>Personalidade:</b> ${esc(item.personality)}</div>`
              : ""}
            ${item.relationship
              ? `<div style="font-size:0.81rem;margin-bottom:4px;"><b>Relação:</b> ${esc(item.relationship)}</div>`
              : ""}
            <pre class="pre-sheet">${esc(facts)}</pre>
            ${media.btns}
          </div>
        </div>
      </div>`;
    })
    .join("");

  bindMediaHandlers(el, handlers);
}

function bindMediaHandlers(container, handlers) {
  if (!handlers) return;
  container.querySelectorAll(".btn-gen-prompt").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (handlers.onGeneratePrompt) {
        handlers.onGeneratePrompt(btn.dataset.type, btn.dataset.id);
      }
    });
  });
  container.querySelectorAll(".input-attach-img").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file && handlers.onUploadImage) {
        handlers.onUploadImage(inp.dataset.type, inp.dataset.id, file);
      }
    });
  });
}

function bindFocusChatHandlers(container, handlers) {
  if (!handlers?.onFocusChat) return;
  container.querySelectorAll(".btn-focus-send").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = container.querySelector(
        `.mini-chat-input[data-focus-kind="${CSS.escape(btn.dataset.focusKind)}"][data-focus-id="${CSS.escape(btn.dataset.focusId)}"]`
      );
      const val = inp?.value.trim();
      if (!val) return;
      inp.value = "";
      handlers.onFocusChat(
        {
          kind: btn.dataset.focusKind,
          id: btn.dataset.focusId,
          name: btn.dataset.focusName
        },
        val
      );
    });
  });
}

export function renderSphereSelector(game, viewingSphereId) {
  const select = document.getElementById("sphere-select");
  const spheres = Object.values(game.spheres);
  select.innerHTML = spheres
    .map(
      (s) =>
        `<option value="${esc(s.id)}" ${s.id === viewingSphereId ? "selected" : ""}>` +
        `⌖ ${esc(s.name)}${s.id === game.core.meta.activeSphereId ? " (Atual)" : ""}` +
        `</option>`
    )
    .join("");
}

export function renderMapNodeCard(game, viewingSphereId, node, onTravelSphere) {
  const card = document.getElementById("map-node-card");
  const sphere = game.spheres[viewingSphereId];
  const isOtherSphere = viewingSphereId !== game.core.meta.activeSphereId;

  const travelBtn = isOtherSphere && sphere?.canReturn
    ? `<button id="btn-travel-sphere" class="btn btn-mana btn-sm" style="margin-top:8px;">✦ Viajar / Retornar para esta Esfera</button>`
    : "";

  const portalTarget = node?.portalToSphereId ? game.spheres[node.portalToSphereId] : null;
  const portalBtn = portalTarget
    ? `<button id="btn-portal-sphere" class="btn btn-ice btn-sm" style="margin-top:8px;">◎ Atravessar Portal → ${esc(portalTarget.name)}</button>`
    : "";

  if (!node) {
    card.innerHTML = `
      <div><b>${esc(sphere?.name || "Esfera")}</b> · Leis: ${esc(sphere?.lawsSummary || "—")}</div>
      <div class="muted" style="margin-top:4px;">Toque em um nó na esfera para inspecionar.</div>
      ${travelBtn}
    `;
  } else {
    const isHere =
      node.id === game.core.meta.activeNodeId &&
      viewingSphereId === game.core.meta.activeSphereId;
    card.innerHTML = `
      <div><b>${esc(node.asciiGlyph || "◎")} ${esc(node.name)}</b> ${node.region ? `<span class="tag-pill">${esc(node.region)}</span>` : ""} ${isHere ? '<span class="tag-pill">Você está aqui</span>' : ""}</div>
      <div class="muted">Perigo: ${esc(node.dangerRank || "?")} · Coord: (${node.lat.toFixed(1)}°, ${node.lon.toFixed(1)}°)</div>
      <div style="margin-top:4px;">${esc(node.summary || "")}</div>
      ${portalBtn || travelBtn}
    `;
  }

  const btn = document.getElementById("btn-travel-sphere");
  if (btn && onTravelSphere) {
    btn.addEventListener("click", () => onTravelSphere(viewingSphereId));
  }
  const pBtn = document.getElementById("btn-portal-sphere");
  if (pBtn && portalTarget && onTravelSphere) {
    pBtn.addEventListener("click", () => onTravelSphere(portalTarget.id));
  }
}
