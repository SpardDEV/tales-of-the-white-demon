# CLAUDE.md — Tales of the White Demon (Heimdall & Bifrost)

Leia primeiro o arquivo [ARQUITETURA_HEIMDALL_BIFROST.md](./ARQUITETURA_HEIMDALL_BIFROST.md) antes de editar código ou reorganizar assets.

## Resumo Rápido do Repositório
- **App atual:** PWA mobile-first em HTML/CSS/ES Modules (`index.html`, `styles.css`, `src/*.js`), publicado na branch `gh-pages`.
- **Banco de dados:** Supabase (`supabase_schema.sql`) particionado em `twd_saves`, `twd_spheres`, `twd_compendium`, `twd_chapters`, `twd_usage` e `twd_media` (sync diferencial de imagens WebP 9:16).
- **Pasta `ASSETS/`:** Contém ~730 MB de arquivos `.zip` e `.7z` (áudio, fundos parallax, VFX, bordas UI, fontes e ícones SVG/PNG).
  - **NUNCA** commite os `.zip`, `.7z` ou `.wav` pesados no Git (`.gitignore` já bloqueia `ASSETS/*.zip`, `ASSETS/*.7z` e `ASSETS/_raw_extracted/`).
  - Extraia para `ASSETS/_raw_extracted/`, selecione apenas o necessário, converta imagens para **WebP** e áudios selecionados para **OGG/MP3** leve em uma pasta limpa (`assets_curated/`).
  - **Regra visual:** Concilie os diferentes estilos de arte sob uma única paleta Dark Fantasy glacial (`#05070c` + `#67e8f9` + `#a78bfa`), priorizando os ícones SVG monocromáticos de `Game-Icon-Pack-v1.4-SVG.7z` e fundos Hand-Painted com vinheta/overlay escuro.
