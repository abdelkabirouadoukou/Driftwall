/**
 * Built-in animated wallpapers, drawn in code: no downloads, no API keys, no
 * licences, and tiny CPU use. Each scene renders to a canvas (often at a
 * fraction of the screen resolution, which is invisible for soft scenes and
 * saves a lot of GPU/battery on a fanless laptop).
 */

export interface SceneInstance {
  /** Draws one frame. `t` is seconds of running time, `dt` the step since the last frame. */
  frame(ctx: CanvasRenderingContext2D, t: number, dt: number): void;
}

export interface SceneDef {
  id: string;
  name: string;
  description: string;
  /** Fraction of the CSS size the canvas is rendered at (1 = full). */
  scale: number;
  create(width: number, height: number): SceneInstance;
}

export const SCENE_PREFIX = 'scene:';

/** `scene:aurora` -> `aurora`; anything else -> null. */
export function sceneIdFromCurrent(currentId: string | null | undefined): string | null {
  return currentId && currentId.startsWith(SCENE_PREFIX) ? currentId.slice(SCENE_PREFIX.length) : null;
}

/** Small deterministic PRNG so scenes look the same on every display. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ aurora */

const aurora: SceneDef = {
  id: 'aurora',
  name: 'Aurora',
  description: 'Slow green and violet curtains over a dark sky.',
  scale: 0.4,
  create(w, h) {
    return {
      frame(ctx, t) {
        ctx.globalCompositeOperation = 'source-over';
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#02030a');
        sky.addColorStop(1, '#070a1a');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        const step = 2;
        for (let x = 0; x < w; x += step) {
          const n =
            Math.sin(x * 0.012 + t * 0.3) +
            Math.sin(x * 0.031 - t * 0.5) * 0.5 +
            Math.sin(x * 0.006 + t * 0.17);
          const top = h * 0.22 + n * h * 0.07;
          const len = h * 0.42 * (0.65 + 0.35 * Math.sin(x * 0.017 + t * 0.4));
          const hue = 150 + 70 * (0.5 + 0.5 * Math.sin(x * 0.004 + t * 0.1));
          const g = ctx.createLinearGradient(0, top, 0, top + len);
          g.addColorStop(0, `hsla(${hue}, 90%, 60%, 0)`);
          g.addColorStop(0.3, `hsla(${hue}, 90%, 60%, 0.42)`);
          g.addColorStop(1, `hsla(${hue + 40}, 80%, 50%, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x, top, step, len);
        }
      },
    };
  },
};

/* ------------------------------------------------------------------ nebula */

const nebula: SceneDef = {
  id: 'nebula',
  name: 'Nebula',
  description: 'Soft drifting clouds of colour, like a living gradient.',
  scale: 0.3,
  create(w, h) {
    const rand = mulberry32(7);
    const blobs = Array.from({ length: 6 }, (_, i) => ({
      px: rand() * TAU,
      py: rand() * TAU,
      sx: 0.05 + rand() * 0.08,
      sy: 0.04 + rand() * 0.07,
      r: 0.35 + rand() * 0.25,
      hue: [265, 190, 320, 230, 160, 290][i],
    }));
    return {
      frame(ctx, t) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#05050d';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        for (const b of blobs) {
          const x = w * (0.5 + 0.4 * Math.sin(t * b.sx + b.px));
          const y = h * (0.5 + 0.4 * Math.sin(t * b.sy + b.py));
          const r = Math.max(w, h) * b.r;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `hsla(${b.hue}, 85%, 55%, 0.5)`);
          g.addColorStop(1, `hsla(${b.hue}, 85%, 55%, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      },
    };
  },
};

/* ------------------------------------------------------------------- waves */

const waves: SceneDef = {
  id: 'waves',
  name: 'Deep waves',
  description: 'Layered ocean swells in teal and midnight blue.',
  scale: 0.5,
  create(w, h) {
    const layers = 5;
    return {
      frame(ctx, t) {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#061423');
        bg.addColorStop(1, '#020812');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < layers; i++) {
          const base = h * (0.42 + i * 0.1);
          const amp = h * (0.03 + i * 0.008);
          const speed = 0.25 + i * 0.07;
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let x = 0; x <= w; x += 4) {
            const y =
              base +
              Math.sin(x * 0.006 * (1 + i * 0.25) + t * speed + i) * amp +
              Math.sin(x * 0.013 - t * speed * 0.7) * amp * 0.4;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          const g = ctx.createLinearGradient(0, base - amp, 0, h);
          g.addColorStop(0, `hsla(${185 + i * 8}, 70%, ${38 - i * 4}%, 0.55)`);
          g.addColorStop(1, `hsla(${215 + i * 6}, 70%, ${10}%, 0.9)`);
          ctx.fillStyle = g;
          ctx.fill();
        }
      },
    };
  },
};

/* --------------------------------------------------------------- starfield */

const starfield: SceneDef = {
  id: 'starfield',
  name: 'Starfield',
  description: 'A quiet night sky with slowly drifting, twinkling stars.',
  scale: 0.75,
  create(w, h) {
    const rand = mulberry32(42);
    const count = Math.round(Math.min(420, (w * h) / 2600));
    const stars = Array.from({ length: count }, () => ({
      x: rand() * w,
      y: rand() * h,
      z: 0.2 + rand() * 0.8,
      tw: rand() * TAU,
    }));
    return {
      frame(ctx, t, dt) {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
        bg.addColorStop(0, '#0b1030');
        bg.addColorStop(1, '#02030a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        for (const s of stars) {
          s.x -= dt * 6 * s.z;
          if (s.x < -2) s.x = w + 2;
          const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.6 + s.z) + s.tw));
          ctx.fillStyle = `rgba(220, 230, 255, ${a * s.z})`;
          const size = 0.6 + s.z * 1.4;
          ctx.fillRect(s.x, s.y, size, size);
        }
      },
    };
  },
};

