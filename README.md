# ❄️ Tales of the White Demon

RPG Isekai infinito movido a **Gemini Flash** + **Supabase** + **Globo Esférico em Canvas**, pensado para rodar no celular (PWA / GitHub Pages / APK WebView) e no PC com o mesmo save sincronizado.

## Estrutura do Projeto

- `index.html` / `styles.css` / `manifest.json` / `sw.js` — Interface mobile-first em abas (`Chat`, `Ficha`, `Quests`, `Compêndio`, `Mapa`).
- `src/config.js` — Ranks (`F` até `EX+` + tipologias infinitas) e marcos orgânicos de evolução.
- `src/state.js` — Banco particionado (IndexedDB local + rotação automática de capítulos a cada 45 turnos + múltiplas esferas).
- `src/prompts.js` — Prólogo da **Voz do Mundo** (15–30 perguntas abertas), **Deusa Patrona**, comandos `/pray`, `/world`, `/system`, `/mana` e Árbitro de Negociação / Teimosia / Esporro.
- `src/gemini.js` — Cliente REST do Gemini Flash com medição real de tokens (`usageMetadata`) e requisições.
- `src/supabase.js` — Sync incremental por capítulos, esferas e compêndio via REST do Supabase.
- `src/globe.js` — Globo 3D digital em HTML5 Canvas (rotação, zoom, Fog of War, símbolos ASCII e troca de esferas).
- `supabase_schema.sql` — Script SQL para criar as tabelas no Supabase.

## Como Colocar no Ar (Passo a Passo)

### 1. Chave do Gemini Flash (Grátis)
1. Acesse o **Google AI Studio** e crie uma **API Key**.
2. Abra o app, toque em **⚙️** no topo direito, cole sua chave e salve. Ela fica salva **apenas no seu aparelho** (`localStorage`).

### 2. Banco na Nuvem com Supabase (Grátis)
1. Crie um projeto no **Supabase**.
2. No menu lateral, abra **SQL Editor**, cole o conteúdo de `supabase_schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. Cole os dois em **⚙️** no app e escolha um **Slot ID** secreto seu (ex: `meu-white-demon-99`) para sincronizar PC e Celular.

### 3. Hospedar no GitHub Pages (24h Online) & APK
1. Suba esta pasta para um repositório no GitHub.
2. Vá em **Settings → Pages**, escolha a branch principal e a pasta raiz (`/`).
3. Abra a URL gerada no Chrome do celular:
   - Pode clicar em **"Adicionar à tela inicial"** (já funciona como app PWA), **ou**
   - Apontar a **WebView** do seu projeto APK para essa URL do GitHub Pages (assim toda melhoria futura atualiza sem recompilar o APK).

### 4. Testar Localmente no PC
Como o projeto usa ES Modules (`type="module"`), basta rodar qualquer servidor estático na pasta, por exemplo:
```bash
npx serve .
```
ou
```bash
python -m http.server 8080
```
e abrir `http://localhost:8080`.
