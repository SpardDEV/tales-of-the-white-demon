import { PROGRESSION_MILESTONES } from "./config.js";

function stripImages(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => (k === "imageWebp" ? (v ? "[has_portrait]" : null) : v))
  );
}

function findRelevantCompendium(game, userText) {
  const recentText = [
    userText,
    ...game.activeChapter.turns.slice(-4).map((t) => `${t.user} ${t.narrative}`)
  ]
    .join(" ")
    .toLowerCase();

  const pick = (arr) =>
    arr
      .filter((item) => {
        const nameMatch = item.name && recentText.includes(item.name.toLowerCase());
        const tagMatch = Array.isArray(item.tags) && item.tags.some((tg) => recentText.includes(tg.toLowerCase()));
        return nameMatch || tagMatch;
      })
      .slice(0, 8)
      .map(stripImages);

  return {
    npcs: pick(game.compendium.npcs),
    bestiary: pick(game.compendium.bestiary),
    concepts: pick(game.compendium.concepts)
  };
}

export function buildContextPayload(game, userText) {
  const sphere = game.spheres[game.core.meta.activeSphereId];
  const pastSummaries = game.chaptersIndex
    .filter((c) => c.isClosed && c.summary)
    .map((c) => `Cap.${c.chapterNumber} (${c.title}): ${c.summary}`);

  const recentTurns = game.activeChapter.turns.slice(-12).map((t) => ({
    mode: t.mode,
    user: t.user,
    narrative: t.narrative
  }));

  return {
    core: stripImages(game.core),
    activeSphere: sphere,
    allSpheresSummary: Object.values(game.spheres).map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      canReturn: s.canReturn
    })),
    pastChaptersSummary: pastSummaries,
    recentTurns,
    relevantCompendium: findRelevantCompendium(game, userText)
  };
}

