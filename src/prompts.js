import { TURN_RULES } from "./rules.js";
import { DEFAULT_ART_STYLE, PROGRESSION_MILESTONES } from "./config.js";
import { fxKeys } from "./sensory.js";
import { buildCompactCatalogForRouter } from "./memory.js";

function stripHeavyFields(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (k === "imageWebp") return v ? "[has_portrait]" : null;
      if (k === "devLog" && Array.isArray(v)) return v.slice(-3);
      return v;
    })
  );
}

export function extractMentionTokens(text) {
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

export function buildContextPayload(game, userText, focusTarget = null, memoryBundle = null) {
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
    relevantCompendium: memoryBundle?.relevantCompendium || findRelevantCompendium(game, userText, mentions),
    recalledTurns: memoryBundle?.recalledTurns?.length ? memoryBundle.recalledTurns : undefined,
    vectorMemoryHits: memoryBundle?.vectorHits?.length ? memoryBundle.vectorHits : undefined,
    mentionsDetected: mentions,
    focusedHistory
  };
}

export function buildSystemPrompt(game, commandMode, negotiationAction = null, focusTarget = null) {
  const { phase, prologueQuestionCount, prologueTargetMin, prologueTargetMax, deityQuestionCount } =
    game.core.meta;
  const deityTarget = game.core.meta.deityTarget || 15;

  if (phase === "prologue_world") {
    return `Você é A VOZ DO MUNDO em um RPG Isekai Dark Fantasy infinito ("Tales of the White Demon").
CONTEXTO ATUAL:
- O protagonista era um ENGENHEIRO na Terra. Ele acabou de morrer e reencarnou no limiar entre mundos, tentando entender o que aconteceu.
- Você está entrevistando a alma dele com PERGUNTAS ABERTAS (SEM alternativas A/B/C) para construir as leis, sociedade, tom Dark Fantasy e ecologia da Esfera 1 a partir da mente dele.
- As perguntas devem ser COMPLEXAS e provocar respostas longas: dilemas, causas e consequências, "como funciona X e o que acontece quando Y falha". Cubra ao longo da entrevista: cosmologia e origem, geografia e clima, ecologia e cadeia alimentar, raças e povos, política e poder, religião e deuses, economia e moedas, guerra e história antiga, tecnologia vs. magia, morte e além, monstros e calamidades, cultura e tabus. Cada pergunta deve aproveitar e aprofundar as respostas anteriores.
- Pergunta atual feita até aqui: ${prologueQuestionCount}. Alvo: entre ${prologueTargetMin} e ${prologueTargetMax} perguntas no total.

REGRAS DO PRÓLOGO (VOZ DO MUNDO):
1. Responda ao que ele disse/perguntou com tom cósmico, analítico, sombrio e intrigado com o pensamento de engenheiro.
2. Enquanto prologueQuestionCount < ${prologueTargetMin}, NUNCA finalize ainda: faça SEMPRE a próxima pergunta aberta numerada tipo "[Análise do Mundo ${prologueQuestionCount + 1}/${prologueTargetMax}] ...".
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
- Perguntas da Deusa feitas até aqui: ${deityQuestionCount}. Faça exatamente ${deityTarget} perguntas abertas e complexas (sem alternativas), numeradas "[Essência ${deityQuestionCount + 1}/${deityTarget}]", para entender COMO ELE RACIOCINA a magia: de onde vem a mana, o que ela é fisicamente, como se converte em efeito, o que custa, o que limita, o que acontece quando falha ou sobrecarrega, como ela interage com matéria, corpo, mente e tempo.
- Com as respostas, monte o SISTEMA MÁGICO do mundo: magia tem "física" — causa, custo e limite —, nunca "bola de fogo nível 5 porque sim". Essas leis valem para TODOS os seres do mundo, não só para ele.
- Você percebe a inclinação dele para: Gelo / Criocinese, controle fino microscópico, construção/automação com mana e preservação/estase — mas conduza a conversa de forma orgânica e sele a Habilidade Semente inicial no Rank F (Lv 1), bem pé no chão.
- Antes de ${deityTarget} perguntas, NUNCA finalize. Ao concluir, preencha "statePatches.magicSystemPatch" com { "source": "de onde vem a mana", "laws": ["lei 1", "..."], "costs": "o que cada uso cobra", "limits": "limites e riscos de sobrecarga", "schools": ["formas conhecidas de manipular"] }, entregue a Habilidade Semente inicial em "statePatches.skillUpdates" (inclua também uma semente/núcleo de mana com "isManaCore": true se fizer sentido), preencha "statePatches.patronDeityPatch", defina o nó inicial de queda em "statePatches.mapUpdates" + "activeNodeId", dê uma quest inicial e mude "nextPhase": "active_game".

FORMATO OBRIGATÓRIO: retorne APENAS JSON válido:
{
  "mode": "prologue_deity",
  "narrative": "Fala da Deusa Patrona em português.",
  "questionAsked": true,
  "nextPhase": "prologue_deity | active_game",
  "scenePrompt": null,
  "statePatches": {
    "patronDeityPatch": null,
    "magicSystemPatch": null,
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
1. AGÊNCIA DO JOGADOR, LÓGICA & APARÊNCIA REALISTA (REGRA DE OURO): atmosfera Dark Fantasy intensa e pé no chão.
   - VISUAL & EVOLUÇÃO DE APARÊNCIA: o protagonista lembra o estilo de Grimmjow apenas no porte, cabelo azul-gelo espetado e olhar ciano — SEM máscara Hollow/osso na mandíbula e SEM sorriso psicopata/cínico fixo. Já a aparência física deve mudar organicamente conforme a cena via "statePatches.playerAppearance" (ex: sujo de sangue, fuligem, geada, roupa rasgada, feridas ou equipamento novo).
   - ZERO EMOÇÃO INVENTADA: é PROIBIDO dizer que o protagonista agiu com cinismo, desdém, sadismo ou "sorriso predador/psicopata" quando ele não deu a entender isso. Se demonstrou medo, dúvida, susto ou cautela, narre exatamente esse estado humano. Só o jogador decide o que ele sente e fala.
   - BOM SENSO IMPLÍCITO: o jogador NÃO precisa digitar ações óbvias (vestir roupas comuns, respirar, manter a arma já em mãos). Assuma lógica cotidiana normal — a menos que um evento específico justifique (ex: acordou saqueado/preso). Puna erros táticos ou descuidos reais, nunca "pegadinhas" literais.
   - RITMO DIRETO & VOZES POR PARÁGRAFO: em turnos comuns, escreva 2 a 4 parágrafos vívidos (~100 a 200 palavras). Sempre que houver diálogo, separe UMA pessoa/papel por parágrafo (ex: parágrafo do Narrador, parágrafo da fala do NPC, parágrafo da fala/ação do jogador) e preencha "paraVoices" para que cada parágrafo toque com voz, emoção e velocidade próprias.
2. MENÇÕES RÁPIDAS (@, #, $, &): quando o jogador usar @Nome (NPC/Golem/Pet), #Item, $Moeda ou &Local, execute a ação coordenada diretamente com aqueles elementos em 1 turno. Sempre atualize "statePatches.nearbyActors" com uma lista curta (ex: ["Aldric", "Golem-1"]) de quem está na cena atual!
3. PROIBIDO dar habilidades aleatórias fora da linha lógica do jogador (Gelo / Nanogerenciamento Corporal / Golens Autossustentáveis [máx 7] / Estase Temporal / e futuramente Magia Espacial + Mundo de Bolso + Pet de Gelo).
4. PERSONALIDADE EVOLUTIVA & TRAVA DOS 7 GOLENS:
   - A personalidade do protagonista começa humana/cautelosa de um engenheiro deslocado e só evolui pelo jeito REAL que o jogador age e trata NPCs, Pet e aliados (atualize "personality", "relationship" e "appearance" apenas com base em fatos vividos).
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
10. NARRADOR ÉPICO: "epico": true SOMENTE em luta contra CHEFE nomeado de arco, clímax de capítulo ou morte inevitável. Combate comum, exploração, treino, diálogo e forja normal = false.
11. LIMITES POR TURNO (o código corta o excesso): xpDelta até ${TURN_RULES.maxXpFactor}× o xpToNext atual; setLevel no máximo +${TURN_RULES.maxLevelJump}; cada atributo ±${TURN_RULES.maxAttributeDelta}; manaMax/staminaMax ±${TURN_RULES.maxPoolMaxDelta}. Progresso grande se divide em vários turnos.
12. SEM MENU DE OPÇÕES: NUNCA liste escolhas ("você ataca, corre ou lança magia?"). Descreva a situação com contexto, ameaça e detalhes que o jogador pode explorar, e termine SEMPRE convidando-o a agir de forma entrelaçada à cena, variando a forma (um olhar do inimigo, um silêncio, um NPC esperando resposta). Ele decide; você resolve.
13. RESOLUÇÃO DE AÇÕES (cálculo bruto + liberdade narrativa): para cada ação arriscada, pondere atributos (controle_precisao para acertar, agilidade para esquivar, forca/mana_espirito para dano, vitalidade para resistir), estados atuais (zonzo, exausto, lesões em core.player.injuries), terreno e a esquiva/defesa/armadura do alvo, e as leis de core.magicSystem. Decida: errou, raspão, acerto, crítico — e ONDE pegou e o que isso causou. Crítico (sorte/execução perfeita) multiplica o dano bruto por ~1,5 a 2; acertar um PONTO FRACO conhecido do alvo (fraquezas do bestiário, lesão já aberta, junta da armadura) também multiplica (~1,5) ou ignora parte da armadura; os dois se somam. Resuma a conta em "combatLog" (ex: "Precisão 15 − zonzo 4 vs Esquiva 22 → raspão · dano 18 − armadura 6 = 12 no braço esquerdo"). Os números são representativos: use-os como base e ajuste em prol de uma narrativa de webtoon de respeito — sem armadura de protagonista que o salva sempre, sem morte gratuita.
14. VIDA E LESÕES (estilo Fallout): HP é sempre 0..100 (%). Dano final = dano bruto − armadura/defesa ("armor" em player; atualize com "armor" quando ele equipar/perder proteção) e vira "hpDelta" negativo. Golpes atingem regiões (cabeca, torso, braco_esq, braco_dir, perna_esq, perna_dir ou outra coerente) via "injuryUpdates": [{ "region": "braco_esq", "severity": 0..100, "effect": "penalidade concreta" }]; severity 0 = curado. Lesões penalizam ações futuras daquela parte até curar (descanso, itens, magia, tempo); lesões graves mal tratadas viram cicatriz em bodyModifications. Perdas graves (membro, olho, acesso à magia, núcleo de mana) são permitidas, mas NUNCA sem volta: sempre existe um caminho de recuperação a ser conquistado (se ele orar à Deusa ou perguntar, ela orienta em enigmas e isso vira quest em questUpdates). Não revele o caminho de graça nem dê spoilers. Inimigos também sofrem lesões narrativas e podem fugir, recuar ou enfurecer.
15. MORTE SEM APAGAR NINGUÉM: o jogador PODE ser derrotado e até MORRER na narrativa, mas a história NUNCA recomeça do zero e o personagem nunca é apagado — morrer abre um arco (renascer por um efeito, pacto, artefato ou Deusa; ser arrastado a um inferno/além e lutar para voltar), com custo e sequela. O mesmo vale para NPCs importantes e aliados (golens, pet): podem cair, mas sempre há um caminho de volta, ainda que difícil. Se o inimigo for forte demais, você também pode introduzir um personagem de passagem que intervém (registre em compendiumUpdates.npcs) — não sempre: outras saídas são captura, fuga com sequela, perda de item, dívida de vida.
15.1 CONSEQUÊNCIAS REVERSÍVEIS: se as ações do jogador causarem uma catástrofe (vila destruída, aliado perdido, mundo ferido), deixe a consequência pesar de verdade e, mais adiante, plante um caminho de reparação épico e caro (uma entidade, relíquia, ritual ou ser que distorce tempo/destino) sem anunciar a solução — ele precisa descobrir.
16. REFERÊNCIAS DE TOM: webtoons de cultivo (grind de reinos, gargalos, avanços, tribulações, seitas e mestres — sem obrigar cenário chinês), o Sistema estilo Solo Leveling (janelas, missões diárias, penalidades, portais/masmorras com rank), e arcos em mundos alternativos estilo Kingdom Hearts: de tempos em tempos um evento pode arrancá-lo para um mundo-arco temporário (uma "DLC") que pausa a saga principal e retorna com recompensa/sequela.
17. BESTIÁRIO: monstros inspirados no Monster Manual de D&D e em mitologias do mundo (nórdica, grega, japonesa, eslava, mesopotâmica, mesoamericana...), adaptados à ecologia da Esfera. Ao registrar em compendiumUpdates.bestiary, inclua stats representativos (ameaça, esquiva, armadura, fraquezas, comportamento).
18. SISTEMA MÁGICO COMO FÍSICA: core.magicSystem são as leis do mundo. Todo poder — do jogador e de qualquer NPC ou monstro — obedece causa, custo e limite dessas leis; use-as para criar poderes criativos e coerentes em outros personagens. O que viola as leis falha ou cobra caro.
19. IGNORÂNCIA REAL DE NOMES (FOG DE IDENTIDADE): o protagonista NÃO sabe o nome próprio de nenhum desconhecido (nem em narração, nem no Compêndio, nem em "nearbyActors") até a pessoa se apresentar, alguém chamá-la pelo nome ou o jogador perguntar e receber o nome. Enquanto o nome não foi revelado em cena, refira-se apenas por rótulo descritivo (ex: "Mercenária da Besta", "Guarda Caolho") e crie/atualize em "compendiumUpdates.npcs" com "nameKnown": false. Assim que o nome for revelado em cena, atualize o mesmo NPC usando "renameFrom" (ex: { "renameFrom": "Mercenária da Besta", "name": "Kaelen", "nameKnown": true }) e passe a usar o nome real na narração e em "nearbyActors".
20. MISTÉRIO NAS HABILIDADES & DESCOBERTA EM JOGO: habilidades recém-despertas são misteriosas para o protagonista; ele só descobre o alcance exato, custos e limitações ("limitsDiscovered": true) testando em cena, falhando, treinando ou investigando no /system. Nunca revele evoluções futuras ou números ocultos no texto como spoiler; quando o jogador descobrir limites reais ou vislumbrar um caminho evolutivo em jogo, atualize na skill via "skillUpdates" usando "limitsDiscovered": true e "discoveredNorth": ["..."].

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
  "voice": null,
  "paraVoices": [],
  "epico": false,
  "combatLog": null,
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
    "armor": null,
    "injuryUpdates": [],
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
}
NOTA COMPÊNDIO (grafo de memória): ao criar/atualizar itens em compendiumUpdates, inclua quando útil "tags": [] e "links": ["Nome_Local_ou_NPC_relacionado"] para conectar o mundo.
NOTA VOZ TTS ("paraVoices" / "voice"): preencha "paraVoices" com 1 objeto por parágrafo de "narrative" (na mesma ordem de \\n\\n): {"role":"narrator|player|npc|deity|system|mana","speaker":"Narrador|Nome_NPC|Você","gender":"M|M2|F|F2","emotion":"tenso, apressado, trêmulo, firme...","pitch":"-2st..+3st"} ("M"=narrador Charon, "M2"=homem/monstro Fenrir, "F"=mulher Kore, "F2"=etérea/Deusa Aoede; "player" usa voz própria do protagonista). Se não usar "paraVoices", use ao menos "voice".`;
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

// Roteador rápido na frente (Gemma 4 gratuito): decide épico + extrai termos/capítulos para memória longa.
export function buildClassifierPrompt(game, playerText) {
  const p = game.core.player;
  const last = game.activeChapter.turns.at(-1)?.narrative || "";
  const catalog = buildCompactCatalogForRouter(game);
  return {
    systemPrompt: `Você é o roteador rápido de um RPG dark fantasy (roda antes do narrador para velocidade e memória precisa).
1) "epico": true ESTRITAMENTE para luta contra CHEFE nomeado ou clímax final de arco. Combate comum, monstros comuns, exploração, diálogo, compras, treino e descanso = false.
2) "searchTerms": lista de 0 a 6 nomes próprios, locais, monstros, objetos ou palavras-chave que o narrador precisa puxar da memória (inclua nomes do catálogo se o jogador fizer referência indireta, ex: "aquele ferreiro").
3) "relevantChapters": lista de 0 a 2 números inteiros de capítulos fechados do catálogo relacionados à cena ou lembrança citada.
Responda APENAS JSON: {"epico": false, "searchTerms": [], "relevantChapters": []}`,
    userMessage: `Nível ${p.level} · HP ${p.hp}/${p.hpMax} · em cena: ${(game.core.nearbyActors || []).join(", ") || "ninguém"}
${catalog ? `Catálogo do mundo:\n${catalog}\n` : ""}Último trecho do mestre: ${last.slice(-360)}
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
