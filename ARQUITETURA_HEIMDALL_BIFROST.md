# 🌌 Arquitetura Heimdall & Bifrost: O Ecossistema Definitivo (v2.0)

> Documento mestre anexado ao projeto **Tales of the White Demon** para orientar o **Claude** na evolução do ecossistema mobile/web, curadoria dos pacotes em `ASSETS/` e unificação visual da UI.

---

## Parte I — Especificação Conceitual (Heimdall & Bifrost v2.0)

### 1. O Conceito Base
* **A Bifrost (O Aplicativo Mobile):** Instalado no Galaxy S23. É a interface visual, o motor de imersão 4D e a ponte de comunicação.
* **O Heimdall (A Inteligência):** A rede de IAs conectada ao Supabase que processa dados, audita regras e controla o orçamento de forma autônoma.

### 2. O Roteamento de IA (Cascata de Custo Otimizado)
Uso massivo das cotas gratuitas, poupando o orçamento mensal (~US$ 41) para infraestrutura e eventos épicos:
* **Gemma 4 26B/31B (Free):** Classificador rápido de intenções.
* **Antigravity / Motor Lógico (Free - 100/dia):** Processa matemática e status, devolvendo regras puras em JSON.
* **Gemini Flash Lite (Free):** O Narrador Comum (ações rotineiras).
* **Gemini Flash / Pro / Argon (Créditos):** O Narrador Épico (chefes e clímax).

### 3. Motor Audiovisual de Baixo Custo (SFX, VFX e TTS)
Uma experiência de console usando recursos enxutos:
* **Efeitos Sonoros (SFX):** Pack de sons locais no app. A IA manda a chave (`"sfx": "magia_fogo"`) e o som toca com latência zero.
* **Efeitos Visuais de Tela (VFX):** Uso de animações *Lottie* (arquivos JSON leves) ou partículas leves em Canvas/CSS. A IA comanda (`"vfx": "nevasca"`) e flocos de neve caem por cima do texto durante 3 segundos.
* **TTS Neural (Vozes de Chefes):** Uso pontual da API de voz do Google Cloud com pitch alterado via SSML para diferenciar robôs de orcs, sem custo extra.
* **Modo Furtivo (Mute):** Botão na interface que cancela a requisição do TTS no servidor, economizando bateria, dados móveis e tokens de áudio na rua.

### 4. Imersão Sensorial e Interativa 4D (Hardware Galaxy S23)
Quebrando a barreira do texto com o hardware do celular:
* **Feedback Háptico:** A IA envia o peso da ação e o motor de vibração do S23 responde de acordo (vibração aguda para lâminas, tremores graves para passos de gigantes).
* **Material You Dinâmico:** A cor de fundo/acentos da Bifrost muda suavemente baseada no bioma atual ditado pela IA (ex: verde-musgo em florestas, vermelho-brasa em vulcões, azul-glacial em terras gélidas).
* **Status Visual (Sangue / Veneno na Tela):** Se o HP cair muito ou o personagem for envenenado/congelado, as bordas da tela pulsam conforme o status.
* **Eventos Físicos (QTE de Movimento):** Quando capturado ou em equilíbrio, a IA pode mandar `"qte_fisico": "agitar"` (ou `"inclinar"`). O app trava o teclado, lê acelerômetro/giroscópio e envia a confirmação automática quando o jogador executa o movimento físico.

### 5. Interface UI Invisível & Fluxo de Arte
* **Inventário Silencioso:** Carrossel visual no topo/ficha puxando itens direto do banco (Supabase) sem gastar tokens perguntando o que há na mochila.
* **Geração de Imagens via Direct Share (9:16):** A Bifrost gera/copia o prompt épico, abre o ChatGPT, o usuário gera a arte vertical (9:16), compartilha de volta para a Bifrost, que comprime em WebP e salva na nuvem/local.

### 6. Armazenamento e Bypass de Banda
* **Supabase (Free 500MB):** Guarda tabelas particionadas (saves por capítulo, esferas, compêndio, mídia diferencial `twd_media`) e memória longa.
* **Cloud Storage / Banco Leve:** Hospeda assets WebP otimizados.
* **Bypass do Google Drive (Assistente Pessoal):** Geração de link direto interceptado pela Bifrost para download direto no aparelho sem consumir banda gratuita de servidor.

### 7. O Poder do Heimdall (Vida Pessoal e Engenharia)
* **Gatilho Rápido:** Acionado segurando o botão Power do S23 (via Good Lock).
* **Integração Smart Home:** Webhooks locais para o servidor CasaOS (ex: lâmpadas Elgin / cena de cinema).
* **Extensão do SparDEV/SparBIM:** Cruzamento de composições do SINAPI/SICRO por comando de voz.
* **Dashboard de Consumo:** Aba de configurações calcula em tempo real consumo de tokens, requisições das cotas gratuitas e orçamento.

---

## Parte II — Instruções Práticas para o Claude (Estado Atual & Curadoria de `ASSETS/`)

