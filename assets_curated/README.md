# assets_curated/ — Fase 1 (curadoria de `ASSETS/`)

Gerado por `python tools/curate_assets.py` a partir de `ASSETS/_raw_extracted/` (não versionado). Total ≈ 4 MB.
`catalog.json` mapeia cada chave (`"sfx"`, `"vfx"`, bioma, música) para o arquivo — é o que o motor da Fase 2 vai ler.

| Pasta | Conteúdo | Origem |
|---|---|---|
| `icons/` | 363 SVG monocromáticos (`fill="currentColor"`, tinja via CSS `color: #67e8f9`) — game, items, gear, nature, ui | Game-Icon-Pack v1.4 (no-padding) |
| `bg/` | 5 fundos 9:16 720×1280 WebP (15–50 KB): `gelo`, `floresta`, `ermo`, `vale`, `castelo_gelo` (pixel art) | Frostwindz Hand Painted + Ice Castle |
| `ui/` | bordas, painéis e divisores fade (PNG) + tilesheet DarkAges | kenney_fantasy-ui-borders, DarkAgesUi |
| `fonts/` | `boldpixels.ttf` — só títulos `/system`/números de dano | BoldPixels |
| `vfx/` | partículas WebP (neve, floco, estrela, poeira, vagalume, chuva) + 2 spritesheets de corte 128px | immersive_particle_vfx, Pixel Art Slashes |
| `sfx/` | 33 sons curtos OGG mono (UI, combate, magia, portal, jingles, vozes) | packs Kenney (CC0) |
| `music/` | 6 loops ≤75 s OGG ~64 kbps + `amb_nevasca` | RPGAmbientMusic (ver licença) |
| `licenses/` | licenças originais de cada pacote | — |

**Direção de arte:** os fundos saem em cor original; o overlay escuro + vinheta (`rgba(5,7,12,0.82)`) e o blur ficam no CSS da Fase 2. O `vale` é o mais claro/saturado — use com overlay mais forte ou só em eventos.

**Licenças a observar:** Kenney = CC0. Música: CC BY (Nakarada, creatorchords, PeriTune etc.) — exige crédito no app. `vazio_espacial` e `amb_nevasca` vêm da parte "ambient" do resource pack (porte GPL-3.0 de sons estilo Minecraft) — origem exata não verificada; troque antes de publicar comercialmente. Frostwindz: ver `.docx` em `licenses/`.
