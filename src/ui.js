import { getChapterLocal } from "./state.js";
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
      `📊 Consumo Medido (Dia ${usage.dayKey}):\n` +
      `• Gemini Flash: ${usage.geminiRequests} reqs hoje (${rpm}/${settings.geminiRpmLimit} RPM no último min)\n` +
      `• Tokens Gemini reais (usageMetadata): ${usage.geminiTokens.toLocaleString("pt-BR")} / ${tpdLimit.toLocaleString("pt-BR")}\n` +
      `• Save atual estimado: ${(usage.estimatedBytes / 1024).toFixed(1)} KB (${usedMb.toFixed(3)} MB / ${sbLimitMb} MB)\n` +
      `• Chamadas Supabase na sessão/dia: ${usage.supabaseRequests || 0}`;
  }
}

export function renderPrologueBanner(game) {
  const banner = document.getElementById("prologue-banner");
  const { phase, prologueQuestionCount, prologueTargetMax, deityQuestionCount } = game.core.meta;
  if (phase === "prologue_world") {
    banner.classList.remove("hidden");
    banner.textContent = `🌌 Prólogo — Voz do Mundo (${prologueQuestionCount}/${prologueTargetMax} perguntas abertas · Construindo leis do mundo)`;
  } else if (phase === "prologue_deity") {
    banner.classList.remove("hidden");
    banner.textContent = `✨ Prólogo — Deusa Patrona (${deityQuestionCount} perguntas · Moldando afinidade de Gelo)`;
  } else {
    banner.classList.add("hidden");
  }
}

const MODE_LABELS = {
  prologue_world: { label: "🌌 Voz do Mundo", cls: "msg-world" },
  prologue_deity: { label: "✨ Deusa Patrona", cls: "msg-pray" },
  pray: { label: "🙏 Deusa Patrona (/pray)", cls: "msg-pray" },
  world: { label: "🌍 Arquiteto do Mundo (/world)", cls: "msg-world" },
  system: { label: "🖥️ Tela do Sistema (/system)", cls: "msg-system" },
  mana: { label: "💠 Consciência da Mana (/mana)", cls: "msg-mana" },
  narrative: { label: "📖 Crônica", cls: "" },
  error: { label: "⚠️ Aviso", cls: "msg-error" }
};

export function renderChatLog(game, transientMessages = []) {
  const log = document.getElementById("chat-log");
  const turns = game.activeChapter.turns || [];
  let html = "";

  if (!turns.length && !transientMessages.length) {
    html += `<div class="msg msg-ai msg-world">
      <div class="msg-tag">❄️ Bem-vindo</div>
      Configure sua <b>Gemini API Key</b> em ⚙️ no topo para iniciar o Prólogo com a <b>Voz do Mundo</b> (ou envie qualquer mensagem após configurar).
    </div>`;
  }

  for (const t of turns) {
    if (t.user) {
      html += `<div class="msg msg-user">${esc(t.user)}</div>`;
    }
    if (t.narrative) {
      const m = MODE_LABELS[t.mode] || MODE_LABELS.narrative;
      html += `<div class="msg msg-ai ${m.cls}">
        <div class="msg-tag">${m.label}</div>${esc(t.narrative)}
      </div>`;
    }
  }

  for (const tm of transientMessages) {
    const m = MODE_LABELS[tm.mode] || MODE_LABELS.error;
    html += `<div class="msg msg-ai ${m.cls}">
      <div class="msg-tag">${m.label}</div>${esc(tm.text)}
    </div>`;
  }

  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
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
    `⚖️ ${neg.title || "Negociação de Evolução / Limite"}`;
  const missing = neg.requirementsMissing?.length
    ? `\nRequisitos pendentes: ${neg.requirementsMissing.join(", ")}`
    : "";
  document.getElementById("negotiation-desc").textContent =
    `${neg.proposalSummary || "Proposta fora do patamar atual."}${missing}`;
}

