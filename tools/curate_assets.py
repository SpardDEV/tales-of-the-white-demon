# Fase 1 — curadoria de ASSETS/_raw_extracted -> assets_curated/
# Uso: extraia os .zip/.7z em ASSETS/_raw_extracted/<nome do pacote>/ e rode `python tools/curate_assets.py`.
# Requer Pillow e ffmpeg/ffprobe no PATH.
import glob, json, os, shutil, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace('\\', '/') + '/'
RAW = ROOT + 'ASSETS/_raw_extracted/'
OUT = ROOT + 'assets_curated/'
catalog = {}

def one(pattern):
    hits = sorted(glob.glob(RAW + pattern, recursive=True))
    assert hits, 'nada encontrado: ' + pattern
    return hits[0]

def mk(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p

# ---------- 1. Ícones SVG (já usam fill="currentColor") ----------
for cat in ['1-game', '2-items', '3-gear', '4-nature', '8-ui']:
    for f in glob.glob(RAW + f'Game-Icon-Pack-v1.4-SVG/no-padding/{cat}/*.svg'):
        shutil.copy(f, mk(OUT + f'icons/{cat.split("-", 1)[1]}/' + os.path.basename(f).lower()))

# ---------- 2. Fundos de bioma: compõe camadas 2560x1440, recorta 9:16, WebP ----------
H = 'Hand Painted Parallax BG - '
BIOMES = {  # de trás para frente
    'gelo':     [H + 'Frostland - FREE Version/PNG Files/' + n for n in
                 ['sky', 'snow_cloud', 'bg_mountains', 'mountains', 'midground', 'foreground_2', 'foreground_1']],
    'floresta': [H + 'Gloomwood Forest/PNG Files/' + n for n in
                 ['SKY/sky', 'HILLS/Hills', 'TREES/Tree Clusters/background/tree_cluster_background1',
                  'TREES/Tree Clusters/midground/tree_cluster_midground1', 'GROUND/Ground',
                  'TREES/Tree Clusters/foreground/tree_cluster_foreground1',
                  'FOLIAGE/Foliage Clusters/foreground/foliage_cluster_foreground1']],
    'ermo':     [H + 'Wasteland - FREE Version/PNG Files/' + n for n in
                 ['sky', 'dust_cloud', 'mountains', 'middleground', 'foreground_2', 'foreground_1', 'particles']],
    'vale':     [H + 'Whitewood Vale - FREE Version/PNG Files/' + n for n in
                 ['SKY/sky', 'SKY/cloud', 'HILLS, MOUNTAINS/mountains', 'HILLS, MOUNTAINS/hill_background',
                  'HILLS, MOUNTAINS/hill_midground', 'TREES/Tree Clusters/tree_cluster_2D', 'GROUND/ground_with_foliage']],
    'castelo_gelo': ['Ice Castle Parallax BG/pngs/' + n for n in
                     ['sky', '4_BG_mts', '3_ice_castle', '2_foreground_mts', '1_foreground_mts', 'fog']],
}
for name, layers in BIOMES.items():
    base = None
    for rel in layers:
        im = Image.open(RAW + rel + '.png').convert('RGBA')
        if base is None:
            base = Image.new('RGBA', im.size)
        # camadas mais baixas ficam encostadas no chão; nuvens (largura menor) centralizadas
        x = (base.width - im.width) // 2
        y = 0 if 'cloud' in rel.lower() else base.height - im.height
        base.alpha_composite(im, (max(x, 0), max(y, 0)))
    pixel = name == 'castelo_gelo'
    if pixel:  # pixel art: amplia sem suavizar antes de recortar
        base = base.resize((base.width * 4, base.height * 4), Image.NEAREST)
    w = base.height * 9 // 16
    focus = {'castelo_gelo': 0.80}.get(name, 0.5)  # castelo fica à direita da camada
    x0 = min(max(int(base.width * focus - w / 2), 0), base.width - w)
    crop = base.crop((x0, 0, x0 + w, base.height)).convert('RGB')
    crop = crop.resize((720, 1280), Image.NEAREST if pixel else Image.LANCZOS)
    dst = mk(OUT + f'bg/{name}.webp')
    for q in (70, 60, 50, 40):  # alvo ≤ 100 KB
        crop.save(dst, 'WEBP', quality=q, method=6)
        if os.path.getsize(dst) <= 100_000:
            break
    catalog.setdefault('bg', {})[name] = f'bg/{name}.webp'

# ---------- 3. Molduras de UI (bitmap pequeno, mantém PNG) ----------
for sub in ['Border', 'Divider Fade', 'Panel']:
    for f in glob.glob(RAW + f'kenney_fantasy-ui-borders/PNG/Default/{sub}/*.png'):
        shutil.copy(f, mk(OUT + f'ui/{sub.lower().replace(" ", "-")}/' + os.path.basename(f)))
shutil.copy(one('DarkAgesUi_v1.0/**/32x32-Tilesheet.png'), mk(OUT + 'ui/darkages-tilesheet.png'))

# ---------- 4. Fonte pixel (só títulos /system e números de dano) ----------
shutil.copy(one('webfontkit-BoldPixels/boldpixels.ttf'), mk(OUT + 'fonts/boldpixels.ttf'))

# ---------- 5. VFX: partículas leves -> WebP ----------
VFX = {
    'neve': 'immersive_particle_vfx/**/feniks snow dust fireflies rain/snow*.webp',
    'neve_floco': 'immersive_particle_vfx/**/npckc snowflakes leaves stars/npckc_snow_*.png',
    'estrela': 'immersive_particle_vfx/**/npckc snowflakes leaves stars/npckc_star_*.png',
    'poeira': 'immersive_particle_vfx/**/feniks snow dust fireflies rain/dust*.png',
    'vagalume': 'immersive_particle_vfx/**/feniks snow dust fireflies rain/firefly*.png',
    'chuva': 'immersive_particle_vfx/**/feniks snow dust fireflies rain/raindrop.webp',
}
for key, pat in VFX.items():
    files = sorted(glob.glob(RAW + pat, recursive=True))
    assert files, pat
    out = []
    for i, f in enumerate(files, 1):
        dst = mk(OUT + f'vfx/{key}_{i}.webp')
        Image.open(f).save(dst, 'WEBP', lossless=True, method=6)
        out.append(dst[len(OUT):])
    catalog.setdefault('vfx', {})[key] = out
for i, s in enumerate(['Slash 1', 'Slash 2'], 1):  # golpes: color1, tingir em CSS
    src = one(f'Pixel Art Animations - Slashes/128x128/{s}/color1/sprite-sheet.png')
    dst = mk(OUT + f'vfx/corte_{i}.webp')
    Image.open(src).save(dst, 'WEBP', lossless=True, method=6)
    catalog.setdefault('vfx', {})[f'corte_{i}'] = dst[len(OUT):]

# ---------- 6. SFX: chave do Gemini -> arquivo OGG mono ----------
SFX = {
    'ui_click': 'kenney_ui-audio/**/click1.ogg',
    'ui_abrir': 'kenney_interface-sounds/**/open_001.ogg',
    'ui_fechar': 'kenney_interface-sounds/**/close_001.ogg',
    'ui_confirmar': 'kenney_interface-sounds/**/confirmation_001.ogg',
    'ui_erro': 'kenney_interface-sounds/**/error_001.ogg',
    'ui_selecionar': 'kenney_interface-sounds/**/select_001.ogg',
    'system_glitch': 'kenney_interface-sounds/**/glitch_001.ogg',
    'qte_alerta': 'kenney_interface-sounds/**/bong_001.ogg',
    'livro_abrir': 'kenney_rpg-audio/**/bookOpen.ogg',
    'livro_folhear': 'kenney_rpg-audio/**/bookFlip1.ogg',
    'moedas': 'kenney_rpg-audio/**/handleCoins.ogg',
    'lamina': 'kenney_rpg-audio/**/knifeSlice.ogg',
    'sacar_arma': 'kenney_rpg-audio/**/drawKnife1.ogg',
    'porta': 'kenney_rpg-audio/**/doorOpen_1.ogg',
    'passos_neve': 'kenney_impact-sounds/**/footstep_snow_000.ogg',
    'soco': 'kenney_impact-sounds/**/impactPunch_heavy_000.ogg',
    'metal': 'kenney_impact-sounds/**/impactMetal_heavy_000.ogg',
    'gelo_quebra': 'kenney_impact-sounds/**/impactGlass_heavy_000.ogg',
    'sino': 'kenney_impact-sounds/**/impactBell_heavy_000.ogg',
    'passo_gigante': 'kenney_sci-fi-sounds/**/lowFrequency_explosion_000.ogg',
    'explosao': 'kenney_sci-fi-sounds/**/explosionCrunch_000.ogg',
    'magia_escudo': 'kenney_sci-fi-sounds/**/forceField_000.ogg',
    'magia_fogo': 'kenney_sci-fi-sounds/**/thrusterFire_000.ogg',
    'mana_eco': 'kenney_sci-fi-sounds/**/laserLarge_000.ogg',
    'portal': 'kenney_sci-fi-sounds/**/spaceEngineLow_000.ogg',
    'dado': 'kenney_casino-audio/**/dice-throw-1.ogg',
    'jingle_vitoria': 'kenney_music-jingles/**/jingles_STEEL00.ogg',
    'jingle_derrota': 'kenney_music-jingles/**/jingles_STEEL04.ogg',
    'jingle_levelup': 'kenney_music-jingles/**/jingles_PIZZI00.ogg',
    'voz_level_up': 'kenney_voiceover-pack/Male/level_up.ogg',
    'voz_game_over': 'kenney_voiceover-pack/Male/game_over.ogg',
    'voz_lutar': 'kenney_voiceover-pack-fighter/**/fight.ogg',
    'voz_prepare': 'kenney_voiceover-pack-fighter/**/prepare_yourself.ogg',
}

def ff(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)

for key, pat in SFX.items():
    dst = mk(OUT + f'sfx/{key}.ogg')
    ff(['-i', one(pat), '-ac', '1', '-c:a', 'libvorbis', '-q:a', '2', dst])
    catalog.setdefault('sfx', {})[key] = f'sfx/{key}.ogg'

# ---------- 7. Música/ambiente: 6 loops curtos (≤ 75 s, fade nas pontas) ----------
MUSIC = {
    'gelo_vento': 'snowyatmosphere.ogg',
    'floresta_sombria': 'moonlitforest.ogg',
    'combate_chefe': 'twilightbattle.ogg',
    'santuario_deusa': 'veilofmist.ogg',
    'vazio_espacial': 'end.ogg',
    'masmorra': 'darkambientsoundscape.ogg',
    'amb_nevasca': 'howling-wind.ogg',
}
# os pacotes de música têm ~500 MB: extrai só as faixas escolhidas + a licença
PICK = RAW + 'music_pick/'
subprocess.run(['7z', 'e', '-y', '-o' + PICK, ROOT + 'ASSETS/RPGAmbientMusic.zip', 'License.txt',
                *[f'assets\\minecraft\\sounds\\{p}' for p in [
                    'music\\overworld\\snowyatmosphere.ogg', 'music\\overworld\\moonlitforest.ogg',
                    'music\\game\\twilightbattle.ogg', 'music\\nether\\veilofmist.ogg', 'ambient\\suspense\\end.ogg',
                    'music\\overworld\\darkambientsoundscape.ogg', 'ambient\\wind\\howling-wind.ogg']]],
               check=True, stdout=subprocess.DEVNULL)
shutil.copy(PICK + 'License.txt', mk(OUT + 'licenses/RPGAmbientMusic__License.txt'))
for key, f in MUSIC.items():
    src = PICK + f
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'csv=p=0', src]).decode())
    t = min(dur, 75.0)
    dst = mk(OUT + f'music/{key}.ogg')
    ff(['-i', src, '-t', f'{t}', '-af', f'afade=t=in:d=1.5,afade=t=out:st={t - 2.5}:d=2.5',
        '-c:a', 'libvorbis', '-q:a', '0', dst])  # q0 ≈ 64 kbps
    catalog.setdefault('music', {})[key] = f'music/{key}.ogg'