### 1. O que já existe pronto no projeto (Base Web/PWA V2)
* `index.html`, `styles.css`, `manifest.json`, `sw.js` — PWA dark fantasy mobile-first já publicado na branch `gh-pages` (`https://sparddev.github.io/tales-of-the-white-demon/`).
* `src/config.js` — Ranks (`F` → `EX+` → `Transcendente-N`), marcos orgânicos de evolução, estilo de arte padrão (Dark Fantasy Comic-Ink 9:16) e aparência base do protagonista (inspiração visual Grimmjow de Bleach).
* `src/state.js` — Persistência `IndexedDB` (com fallback) particionada por capítulos (`45` turnos/capítulo), múltiplas esferas de mundo, moedas (`currencies`), `keyItems`, `projects`, `devLog` em skills/projetos, `media` store separada e pilha de `Undo` (`pushUndoSnapshot`/`popUndoSnapshot`).
* `src/prompts.js` & `src/gemini.js` — Prólogo duplo (Voz do Mundo 15–30 perguntas abertas + Deusa Patrona), comandos `/pray`, `/world`, `/system`, `/mana`, negociação/teimosia/esporro, menções `@ # $ &`, `scenePrompt` e medição real via `usageMetadata`.
* `src/supabase.js` & `supabase_schema.sql` — Sync incremental com 6 tabelas (`twd_saves`, `twd_spheres`, `twd_compendium`, `twd_chapters`, `twd_usage`, `twd_media`).
* `src/globe.js` — Globo esférico 3D interativo em HTML5 Canvas com zoom, rotação touch, *Fog of War* e portais inter-esferas.
* `src/media.js` — Compressor WebP 9:16 (`540×960`) no navegador + gerador de prompts para ChatGPT.

---

### 2. Inventário Real em `ASSETS/` (Arquivos Compactados para Extrair e Filtrar)
Existem ~730 MB de pacotes em `ASSETS/` (muitos pesados e com **estilos de arte misturados**). **NUNCA suba os `.zip`/`.7z` ou `.wav` brutos para o GitHub** (o `.gitignore` já bloqueia `ASSETS/*.zip` e `ASSETS/*.7z`; o GitHub rejeita arquivos >100 MB).

Extraia para uma pasta temporária (`ASSETS/_raw_extracted/`) e faça a curadoria copiando **apenas os assets finais otimizados** para uma pasta limpa (ex: `assets_curated/`):

#### A. Ícones, Fontes e Molduras de UI
* `Game-Icon-Pack-v1.4-SVG.7z` (0.35 MB) — **ALTA PRIORIDADE:** ícones em SVG podem ser tingidos via CSS (`currentColor`) em ciano-gelo `#67e8f9` / branco-osso, mantendo 100% de unidade visual monocromática!
* `Game-Icon-Pack-v1.4-PNG.7z` (3.34 MB) — usar só se algum ícone específico faltar no SVG.
* `DarkAgesUi_v1.0.zip` (0.02 MB) & `kenney_fantasy-ui-borders.zip` (0.34 MB) — bordas/molduras de UI medieval/fantasia (extrair só os frames úteis e dessaturar/tingir para combinar com o tema escuro `#05070c`).
* `kenney_cursor-pack.zip` (0.71 MB) & `kenney_cursor-pixel-pack.zip` (0.10 MB) — cursores opcionais para desktop.
* `BoldPixels.ttf` (0.15 MB) & `webfontkit-BoldPixels.zip` (0.32 MB) — fonte pixelizada (usar **apenas** em títulos/badges estilo terminal do `/system` ou números de dano se combinar, mantendo corpo do texto em fonte limpa para leitura confortável no S23).

#### B. Fundos / Biomas (Parallax Backgrounds)
* `Hand Painted Parallax BG - Frostland - FREE Version.zip` (26.40 MB)
* `Hand Painted Parallax BG - Gloomwood Forest.zip` (28.28 MB)
* `Hand Painted Parallax BG - Wasteland - FREE Version.zip` (24.23 MB)
* `Hand Painted Parallax BG - Whitewood Vale - FREE Version.zip` (33.37 MB)
* `Ice Castle Parallax BG.zip` (0.35 MB) — *(Atenção: este é pixel art; os outros 4 são Hand Painted!)*.
  * **Como conciliar estilos:** Escolha as camadas mais limpas de cada bioma, redimensione para mobile e converta para **WebP leve (~40–100 KB cada)** aplicadas atrás do chat/cabeçalho com um **overlay escuro + vinheta (`rgba(5,7,12,0.82)`) + leve blur**, para funcionar como atmosfera dinâmica de bioma (Material You / bioma vivo) sem brigar com os retratos Comic-Ink 9:16 nem prejudicar a leitura do texto! Se `Ice Castle` destoar demais em pixel art comparado aos *Hand Painted*, use pixel apenas onde fizer sentido ou aplique filtro/desfoque sutil de fundo.