export function renderSheet(game) {
  const { player, patronDeity, manaConsciousness, skills, golems, spatialPocket, pet, inventory } =
    game.core;
  const el = document.getElementById("sheet-content");

  const attrLines = Object.entries(player.attributes)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");

  const statusText =
    `❄️ PERSONAGEM: ${player.name}\n` +
    `🧬 Origem: ${player.origin}\n` +
    `🏅 Rank: ${player.rank}  |  Nível: ${player.level}\n` +
    `✨ XP: ${player.xp} / ${player.xpToNext} [${textMeter(player.xp, player.xpToNext)}]\n` +
    `❤️ HP:   ${player.hp}/${player.hpMax} [${textMeter(player.hp, player.hpMax)}]\n` +
    `💧 Mana: ${player.mana}/${player.manaMax} [${textMeter(player.mana, player.manaMax)}]\n` +
    `⚡ Est.: ${player.stamina}/${player.staminaMax} [${textMeter(player.stamina, player.staminaMax)}]\n\n` +
    `📐 ATRIBUTOS:\n${attrLines}\n` +
    (player.titles.length ? `\n🏷️ Títulos: ${player.titles.join(" · ")}` : "") +
    (player.bodyModifications.length
      ? `\n🧊 Modificações Corporais: ${player.bodyModifications.join(", ")}`
      : "");

  const manaCard = manaConsciousness.unlocked
    ? `<div class="card">
        <h3>💠 Consciência da Mana: ${esc(manaConsciousness.name || "Eco Criogênico")}</h3>
        <div class="muted">Despertou no Lv. ${manaConsciousness.awakenedAtLevel} · Sincronia: ${manaConsciousness.sync}%</div>
        <p style="margin:6px 0 4px;font-size:0.85rem;">${esc(manaConsciousness.personality)}</p>
        ${manaConsciousness.lastRemarks?.length
          ? `<pre class="pre-sheet">💬 "${esc(manaConsciousness.lastRemarks[0])}"</pre>`
          : ""}
      </div>`
    : `<div class="card">
        <h3>💠 Consciência da Mana (Dormente)</h3>
        <div class="muted">Ainda não nasceu por ação e reação (~Lv 45-50). O /system permanece mudo e objetivo.</div>
      </div>`;

  const skillsHtml = skills.length
    ? skills
        .map(
          (s) => `<div class="card skill-card">
            <h3>❄️ ${esc(s.name)} <span class="tag-pill">Tier ${esc(s.tier || "?")} · Lv.${s.level || 1}</span></h3>
            <div style="font-size:0.83rem;margin-bottom:4px;"><b>Escopo Atual:</b> ${esc(s.currentScope || "—")}</div>
            <div style="font-size:0.82rem;color:#fbbf24;margin-bottom:4px;"><b>Trava Lógica:</b> ${esc(s.hardLimits || "—")}</div>
            ${Array.isArray(s.evolutionNorth) && s.evolutionNorth.length
              ? `<div style="font-size:0.8rem;" class="muted"><b>Norte Evolutivo:</b> ${s.evolutionNorth.map(esc).join(" → ")}</div>`
              : ""}
            ${Array.isArray(s.forcedScars) && s.forcedScars.length
              ? `<div style="font-size:0.8rem;color:#f87171;margin-top:4px;">⚠️ Sobrecargas: ${s.forcedScars.map(esc).join(" | ")}</div>`
              : ""}
          </div>`
        )
        .join("")
    : `<div class="card"><div class="muted">Nenhuma habilidade selada ainda. Complete o Prólogo com a Deusa Patrona.</div></div>`;

  const golemSlots = [];
  for (let i = 0; i < golems.maxSlots; i++) {
    const g = golems.items[i];
    golemSlots.push(
      g
        ? `Slot ${i + 1}: 🗿 ${g.name} [Rank ${g.rank || "?"}] · Mana Própria: ${g.manaPool || "Autossustentável"} · ${g.status || "Ativo"}`
        : `Slot ${i + 1}: [ Vazio — Forja de longo prazo ]`
    );
  }

  const pocketHtml = spatialPocket.unlocked
    ? `<pre class="pre-sheet">🌌 ${esc(spatialPocket.name)}\n💧 Mana Estocada: ${spatialPocket.storedMana} / ${spatialPocket.storedManaCap}\n🗿 Golens Guardados: ${(spatialPocket.golemsInside || []).join(", ") || "Nenhum"}\n🗡️ Arsenal: ${(spatialPocket.storedItems || []).join(", ") || "Vazio"}</pre>`
    : `<div class="muted">Bloqueado — reservado para o desbloqueio orgânico de Magia Espacial (~Lv 400).</div>`;

  const petHtml = pet.unlocked
    ? `<pre class="pre-sheet">🐾 ${esc(pet.name || "Companheiro")} (${esc(pet.species || "Criatura de Gelo")})\n🏅 Rank: ${esc(pet.rank || "?")} · Vínculo: ${pet.bond || 0}%\n❄️ Habilidades: ${(pet.abilities || []).join(", ") || "—"}\n📝 ${esc(pet.notes || "")}</pre>`
    : `<div class="muted">Nenhum companheiro criogênico vinculado ainda.</div>`;

  el.innerHTML = `
    <div class="card"><h3>📊 Tela do Sistema (/system)</h3><pre class="pre-sheet">${esc(statusText)}</pre></div>
    ${manaCard}
    <div class="card"><h3>✨ Deusa Patrona</h3><pre class="pre-sheet">🙏 ${esc(patronDeity.name)} · Domínio: ${esc(patronDeity.domain)}\n🤝 Vínculo: ${patronDeity.bond} · Postura: ${esc(patronDeity.disposition)}</pre></div>
    <h3 style="font-size:0.9rem;color:var(--ice);margin:10px 2px 6px;">❄️ Habilidades</h3>
    ${skillsHtml}
    <div class="card"><h3>🗿 7 Golens Autossustentáveis (${golems.items.length}/7)</h3><pre class="pre-sheet">${esc(golemSlots.join("\n"))}</pre></div>
    <div class="card"><h3>🌌 Mundo de Bolso (Magia Espacial)</h3>${pocketHtml}</div>
    <div class="card"><h3>🐾 Pet de Gelo</h3>${petHtml}</div>
    <div class="card"><h3>🎒 Inventário</h3><pre class="pre-sheet">${inventory.length ? esc(inventory.map((i) => `• ${i}`).join("\n")) : "Mochila vazia."}</pre></div>
  `;
}