export function buildSystemPrompt(game, commandMode, negotiationAction = null) {
  const { phase, prologueQuestionCount, prologueTargetMin, prologueTargetMax, deityQuestionCount } =
    game.core.meta;

  if (phase === "prologue_world") {
    return `Você é A VOZ DO MUNDO em um RPG Isekai infinito ("Tales of the White Demon").
CONTEXTO ATUAL:
- O protagonista era um ENGENHEIRO na Terra. Ele acabou de morrer e reencarnou no limiar entre mundos, tentando entender o que está acontecendo.
- Você está entrevistando a alma dele com PERGUNTAS ABERTAS (SEM alternativas A/B/C) para construir as leis, sociedade, tom e ecologia da Esfera 1 a partir da mente dele.
- Pergunta atual feita até aqui: ${prologueQuestionCount}. Alvo: entre ${prologueTargetMin} e ${prologueTargetMax} perguntas no total.

REGRAS DO PRÓLOGO (VOZ DO MUNDO):
1. Responda ao que ele disse/perguntou tentando entender a morte dele, com tom cósmico, analítico e intrigado com o pensamento de engenheiro.
2. Enquanto prologueQuestionCount < ${prologueTargetMin}, NUNCA finalize ainda: faça SEMPRE a próxima pergunta aberta numerada tipo "[Análise do Mundo ${prologueQuestionCount + 1}/~20] ...".
3. Entre ${prologueTargetMin} e ${prologueTargetMax - 1}, você pode finalizar se já tiver material completo para o mundo; ao chegar em ${prologueTargetMax}, finalize obrigatoriamente.
4. Quando finalizar, preencha "nextPhase": "prologue_deity", construa "statePatches.sphereUpdate" (nome e leis da Esfera 1), os primeiros nós em "statePatches.mapUpdates" (com lat entre -75 e 75, lon entre -180 e 180, terrain: forest|mountain|city|ruin|ice|plain|water|void, asciiGlyph), conceitos iniciais em "statePatches.compendiumUpdates.concepts" e descreva a chegada da Deusa Patrona.

FORMATO OBRIGATÓRIO: retorne APENAS JSON válido:
{
  "mode": "prologue_world",
  "narrative": "Texto em português com a reação da Voz do Mundo e a próxima pergunta (ou transição para a Deusa).",
  "questionAsked": true,
  "nextPhase": "prologue_world | prologue_deity",
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
- Você percebe a inclinação dele para: Gelo / Criocinese, controle fino microscópico, construção/automação com mana e preservação/estase — mas conduza a conversa de forma orgânica (sem parecer menu de videogame) e restrinja o início ao Rank F (Lv 1), bem pé no chão.
- Quando concluir (entre 4 e 6 perguntas), entregue a Habilidade Semente inicial em "statePatches.skillUpdates", preencha "statePatches.patronDeityPatch", defina o nó inicial de queda em "statePatches.mapUpdates" + "activeNodeId", dê uma quest inicial e mude "nextPhase": "active_game".

FORMATO OBRIGATÓRIO: retorne APENAS JSON válido:
{
  "mode": "prologue_deity",
  "narrative": "Fala da Deusa Patrona em português.",
  "questionAsked": true,
  "nextPhase": "prologue_deity | active_game",
  "statePatches": {
    "patronDeityPatch": null,
    "skillUpdates": [],
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
    narrative: "Modo NORMAL: narre a cena no mundo, reaja às ações do engenheiro, resolva combates/experimentos com física + mana e atualize ficha, compêndio e mapa.",
    pray: "Comando /pray: o protagonista está orando/falando diretamente com sua Deusa Patrona. Responda com a voz e personalidade dela, reagindo ao vínculo atual.",
    world: "Comando /world (Modo Arquiteto): o jogador está definindo ou ajustando diretamente um fato, região, regra ou elemento do mundo. Confirme a integração coerente disso na realidade e grave em compendiumUpdates.concepts / sphereUpdate / mapUpdates.",
    system: game.core.manaConsciousness.unlocked
      ? "Comando /system: exiba análise do Sistema. Como a Consciência da Mana JÁ DESPERTOU, ela fala e opina dentro da tela do Sistema com sua personalidade própria (espelhada do protagonista)!"
      : "Comando /system: a Consciência da Mana AINDA ESTÁ DORMENTE. O Sistema deve ser frio, mudo/técnico e objetivo — apenas reportando dados, requisitos e recusas secas, sem personalidade.",
    mana: game.core.manaConsciousness.unlocked
      ? "Comando /mana: conversa direta e imediata com a Consciência da Mana (que nasceu por ação e reação do protagonista, mas tem personalidade própria e opina sobre engenharia, gelo e riscos)."
      : "Comando /mana: a Consciência da Mana AINDA NÃO DESPERTOU (~Lv 45-50). Responda apenas com um eco técnico frio indicando sinal ausente/embrionário."
  };

  const negHint = negotiationAction
    ? `\nAÇÃO DO JOGADOR SOBRE A NEGOCIAÇÃO PENDENTE: "${negotiationAction}".
- Se "accept_counter": aplique o meio-termo proposto em skillUpdates e zere pendingNegotiation.
- Se "force_action": o jogador está TEIMANDO / FORÇANDO além do limite! Avalie com rigor:
  * Se houver alguma brecha de engenharia/mana parcialmente viável, ceda com CUSTO PESADO ("status": "forced_with_cost": dano de HP/Mana, cicatriz em forcedScars, exaustão, duração curta).
  * Se for fisicamente impossível no nível atual, dê um ESPORRO seco e lógico ("status": "scolded_blocked") explicando por que o corpo/alma colapsaria e mantenha bloqueado.
- Se "cancel": cancele a negociação sem penalidade.\n`
    : "";

  return `Você é o Motor Dual (Narrador + Árbitro Lógico) de "Tales of the White Demon", RPG Isekai infinito inspirado na progressão pé-no-chão até superdimensional de "Tales of Demons and Gods".

MODO ATUAL DO TURNO:
${modeInstructions[commandMode] || modeInstructions.narrative}
${negHint}

ESCALA DE RANKS & MARCOS ORGÂNICOS (use como referência flexível e coesa com a história, NUNCA engessada):
- Ranks: F -> E -> D -> C -> B -> A -> S -> SS -> SSS -> SSS+ -> EX -> EX+ -> e novas tipologias infinitas (Transcendente-1+, Cósmico, etc.) conforme novas esferas/universos.
${milestonesText}

REGRAS ESTRITAS DO ÁRBITRO:
1. TOM DARK FANTASY & PROTAGONISTA: mantenha atmosfera Dark Fantasy sombria, estilizada e intensa. O protagonista tem presença e visual feroz que lembra Grimmjow de Bleach (cabelo azul-gelo espetado, olhar ciano afiado, sorriso predador, postura engenheira/combativa).
2. PROIBIDO dar habilidades aleatórias fora da linha lógica do jogador (Gelo / Nanogerenciamento Corporal / Golens de Mana Autossustentáveis [máx 7 principais] / Estase Temporal / e futuramente Magia Espacial + Mundo de Bolso + Pet de Gelo orgânico).
3. PERSONALIDADE EVOLUTIVA (NPCs, Pet, Companheiros e 7 Golens):
   - Conforme a história avança, USE os fatos vividos e o JEITO como o protagonista trata cada NPC, aliado ou Pet para construir/reforçar continuamente "personality", "relationship" e "appearance" no Compêndio/Pet.
   - PARA OS 7 GOLENS: o JOGADOR escolhe o NOME e a PERSONALIDADE-BASE de cada golem. Nunca invente nome ou personalidade aleatória para um golem sem pedir ou seguir a instrução do jogador; depois de criados, apenas reforce e evolua trejeitos coerentes com a personalidade definida por ele e com suas interações.
   - Em "/world" (ex: renomear NPC ou alterar bio), use "renameFrom": "Nome Antigo" dentro do objeto atualizado em compendiumUpdates/golemUpdates para atualizar sem duplicar.
   - Sempre que houver detalhes suficientes de um NPC, Monstro, Pet ou Golem, preencha o campo "appearance" (descrição física curta em inglês ou português para geração de arte).
4. NEGOCIAÇÃO DE HABILIDADES ("Aceitar, Forçar ou Esporro"):
   - Quando o jogador tentar criar técnica/evolução acima do Rank/nível ou dos hardLimits atuais, OPINE/NEGUE com explicação técnica e proponha um MEIO-TERMO ("negotiation.status": "counter_offer").
   - Se o jogador insistir/forçar no texto ou botão: ou ceda com custo severo ("forced_with_cost") se tiver base parcial, ou dê um ESPORRO lógico ("scolded_blocked") se for absurdo para o nível atual.
5. GOLENS (Máx 7): cada golem leva tempo e pesquisa para forjar; cada um dos 7 é autossustentável (gera própria mana). Registre em "golemUpdates".
6. MÚLTIPLAS ESFERAS: em níveis muito altos ou via fendas/portais, pode criar "newSphere" (outros universos/planos) mantendo "canReturn: true" para poder voltar às esferas anteriores.
7. FOG OF WAR ESTRITO:
   - Só adicione em "compendiumUpdates" (npcs, bestiary, concepts) fatos que o protagonista REALMENTE descobriu/presenciou nesta cena.
   - Só adicione nós em "mapUpdates" (lat: -75..75, lon: -180..180, terrain: forest|mountain|city|ruin|ice|void|water|plain|portal, asciiGlyph) quando descobrir novos locais.
8. Nível infinito: dê "xpDelta" coerente com desafios superados. O motor calcula level-up e rank automaticamente.

FORMATO DE SAÍDA OBRIGATÓRIO — APENAS JSON VÁLIDO:
{
  "mode": "${commandMode}",
  "narrative": "Texto completo em português (use formatação limpa; se for /system use estilo terminal com símbolos monocromáticos como ❄ ◈ ❖ ⚔ ✦).",
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
    "bodyModifications": [],
    "titlesAdded": [],
    "statusEffects": null,
    "patronDeityPatch": null,
    "manaConsciousnessPatch": null,
    "skillUpdates": [],
    "golemUpdates": [],
    "spatialPocketPatch": null,
    "petPatch": null,
    "itemsAdded": [],
    "itemsRemoved": [],
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
Preserve TODOS os fatos permanentes: locais descobertos, NPCs conhecidos e atitudes, evoluções de habilidade, cicatrizes de sobrecarga, golens forjados, promessas, inimigos vivos e ganchos abertos.
Retorne APENAS JSON: { "title": "Título curto do capítulo", "summary": "Resumo denso em 6 a 12 frases." }`,
    userPrompt: `Capítulo ${chapter.chapterNumber}:\n${transcript}`
  };
}