#### C. VFX e Animações
* `immersive_particle_vfx.zip` (56.00 MB) — selecionar só spritesheets/partículas leves de gelo, nevasca, névoa, faíscas arcanas e converter para WebP/sprites compactos (não incluir gigas de assets não usados).
* `Pixel Art Animations - Slashes.zip` (1.41 MB) — animações de corte para golpes em combate (usar com moderação ou aplicar shader/brilho ciano para integrar ao estilo sombrio).

#### D. Áudio (SFX, Vozes e Música Ambiente)
* **Packs curtos de SFX (ideais para embutir localmente):**
  * `kenney_interface-sounds.zip` (0.80 MB), `kenney_ui-audio.zip` (0.39 MB) — cliques do `/system`, abrir ficha, alertas.
  * `kenney_rpg-audio.zip` (0.92 MB), `kenney_impact-sounds.zip` (0.76 MB), `kenney_sci-fi-sounds.zip` (5.60 MB — útil para ecos de mana/espaço/QTE), `kenney_music-jingles.zip` (1.18 MB), `kenney_casino-audio.zip` (0.84 MB).
  * `kenney_voiceover-pack.zip` (1.77 MB), `kenney_voiceover-pack-fighter.zip` (1.21 MB).
* **Packs pesados de música/ambiente (NÃO extrair tudo direto pro app!):**
  * `AmbientSound6_R14.zip` (46.54 MB), `ambient_sound.zip` (164.94 MB), `RPGAmbientMusic.zip` (308.07 MB).
  * **Regra de ouro:** Escolha no máximo **4 a 6 faixas curtas em loop** (gelo/vento, floresta sombria, combate chefe, santuário da Deusa, vazio espacial) e comprima para **OGG/MP3 96–128 kbps** (~300–700 KB por faixa) antes de colocar na pasta final servida pelo app!
* **Fonte extra salva pelo usuário:** veja [ASSETS/FONTES_EXTRAS.md](./ASSETS/FONTES_EXTRAS.md) (link do ZapSplat + lista do que falta em Gelo/Portais/Tempo/Chefes caso o usuário adicione novos `.zip`).

---

### 3. Regra de Conciliação Visual (Direção de Arte para o Claude)
Os assets possuem **4 linguagens diferentes** (Comic-Ink Dark Fantasy dos retratos 9:16, Hand-Painted dos fundos, Pixel Art de alguns packs e SVG vetorial dos ícones). Para o app parecer um produto único e coeso:
1. **Paleta Mestre Única:** Fundo `#05070c` (obsidiana), superfícies `#0a0f18` / `#101724`, acento primário **ciano glacial `#67e8f9`**, acento mana **`#a78bfa`**, alertas em âmbar `#fbbf24` / carmesim `#f87171`.
2. **Ícones 100% Monocromáticos:** Use `Game-Icon-Pack-v1.4-SVG` tingidos via CSS para eliminar inconsistência de cores.
3. **Fundos com Tratamento Atmosférico:** Aplique os cenários *Hand Painted* como camadas sutis de bioma com vinheta escura pesada — nunca em brilho total atrás do texto.
4. **Molduras de UI (`DarkAgesUi` / `kenney_fantasy-ui-borders`):** Se usar bordas bitmap, aplique `filter: brightness(0.65) contrast(1.2) hue-rotate(...)` ou extraia o conceito em CSS/SVG `border-image` discreto para casar com o tema Dark Fantasy glacial.
5. **Preservar os Prompts 9:16:** Os retratos gerados pelo usuário no ChatGPT seguem o estilo *Dark Fantasy Comic-Ink* sobre fundo preto puro — mantenha os cards da Ficha e Compêndio com moldura fina e fundo escuro para que essas artes brilhem como cartas colecionáveis.

---

### 4. Próximas Entregas Sugeridas para o Claude
1. ✅ **(Feito 11/11/2026 — ver [assets_curated/README.md](./assets_curated/README.md) e `tools/curate_assets.py`) Curadoria de `ASSETS/`:** Descompactar em `ASSETS/_raw_extracted/`, catalogar os melhores arquivos, converter fundos para WebP e SFX/loops selecionados para OGG/MP3 em `assets_curated/` (mantendo tamanho total web enxuto).
2. **UI & Motor Sensorial Web/Bifrost:**
   - Aplicar bordas, ícones SVG monocromáticos e fundos de bioma dinâmico na interface atual (`index.html` + `styles.css`).
   - Adicionar motor leve de **SFX local + VFX de tela** (chaves `"sfx"` e `"vfx"` no JSON do Gemini) com botão **Modo Furtivo (Mute)**.
   - Adicionar suporte a **Vibração Háptica (`navigator.vibrate`)** e **QTE Físico (`DeviceMotionEvent` / acelerômetro)** no navegador/WebView, além de preparar a camada nativa (Capacitor/Flutter/Android WebView) para o Galaxy S23.
3. **Roteamento em Cascata & Heimdall:** Evoluir a camada de IA para suportar roteamento entre modelos econômicos e épicos, plus dashboard detalhado de custos.
