// Motor sensorial (Fase 2): SFX, música, VFX de tela, bioma, háptico, status na tela e QTE físico.
// Lê assets_curated/catalog.json; a IA manda só as chaves ("sfx", "vfx", "bioma", "musica", "haptico", "qte_fisico").
const BASE = "./assets_curated/";
const HAPTIC = {
  leve: [20],
  lamina: [15, 40, 15],
  impacto: [90],
  pesado: [140, 60, 220],
  gigante: [260, 120, 260, 120, 260]
};

let catalog = null;
let muted = false;
let music = null;
let musicKey = null;

const layer = (id) => document.getElementById(id);

export async function initSensory(isMuted) {
  muted = !!isMuted;
  catalog = await fetch(BASE + "catalog.json").then((r) => r.json()).catch(() => null);
  // Navegadores bloqueiam áudio antes do 1º toque: retoma a música no primeiro gesto.
  document.addEventListener("pointerdown", () => music?.paused && !muted && music.play().catch(() => null), { once: true });
}

export const isMuted = () => muted;

// Chaves válidas para o prompt do Gemini.
export function fxKeys() {
  return {
    sfx: Object.keys(catalog?.sfx || {}),
    vfx: [...Object.keys(catalog?.vfx || {}), "tremor", "flash"],
    bioma: Object.keys(catalog?.bg || {}),
    musica: [...Object.keys(catalog?.music || {}), "silencio"],
    haptico: Object.keys(HAPTIC)
  };
}

export function setMuted(value) {
  muted = !!value;
  if (!music) return;
  if (muted) music.pause();
  else music.play().catch(() => null);
}

export function playSfx(key) {
  const file = catalog?.sfx?.[key];
  if (!file || muted) return;
  const a = new Audio(BASE + file);
  a.volume = 0.7;
  a.play().catch(() => null);
}

export function playMusic(key) {
  if (key === musicKey) return;
  music?.pause();
  music = null;
  musicKey = null;
  const file = catalog?.music?.[key];
  if (!file) return; // null/"" desliga a música
  musicKey = key;
  music = new Audio(BASE + file);
  music.loop = true;
  music.volume = 0.35;
  if (!muted) music.play().catch(() => null);
}

export function setBiome(key) {
  const file = catalog?.bg?.[key];
  const bg = layer("bg-layer");
  document.body.dataset.biome = file ? key : "";
  if (bg) bg.style.backgroundImage = file ? `url("${BASE + file}")` : "none";
}

export function haptic(kind) {
  if (!kind || !navigator.vibrate) return;
  navigator.vibrate(HAPTIC[kind] || HAPTIC.leve);
}

export function playVfx(key, ms = 3000) {
  const host = layer("vfx-layer");
  if (!host || !key) return;
  if (key === "tremor" || key === "flash") {
    document.body.classList.remove(`fx-${key}`);
    void document.body.offsetWidth; // reinicia a animação CSS
    document.body.classList.add(`fx-${key}`);
    setTimeout(() => document.body.classList.remove(`fx-${key}`), 700);
    return;
  }
  const entry = catalog?.vfx?.[key];
  if (!entry) return;
  if (typeof entry === "string") {
    // spritesheet de corte: 5 quadros de 128px na 1ª linha
    const el = document.createElement("div");
    el.className = "vfx-slash";
    el.style.backgroundImage = `url("${BASE + entry}")`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 600);
    return;
  }
  const count = key === "chuva" ? 60 : 36;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("img");
    p.src = BASE + entry[i % entry.length];
    p.className = `vfx-particle vfx-${key}`;
    const size = key === "chuva" ? 14 : 8 + Math.random() * 18;
    p.style.cssText = `left:${Math.random() * 100}%;width:${size}px;animation-duration:${(ms / 1000) * (0.6 + Math.random() * 0.6)}s;animation-delay:${Math.random() * 0.8}s`;
    host.appendChild(p);
  }
  setTimeout(() => host.querySelectorAll(".vfx-particle").forEach((p) => p.remove()), ms + 1500);
}

// Bordas pulsando conforme HP e status (veneno/congelado/sangramento).
export function updateStatusFx(player) {
  if (!player) return;
  const effects = (player.statusEffects || []).map((s) => String(s?.name || s).toLowerCase()).join(" ");
  const b = document.body.classList;
  b.toggle("st-critico", player.hp / player.hpMax <= 0.25);
  b.toggle("st-veneno", /venen|toxin/.test(effects));
  b.toggle("st-congelado", /congel|gelad|estase/.test(effects));
  b.toggle("st-sangue", /sangr/.test(effects));
}

// QTE físico: trava a tela até o jogador agitar/inclinar o celular (10 s). onDone(true|false).
export function startQte(kind, onDone) {
  const box = layer("qte-overlay");
  if (!box) return onDone(false);
  const agitar = kind !== "inclinar";
  box.querySelector(".qte-text").textContent = agitar ? "AGITE O CELULAR!" : "INCLINE O CELULAR!";
  box.classList.remove("hidden");
  playSfx("qte_alerta");
  haptic("pesado");

  let finished = false;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onTilt);
    box.classList.add("hidden");
    haptic(ok ? "leve" : "impacto");
    onDone(ok);
  };
  let shakes = 0;
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (a && Math.hypot(a.x || 0, a.y || 0, a.z || 0) > 25 && ++shakes >= 3) finish(true);
  };
  const onTilt = (e) => Math.abs(e.gamma || 0) > 45 && finish(true);
  if (agitar) window.addEventListener("devicemotion", onMotion);
  else window.addEventListener("deviceorientation", onTilt);
  const timer = setTimeout(() => finish(false), 10000);
  box.querySelector(".qte-giveup").onclick = () => finish(false);
}

export function applyFx(parsed) {
  if (!parsed) return;
  if (parsed.bioma) setBiome(parsed.bioma);
  if (typeof parsed.musica === "string") playMusic(parsed.musica); // "silencio" desliga
  [].concat(parsed.sfx || []).forEach(playSfx);
  [].concat(parsed.vfx || []).forEach((k) => playVfx(k));
  haptic(parsed.haptico);
}
