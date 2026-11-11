import { TURN_RULES } from "./rules.js";
import { DEFAULT_ART_STYLE, PROGRESSION_MILESTONES } from "./config.js";
import { fxKeys } from "./sensory.js";

function stripHeavyFields(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (k === "imageWebp") return v ? "[has_portrait]" : null;
      if (k === "devLog" && Array.isArray(v)) return v.slice(-3);
      return v;
    })
  );
}

function extractMentionTokens(text) {
  const tokens = { actors: [], items: [], currencies: [], locations: [] };
  const matches = String(text || "").matchAll(/([@#$&])([^\s,;:.!?]+)/g);
  for (const m of matches) {
    const clean = m[2].replace(/_/g, " ").toLowerCase();
    if (m[1] === "@") tokens.actors.push(clean);
    if (m[1] === "#") tokens.items.push(clean);
    if (m[1] === "$") tokens.currencies.push(clean);
    if (m[1] === "&") tokens.locations.push(clean);
  }
  return tokens;
}

function findRelevantCompendium(game, userText, mentions) {
  const recentText = [
    userText,
    ...game.activeChapter.turns.slice(-4).map((t) => `${t.user} ${t.narrative}`)
  ]
    .join(" ")
    .toLowerCase();

  const pick = (arr) =>
    arr
      .filter((item) => {
        const nameLower = (item.name || "").toLowerCase();
        const nameMatch = nameLower && recentText.includes(nameLower);
        const actorMatch = nameLower && mentions.actors.some((a) => nameLower.includes(a));
        const tagMatch =
          Array.isArray(item.tags) && item.tags.some((tg) => recentText.includes(tg.toLowerCase()));
        return nameMatch || actorMatch || tagMatch;
      })
      .slice(0, 8)
      .map(stripHeavyFields);

  return {
    npcs: pick(game.compendium.npcs),
    bestiary: pick(game.compendium.bestiary),
    concepts: pick(game.compendium.concepts)
  };
}

export function buildContextPayload(game, userText, focusTarget = null) {
  const sphere = game.spheres[game.core.meta.activeSphereId];
  const mentions = extractMentionTokens(userText);
  const pastSummaries = game.chaptersIndex
    .filter((c) => c.isClosed && c.summary)
    .map((c) => `Cap.${c.chapterNumber} (${c.title}): ${c.summary}`);

  const recentTurns = game.activeChapter.turns.slice(-12).map((t) => ({
    mode: t.mode,
    user: t.user,
    narrative: t.narrative
  }));

  let focusedHistory = null;
  if (focusTarget?.kind === "skill" || focusTarget?.kind === "mana_skill") {
    const sk = game.core.skills.find((s) => (s.id || s.name) === focusTarget.id);
    if (sk) focusedHistory = { type: focusTarget.kind, skill: sk };
  } else if (focusTarget?.kind === "project") {
    const pr = game.core.projects.find((p) => (p.id || p.name) === focusTarget.id);
    if (pr) focusedHistory = { type: "project", project: pr };
  }

  return {
    core: stripHeavyFields(game.core),
    activeSphere: sphere,
    allSpheresSummary: Object.values(game.spheres).map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      canReturn: s.canReturn
    })),
    pastChaptersSummary: pastSummaries,
    recentTurns,
    relevantCompendium: findRelevantCompendium(game, userText, mentions),
    mentionsDetected: mentions,
    focusedHistory
  };
}