export function renderQuests(game) {
  const { active, completed } = game.core.quests;
  const el = document.getElementById("quests-content");
  const renderList = (arr, emptyMsg) =>
    arr.length
      ? arr
          .map(
            (q) => `<div class="card">
              <h3>${q.status === "completed" ? "✅" : "📜"} ${esc(q.title)}</h3>
              <div style="font-size:0.84rem;">${esc(q.description || "")}</div>
              ${q.reward ? `<div class="muted" style="margin-top:4px;">🎁 ${esc(q.reward)}</div>` : ""}
            </div>`
          )
          .join("")
      : `<div class="card"><div class="muted">${emptyMsg}</div></div>`;

  el.innerHTML = `
    <h3 style="font-size:0.9rem;color:var(--ice);margin:0 0 8px;">🔥 Quests Ativas</h3>
    ${renderList(active, "Nenhuma quest ativa no momento.")}
    <h3 style="font-size:0.9rem;color:var(--muted);margin:14px 0 8px;">🏁 Concluídas</h3>
    ${renderList(completed, "Nenhuma quest concluída ainda.")}
  `;
}

export async function renderCompendium(game, settings, activeSubtab, query = "") {
  const el = document.getElementById("compendium-content");
  const q = query.trim().toLowerCase();

  if (activeSubtab === "chapters") {
    const list = [...game.chaptersIndex].reverse();
    el.innerHTML = list.length
      ? list
          .map(
            (c) => `<div class="card">
              <h3>📚 Cap. ${c.chapterNumber}: ${esc(c.title || "Sem título")} ${c.isClosed ? "🔒" : "🟢"}</h3>
              <div class="muted">Turnos: ${c.turnCount}</div>
              <p style="font-size:0.84rem;margin:6px 0;">${esc(c.summary || "Capítulo em andamento...")}</p>
              <button class="btn btn-ghost btn-sm btn-read-chapter" data-ch="${esc(c.chapterId)}">📖 Ler Turnos</button>
              <div id="ch-preview-${esc(c.chapterId)}" style="margin-top:8px;"></div>
            </div>`
          )
          .join("")
      : `<div class="card"><div class="muted">Nenhum capítulo registrado.</div></div>`;

    el.querySelectorAll(".btn-read-chapter").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const chId = btn.dataset.ch;
        const target = document.getElementById(`ch-preview-${chId}`);
        target.innerHTML = `<span class="muted">Carregando...</span>`;
        let ch = chId === game.activeChapter.chapterId
          ? game.activeChapter
          : await getChapterLocal(chId);
        if (!ch) {
          ch = await fetchChapterOnDemand(settings, chId, game.usage).catch(() => null);
        }
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
      return `<div class="card">
        <h3>${esc(item.name)} ${item.rank ? `<span class="tag-pill">${esc(item.rank)}</span>` : ""}</h3>
        ${item.role || item.species || item.category
          ? `<div class="muted" style="margin-bottom:5px;">${esc(item.role || item.species || item.category)}</div>`
          : ""}
        <pre class="pre-sheet">${esc(facts)}</pre>
      </div>`;
    })
    .join("");
}

export function renderSphereSelector(game, viewingSphereId, onTravel) {
  const select = document.getElementById("sphere-select");
  const spheres = Object.values(game.spheres);
  select.innerHTML = spheres
    .map(
      (s) =>
        `<option value="${esc(s.id)}" ${s.id === viewingSphereId ? "selected" : ""}>` +
        `🌐 ${esc(s.name)}${s.id === game.core.meta.activeSphereId ? " (Atual)" : ""}` +
        `</option>`
    )
    .join("");
}

export function renderMapNodeCard(game, viewingSphereId, node, onTravelSphere) {
  const card = document.getElementById("map-node-card");
  const sphere = game.spheres[viewingSphereId];
  const isOtherSphere = viewingSphereId !== game.core.meta.activeSphereId;

  const travelBtn = isOtherSphere && sphere?.canReturn
    ? `<button id="btn-travel-sphere" class="btn btn-mana btn-sm" style="margin-top:8px;">🌀 Viajar / Retornar para esta Esfera</button>`
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
      <div><b>${esc(node.asciiGlyph || "◎")} ${esc(node.name)}</b> ${isHere ? '<span class="tag-pill">Você está aqui</span>' : ""}</div>
      <div class="muted">Perigo: ${esc(node.dangerRank || "?")} · Coord: (${node.lat.toFixed(1)}°, ${node.lon.toFixed(1)}°)</div>
      <div style="margin-top:4px;">${esc(node.summary || "")}</div>
      ${travelBtn}
    `;
  }

  const btn = document.getElementById("btn-travel-sphere");
  if (btn && onTravelSphere) {
    btn.addEventListener("click", () => onTravelSphere(viewingSphereId));
  }
}
