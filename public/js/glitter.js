// Glitter: estrelinhas que piscam no fundo, rastro atrás do cursor e explosão ao clicar.

const canvas = document.getElementById('glitter');
const ctx = canvas.getContext('2d');
const toggle = document.getElementById('glitter-toggle');

const COLORS = ['#b07cff', '#8b45f5', '#e2d1ff', '#3ddc84', '#7dffb3', '#ffffff'];
const MAX_BITS = 220;

let width = 0;
let height = 0;
let stars = [];   // brilhos fixos que piscam e sobem devagar
let bits = [];    // partículas do cursor/clique, que caem e somem
let raf = null;
let lastPointer = null;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function readPref() {
  try {
    const saved = localStorage.getItem('glitter');
    if (saved) return saved === 'on';
  } catch {}
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let enabled = readPref();

function makeStar(y = rand(0, height)) {
  return {
    x: rand(0, width), y,
    r: rand(0.8, 2.4),
    color: pick(COLORS),
    phase: rand(0, Math.PI * 2),
    speed: rand(0.6, 2),
    drift: rand(0.03, 0.15),
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.round(Math.min(70, Math.max(18, (width * height) / 22000)));
  stars = Array.from({ length: count }, () => makeStar());
}

/** Estrela de quatro pontas com um miolo brilhante. */
function sparkle(x, y, r, alpha, color) {
  const arm = r * 2.6;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - arm);
  ctx.quadraticCurveTo(x, y, x + arm, y);
  ctx.quadraticCurveTo(x, y, x, y + arm);
  ctx.quadraticCurveTo(x, y, x - arm, y);
  ctx.quadraticCurveTo(x, y, x, y - arm);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.35;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
  ctx.fill();
}

function frame(time) {
  ctx.clearRect(0, 0, width, height);
  const t = time / 1000;

  for (const s of stars) {
    s.y -= s.drift;
    if (s.y < -10) Object.assign(s, makeStar(height + 10));
    // Elevar ao cubo deixa o brilho "piscar" em picos curtos, como glitter
    const tw = ((Math.sin(t * s.speed + s.phase) + 1) / 2) ** 3;
    if (tw > 0.02) sparkle(s.x, s.y, s.r * (0.5 + tw * 0.6), tw * 0.85, s.color);
  }

  bits = bits.filter((b) => b.life > 0);
  for (const b of bits) {
    b.x += b.vx;
    b.y += b.vy;
    b.vy += 0.05;
    b.vx *= 0.98;
    b.life -= 1;
    const alpha = b.life / b.maxLife;
    const flicker = 0.6 + 0.4 * Math.sin(b.life * 0.6);
    sparkle(b.x, b.y, b.r * alpha, alpha * flicker, b.color);
  }

  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

function spawn(x, y, count, spread) {
  for (let i = 0; i < count && bits.length < MAX_BITS; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(0.3, spread);
    const life = Math.round(rand(35, 75));
    bits.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - spread * 0.3,
      r: rand(1, 2.6),
      color: pick(COLORS),
      life, maxLife: life,
    });
  }
}

function onPointerMove(e) {
  if (e.pointerType === 'touch') return;
  const p = { x: e.clientX, y: e.clientY };
  if (lastPointer && Math.hypot(p.x - lastPointer.x, p.y - lastPointer.y) < 10) return;
  lastPointer = p;
  spawn(p.x, p.y, 2, 1.2);
}

function onPointerDown(e) {
  spawn(e.clientX, e.clientY, 16, 3.2);
}

function start() {
  if (raf || !enabled || document.hidden) return;
  resize();
  canvas.hidden = false;
  raf = requestAnimationFrame(frame);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  bits = [];
  ctx.clearRect(0, 0, width, height);
  canvas.hidden = true;
}

function setEnabled(value) {
  enabled = value;
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.title = enabled ? 'Desligar glitter' : 'Ligar glitter';
  try { localStorage.setItem('glitter', enabled ? 'on' : 'off'); } catch {}
  enabled ? start() : stop();
}

toggle.addEventListener('click', () => setEnabled(!enabled));
window.addEventListener('resize', () => { if (raf) resize(); });
window.addEventListener('pointermove', (e) => { if (raf) onPointerMove(e); }, { passive: true });
window.addEventListener('pointerdown', (e) => { if (raf) onPointerDown(e); }, { passive: true });
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

toggle.setAttribute('aria-pressed', String(enabled));
toggle.title = enabled ? 'Desligar glitter' : 'Ligar glitter';
start();