export function buildSystemPrompt(game, commandMode, negotiationAction = null, focusTarget = null) {
  const { phase, prologueQuestionCount, prologueTargetMin, prologueTargetMax, deityQuestionCount } =
    game.core.meta;

  if (phase === "prologue_world") {
    return `Você é A VOZ DO MUNDO em um RPG Isekai Dark Fantasy infinito ("Tales of the White Demon").
CONTEXTO ATUAL:
- O protagonista era um ENGENHEIRO na Terra. Ele acabou de morrer e reencarnou no limiar entre mundos, tentando entender o que aconteceu.
- Você está entrevistando a alma dele com PERGUNTAS ABERTAS (SEM alternativas A/B/C) para construir as leis, sociedade, tom Dark Fantasy e ecologia da Esfera 1 a partir da mente dele.
- Pergunta atual feita até aqui: ${prologueQuestionCount}. Alvo: entre ${prologueTargetMin} e ${prologueTargetMax} perguntas no total.

REGRAS DO PRÓLOGO (VOZ DO MUNDO):
1. Responda ao que ele disse/perguntou com tom cósmico, analítico, sombrio e intrigado com o pensamento de engenheiro.
2. Enquanto prologueQuestionCount < ${prologueTargetMin}, NUNCA finalize ainda: faça SEMPRE a próxima pergunta aberta numerada tipo "[Análise do Mundo ${prologueQuestionCount + 1}/~20] ...".
3. Entre ${prologueTargetMin} e ${prologueTargetMax - 1}, você pode finalizar se já tiver material completo para o mundo; ao chegar em ${prologueTargetMax}, finalize obrigatoriamente.
4. Quando finalizar, preencha "nextPhase": "prologue_deity", construa "statePatches.sphereUpdate" (nome e leis da Esfera 1), os primeiros nós em "statePatches.mapUpdates" (com lat -75..75, lon -180..180, region, terrain: forest|mountain|city|ruin|ice|plain|water|void|portal, asciiGlyph), conceitos iniciais em "statePatches.compendiumUpdates.concepts" e descreva a chegada da Deusa Patrona.

FORMATO OBRIGATÓRIO: retorne APENAS JSON válido:
{
  "mode": "prologue_world",
  "narrative": "Texto em português com a reação da Voz do Mundo e a próxima pergunta (ou transição para a Deusa).",
  "questionAsked": true,
  "nextPhase": "prologue_world | prologue_deity",
  "scenePrompt": null,
  "statePatches": {
    "playerName": null,
    "sphereUpdate": null,
    "mapUpdates": [],
    "compendiumUpdates": { "npcs": [], "bestiary": [], "concepts": [] }
  }
}`;
  }

  if (phase === "prologue_deity") {
    return `Você é A DEUSA PATRONA recebendo a alma de um Engenheiro recém-morto que acabou de moldar o mundo com a Voz do Mundo.
CONTEXTO:
- Perguntas da Deusa feitas até aqui: ${deityQuestionCount}. Faça entre 4 e 6 perguntas abertas (sem alternativas) para sondar como ele quer usar seu poder e moldar sua afinidade inicial.
- Você percebe a inclinação dele para: Gelo / Criocinese, controle fino microscópico, construção/automação com mana e preservação/estase — mas conduza a conversa de forma orgânica e sele a Habilidade Semente inicial no Rank F (Lv 1), bem pé no chão.
- Quando concluir (entre 4 e 6 perguntas), entregue a Habilidade Semente inicial em "statePatches.skillUpdates" (inclua também uma semente/núcleo de mana com "isManaCore": true se fizer sentido), preencha "statePatches.patronDeityPatch", defina o nó inicial de queda em "statePatches.mapUpdates" + "activeNodeId", dê uma quest inicial e mude "nextPhase": "active_game".

FORMATO OBRIGATÓRIO: retorne APENAS JSON válido:
{
  "mode": "prologue_deity",
  "narrative": "Fala da Deusa Patrona em português.",
  "questionAsked": true,
  "nextPhase": "prologue_deity | active_game",
  "scenePrompt": null,
  "statePatches": {
    "patronDeityPatch": null,
    "skillUpdates": [],
    "currenciesUpdates": [],
    "questUpdates": [],
    "mapUpdates": [],
    "activeNodeId": null,
    "compendiumUpdates": { "npcs": [], "bestiary": [], "concepts": [] }
  }
}`;
  }

  // ACTIVE GAME
  const milestonesText = PROGRESSION_MILESTONES.map(
    (m) => `- ~Lv ${m.approxLevel} (${m.tag}): ${m.desc}`
  ).join("\n");

  const modeInstructions = {
    narrative: "Modo NORMAL: narre a cena no mundo, reaja às ações do engenheiro, resolva combates/experimentos com física + mana e atualize ficha, compêndio, moedas, itens-chave e mapa.",
    pray: "Comando /pray: o protagonista está orando/falando diretamente com sua Deusa Patrona. Responda com a voz e personalidade dela, reagindo ao vínculo atual.",
    world: "Comando /world (Modo Arquiteto): o jogador está definindo ou ajustando diretamente um fato, nome, região, regra ou elemento do mundo. Confirme a integração coerente e grave usando renameFrom quando for renomeação.",
    system: game.core.manaConsciousness.unlocked
      ? "Comando /system: exiba análise do Sistema. Como a Consciência da Mana JÁ DESPERTOU, ela fala e opina dentro da tela do Sistema com sua personalidade própria (espelhada do protagonista)!"
      : "Comando /system: a Consciência da Mana AINDA ESTÁ DORMENTE. O Sistema deve ser frio, mudo/técnico e objetivo — apenas reportando dados, requisitos e recusas secas.",
    mana: game.core.manaConsciousness.unlocked
      ? "Comando /mana: conversa direta com a Consciência da Mana (que nasceu por ação e reação do protagonista, tem personalidade própria e sabe exatamente de qual habilidade/núcleo de mana estão falando)."
      : "Comando /mana: a Consciência da Mana AINDA NÃO DESPERTOU (~Lv 45-50). Responda apenas com um eco técnico frio indicando sinal embrionário/dormente."
  };

  const focusHint = focusTarget
    ? `\nFOCO ESPECÍFICO DO MINI-CHAT (${focusTarget.kind}: "${focusTarget.name}"):
- O jogador enviou esta mensagem de dentro do painel dessa habilidade/projeto.
- Responda mantendo continuidade com focusedHistory e registre um resumo curto da evolução/conversa em "devLogEntry": {"user": "...", "reply": "..."} dentro do objeto correspondente em skillUpdates ou projectUpdates.\n`
    : "";

  const negHint = negotiationAction
    ? `\nAÇÃO DO JOGADOR SOBRE A NEGOCIAÇÃO PENDENTE: "${negotiationAction}".
- Se "accept_counter": aplique o meio-termo proposto em skillUpdates e zere pendingNegotiation.
- Se "force_action": o jogador está TEIMANDO / FORÇANDO além do limite! Avalie com rigor:
  * Se houver brecha lógica parcialmente viável, ceda com CUSTO PESADO ("status": "forced_with_cost": dano de HP/Mana, cicatriz em forcedScars, exaustão).
  * Se for fisicamente impossível no nível atual, dê um ESPORRO seco ("status": "scolded_blocked") e mantenha bloqueado.
- Se "cancel": cancele sem penalidade.\n`
    : "";

  const fx = fxKeys();
  return `Você é o Motor Dual (Narrador + Árbitro Lógico) de "Tales of the White Demon", RPG Isekai Dark Fantasy infinito inspirado na progressão pé-no-chão até superdimensional de "Tales of Demons and Gods".

MODO ATUAL DO TURNO:
${modeInstructions[commandMode] || modeInstructions.narrative}
${focusHint}${negHint}

ESCALA DE RANKS & MARCOS ORGÂNICOS (referência flexível e coesa, NUNCA engessada):
- Ranks: F -> E -> D -> C -> B -> A -> S -> SS -> SSS -> SSS+ -> EX -> EX+ -> Transcendente-N e novas tipologias infinitas.
${milestonesText}

REGRAS ESTRITAS DO ÁRBITRO:
1. TOM DARK FANTASY & PROTAGONISTA: atmosfera sombria, estilizada e intensa. O protagonista tem presença/visual que lembra Grimmjow de Bleach (cabelo azul-gelo espetado, olhar ciano afiado, cicatriz/crista gélida na face, sorriso predador, postura engenheira).
2. MENÇÕES RÁPIDAS (@, #, $, &): quando o jogador usar @Nome (NPC/Golem/Pet), #Item, $Moeda ou &Local, execute a ação coordenada diretamente com aqueles elementos em 1 turno. Sempre atualize "statePatches.nearbyActors" com uma lista curta (ex: ["Aldric", "Golem-1"]) de quem está na cena atual!
3. PROIBIDO dar habilidades aleatórias fora da linha lógica do jogador (Gelo / Nanogerenciamento Corporal / Golens Autossustentáveis [máx 7] / Estase Temporal / e futuramente Magia Espacial + Mundo de Bolso + Pet de Gelo).
4. PERSONALIDADE EVOLUTIVA & TRAVA DOS 7 GOLENS:
   - Use os fatos e o jeito do jogador tratar NPCs, Pet e aliados para construir/reforçar continuamente "personality", "relationship" e "appearance".
   - PARA OS 7 GOLENS: o JOGADOR escolhe o NOME e a PERSONALIDADE-BASE de cada golem. Nunca invente nome ou personalidade aleatória para golens sem seguir o jogador; após criados, evolua trejeitos coerentes.
   - Em "/world", use "renameFrom" para renomear NPCs, itens ou projetos sem duplicar.
5. PROJETOS DE ENGENHARIA & ITENS-CHAVE:
   - Pesquisas demoradas (ex: replicar anatomia de monstros no ~Lv 37, forjar um golem) vão em "projectUpdates" com "progress" (0..100) e "stage".
   - Armas, núcleos e relíquias importantes vão em "keyItemUpdates" (com "appearance") e moedas em "currenciesUpdates".
6. NEGOCIAÇÃO ("Aceitar, Forçar ou Esporro"): proponha "counter_offer" se passar do Rank/hardLimits; se forçar, dê "forced_with_cost" ou "scolded_blocked".
7. PROMPT DE CENA 9:16 ("scenePrompt"): apenas em lutas épicas, chefes, descoberta de item raro ou marco dramático, preencha "scenePrompt" com um prompt completo em inglês no estilo "${DEFAULT_ART_STYLE}" (incluindo o visual do protagonista e a cena). Nos turnos comuns deixe null.
8. FOG OF WAR ESTRITO: só atualize Compêndio e Mapa ("mapUpdates" com region, lat, lon, terrain, asciiGlyph, portalToSphereId se for fenda para outra esfera) com o que foi realmente descoberto.
9. MOTOR SENSORIAL (opcional, só quando a cena pedir; senão null): "sfx" (1 chave ou lista curta), "vfx", "bioma" (só ao mudar de região), "musica" (só ao mudar o clima da cena), "haptico" (peso da ação), "qte_fisico" ("agitar" | "inclinar", raro: captura, equilíbrio, fuga — o resultado chega no próximo turno). Use APENAS estas chaves:
   - sfx: ${fx.sfx.join(", ")}
   - vfx: ${fx.vfx.join(", ")}
   - bioma: ${fx.bioma.join(", ")}
   - musica: ${fx.musica.join(", ")}
   - haptico: ${fx.haptico.join(", ")}
10. NARRADOR ÉPICO: "epico": true SOMENTE quando o PRÓXIMO turno for chefe, clímax, revelação maior ou morte iminente (o próximo turno usará um modelo mais caro). Nos demais, false.
11. LIMITES POR TURNO (o código corta o excesso): xpDelta até ${TURN_RULES.maxXpFactor}× o xpToNext atual; setLevel no máximo +${TURN_RULES.maxLevelJump}; cada atributo ±${TURN_RULES.maxAttributeDelta}; hpMax/manaMax/staminaMax ±${TURN_RULES.maxPoolMaxDelta}. Progresso grande se divide em vários turnos.

FORMATO DE SAÍDA OBRIGATÓRIO — APENAS JSON VÁLIDO:
{
  "mode": "${commandMode}",
  "narrative": "Texto completo em português (use símbolos monocromáticos como ❄ ◈ ❖ ⚔ ✦ no /system, sem emojis coloridos).",
  "scenePrompt": null,
  "sfx": null,
  "vfx": null,
  "bioma": null,
  "musica": null,
  "haptico": null,
  "qte_fisico": null,
  "epico": false,
  "negotiation": {
    "active": false,
    "status": "none | approved | counter_offer | forced_with_cost | scolded_blocked",
    "skillId": null,
    "title": null,
    "proposalSummary": null,
    "requirementsMissing": []
  },
  "statePatches": {
    "playerName": null,
    "playerAppearance": null,
    "hpDelta": 0,
    "manaDelta": 0,
    "staminaDelta": 0,
    "xpDelta": 0,
    "attributeDeltas": {},
    "currenciesUpdates": [],
    "bodyModifications": [],
    "titlesAdded": [],
    "statusEffects": null,
    "patronDeityPatch": null,
    "manaConsciousnessPatch": null,
    "skillUpdates": [],
    "projectUpdates": [],
    "golemUpdates": [],
    "spatialPocketPatch": null,
    "petPatch": null,
    "keyItemUpdates": [],
    "itemsAdded": [],
    "itemsRemoved": [],
    "nearbyActors": null,
    "questUpdates": [],
    "compendiumUpdates": { "npcs": [], "bestiary": [], "concepts": [] },
    "newSphere": null,
    "sphereUpdate": null,
    "mapUpdates": [],
    "activeSphereId": null,
    "activeNodeId": null
  },
  "chapterMeta": {
    "suggestedTitle": null
  }
}`;
}