/* ------------------------------------------------------------------- drift */

const drift: SceneDef = {
  id: 'drift',
  name: 'Drift',
  description: 'Glowing orbs floating upward in violet and teal.',
  scale: 0.6,
  create(w, h) {
    const rand = mulberry32(99);
    const orbs = Array.from({ length: 34 }, () => ({
      x: rand() * w,
      y: rand() * h,
      r: (0.02 + rand() * 0.06) * Math.min(w, h),
      v: 4 + rand() * 12,
      ph: rand() * TAU,
      hue: rand() < 0.5 ? 262 : 172,
    }));
    return {
      frame(ctx, t, dt) {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#0a0716');
        bg.addColorStop(1, '#050a14');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        for (const o of orbs) {
          o.y -= o.v * dt;
          if (o.y < -o.r) {
            o.y = h + o.r;
            o.x = Math.random() * w;
          }
          const x = o.x + Math.sin(t * 0.3 + o.ph) * o.r * 0.8;
          const g = ctx.createRadialGradient(x, o.y, 0, x, o.y, o.r);
          g.addColorStop(0, `hsla(${o.hue}, 90%, 62%, 0.5)`);
          g.addColorStop(1, `hsla(${o.hue}, 90%, 62%, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, o.y, o.r, 0, TAU);
          ctx.fill();
        }
      },
    };
  },
};

/* -------------------------------------------------------------------- rain */

const rain: SceneDef = {
  id: 'rain',
  name: 'Night rain',
  description: 'Fine rain falling through a blue-black night.',
  scale: 0.6,
  create(w, h) {
    const rand = mulberry32(5);
    const count = Math.round(Math.min(260, (w * h) / 5000));
    const drops = Array.from({ length: count }, () => ({
      x: rand() * w,
      y: rand() * h,
      len: 8 + rand() * 16,
      v: 260 + rand() * 260,
      a: 0.15 + rand() * 0.35,
    }));
    return {
      frame(ctx, _t, dt) {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#05070f');
        bg.addColorStop(1, '#0b1424');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 1;
        for (const d of drops) {
          d.y += d.v * dt;
          d.x -= d.v * dt * 0.12;
          if (d.y > h + d.len) {
            d.y = -d.len;
            d.x = Math.random() * w;
          }
          ctx.strokeStyle = `rgba(170, 200, 255, ${d.a})`;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + d.len * 0.12, d.y - d.len);
          ctx.stroke();
        }
      },
    };
  },
};

export const SCENES: readonly SceneDef[] = [aurora, nebula, waves, starfield, drift, rain];

const BY_ID = new Map(SCENES.map((s) => [s.id, s]));

export function sceneById(id: string | null | undefined): SceneDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}
