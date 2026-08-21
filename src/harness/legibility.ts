/**
 * Text Legibility harness. PRD Section 3.2.
 *
 * Animated worst-case backdrop (fog, moving silhouettes, shake) behind the
 * same prompt CSS the game uses. Reports the WCAG contrast ratio of the
 * prompt text against its panel, judged against the 7:1 floor. Final
 * signoff also gets eyeballed inside the real game scene; this page makes
 * the ratio and flash cap measurable.
 */

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const promptEl = document.getElementById('prompt')!;
const report = document.getElementById('report')!;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const opts = {
  fog: true,
  enemyMotion: true,
  shake: false,
  flash: false,
  hc: false,
};
for (const key of ['fog', 'enemyMotion', 'shake', 'flash', 'hc'] as const) {
  const el = document.getElementById(key) as HTMLInputElement;
  el.addEventListener('change', () => {
    opts[key] = el.checked;
    if (key === 'hc') document.body.classList.toggle('hc', el.checked);
    updateReport();
  });
}
(document.getElementById('size') as HTMLInputElement).addEventListener('input', (e) => {
  const v = (e.target as HTMLInputElement).value;
  document.documentElement.style.setProperty('--prompt-size', `${v}px`);
});

// Sample prompt content, mid-word with the error state togglable.
promptEl.innerHTML =
  '<span class="done">fla</span><span class="current">s</span><span>k</span>';

// WCAG 2.3.1: at most 3 flashes per second. We flash at 2 Hz max.
let lastFlash = 0;
function maybeFlash(t: number): void {
  if (!opts.flash) {
    promptEl.classList.remove('error');
    return;
  }
  if (t - lastFlash > 500) {
    lastFlash = t;
    promptEl.classList.toggle('error');
  }
}

interface Silhouette { x: number; z: number; speed: number; }
const shapes: Silhouette[] = Array.from({ length: 4 }, (_, i) => ({
  x: (i / 4) * 1.6 - 0.8,
  z: 8 + i * 6,
  speed: 0.8 + (i % 3) * 0.4,
}));

function draw(t: number): void {
  const w = canvas.width;
  const h = canvas.height;
  let ox = 0;
  let oy = 0;
  if (opts.shake) {
    ox = Math.sin(t / 43) * 9;
    oy = Math.cos(t / 31) * 7;
  }
  ctx.setTransform(1, 0, 0, 1, ox, oy);
  ctx.fillStyle = '#0a0b0f';
  ctx.fillRect(-20, -20, w + 40, h + 40);

  // Corridor floor glow
  const grad = ctx.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.45, h * 0.8);
  grad.addColorStop(0, '#2a3340');
  grad.addColorStop(1, '#05060a');
  ctx.fillStyle = grad;
  ctx.fillRect(-20, -20, w + 40, h + 40);

  if (opts.enemyMotion) {
    for (const s of shapes) {
      s.z -= s.speed * 0.016;
      if (s.z < 1.2) s.z = 26;
      const scale = 1 / s.z;
      const sw = 260 * scale * 3;
      const sh = 760 * scale * 3;
      const sx = w / 2 + s.x * w * 0.5 * scale * 3 + Math.sin(t / 500 + s.z) * 20 * scale;
      const sy = h * 0.45 - sh * 0.35;
      ctx.fillStyle = `rgba(60, 30, 30, ${Math.min(0.85, scale * 2.2)})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (opts.fog) {
    for (let i = 0; i < 3; i++) {
      const fx = ((t / (30 + i * 17)) % (w + 600)) - 300;
      const fy = h * (0.3 + i * 0.2);
      const fgrad = ctx.createRadialGradient(fx, fy, 20, fx, fy, 420);
      fgrad.addColorStop(0, 'rgba(160,170,190,0.14)');
      fgrad.addColorStop(1, 'rgba(160,170,190,0)');
      ctx.fillStyle = fgrad;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
  }

  maybeFlash(t);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ----- WCAG contrast math -----
function luminance(r: number, g: number, b: number): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(...fg);
  const l2 = luminance(...bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseColor(css: string): [number, number, number, number] {
  const el = document.createElement('div');
  el.style.color = css;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  const m = computed.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return [255, 255, 255, 1];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function composite(
  top: [number, number, number, number],
  under: [number, number, number],
): [number, number, number] {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
  ];
}

function updateReport(): void {
  const styles = getComputedStyle(promptEl);
  const fg = parseColor(styles.color);
  const done = parseColor(getComputedStyle(promptEl.querySelector('.done')!).color);
  const panel = parseColor(styles.backgroundColor);
  // Worst case behind the translucent panel: the brightest fog plume.
  const worstScene: [number, number, number] = [90, 100, 120];
  const effectiveBg = composite(panel, worstScene);
  const rMain = ratio([fg[0], fg[1], fg[2]], effectiveBg);
  const rDone = ratio([done[0], done[1], done[2]], effectiveBg);
  const worst = Math.min(rMain, rDone);
  const pass = worst >= 7;
  report.innerHTML =
    `Prompt contrast vs worst-case backdrop: <b class="${pass ? 'pass' : 'fail'}">` +
    `${worst.toFixed(1)}:1 ${pass ? 'PASS' : 'FAIL'}</b> (floor 7:1; ` +
    `untyped ${rMain.toFixed(1)}:1, typed ${rDone.toFixed(1)}:1)<br/>` +
    `Flash cap: 2/sec max (WCAG 2.3.1 allows 3)`;
}
updateReport();