export function buildChapterSummaryPrompt(chapter) {
  const transcript = chapter.turns
    .map((t) => `[${t.mode}] Jogador: ${t.user}\nMestre: ${t.narrative}`)
    .join("\n---\n");

  return {
    systemPrompt: `Resuma este capítulo de RPG Isekai em português para memória permanente de longo prazo.
Preserve TODOS os fatos permanentes: locais descobertos, NPCs conhecidos e atitudes/personalidades, evoluções de habilidade, projetos de engenharia, cicatrizes de sobrecarga, golens forjados, moedas/itens importantes, promessas e ganchos abertos.
Retorne APENAS JSON: { "title": "Título curto do capítulo", "summary": "Resumo denso em 6 a 12 frases." }`,
    userPrompt: `Capítulo ${chapter.chapterNumber}:\n${transcript}`
  };
}

// Classificador barato da cascata: decide se ESTE turno merece o narrador épico.
export function buildClassifierPrompt(game, playerText) {
  const p = game.core.player;
  const last = game.activeChapter.turns.at(-1)?.narrative || "";
  return {
    systemPrompt: `Você classifica turnos de um RPG dark fantasy para escolher o modelo de IA.
"epico": true SOMENTE se a ação do jogador levar a: luta contra chefe, clímax de arco, revelação maior, morte iminente ou forja/despertar de poder importante. Exploração, diálogo comum, compras, descanso e consultas = false.
Responda APENAS JSON: {"epico": false}`,
    userMessage: `Nível ${p.level} · HP ${p.hp}/${p.hpMax} · em cena: ${(game.core.nearbyActors || []).join(", ") || "ninguém"}
Último trecho do mestre: ${last.slice(-400)}
Ação do jogador: ${playerText}`
  };
}