# ---------- 8. Licenças junto dos assets ----------
for lic in glob.glob(RAW + '**/license*.txt', recursive=True) + glob.glob(RAW + '**/License.txt', recursive=True) \
        + glob.glob(RAW + '**/LICENSE.txt', recursive=True) + glob.glob(RAW + '**/*License Agreement.docx', recursive=True):
    parts = lic[len(RAW):].replace('\\', '/').split('/')
    owner = parts[0] if len(parts) == 2 else parts[0] + '__' + parts[-2]  # subpastas de autor (VFX)
    name = (owner + '__' + parts[-1]).replace(' ', '_')
    shutil.copy(lic, mk(OUT + 'licenses/' + name))

catalog['icons'] = sorted(os.path.relpath(d, OUT).replace('\\', '/') for d in glob.glob(OUT + 'icons/*'))
catalog['fonts'] = {'pixel': 'fonts/boldpixels.ttf'}
with open(OUT + 'catalog.json', 'w', encoding='utf-8') as fh:
    json.dump(catalog, fh, ensure_ascii=False, indent=2)

# self-check: tudo citado no catálogo existe e o total cabe no orçamento web
paths = []
for sec in ('bg', 'sfx', 'music'):
    paths += catalog[sec].values()
for v in catalog['vfx'].values():
    paths += v if isinstance(v, list) else [v]
missing = [p for p in paths if not os.path.exists(OUT + p)]
assert not missing, missing
total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print(f'OK: {len(paths)} itens catalogados, total {total / 1e6:.2f} MB')
assert total < 15e6, 'curadoria passou de 15 MB'