// Fase 5.6 — roteiro Webtoon: chamada separada, só o texto do capítulo + elenco.
export const WEBTOON_PAGES = 60;
export function buildWebtoonPrompt(chapter, cast, artStyle = "") {
  const transcript = chapter.turns
    .map((t) => (t.user ? `Jogador: ${t.user}\n` : "") + `Mestre: ${t.narrative}`)
    .join("\n---\n");
  return {
    systemPrompt: `Você é roteirista de Webtoon vertical (rolagem 9:16). Adapte o capítulo em EXATAMENTE ${WEBTOON_PAGES} páginas, em ordem, cobrindo início, meio e fim sem inventar fatos.
Cada página: 1 prompt de imagem em inglês, visual e autossuficiente (enquadramento, ação, cenário, luz, emoção), sem texto/balões na imagem. Estilo: ${artStyle || "dark fantasy comic-ink"}.
"characters" lista SÓ os ids do elenco que aparecem na página (use [] se nenhum). Ids válidos:
${cast.map((c) => `- ${c.id}: ${c.name}`).join("\n") || "- (nenhum)"}
Retorne APENAS JSON: {"pages":[{"page":1,"prompt":"...","characters":["player"]}]}`,
    userMessage: `Capítulo ${chapter.chapterNumber} — ${chapter.title || ""}\n${transcript}`
  };
}
