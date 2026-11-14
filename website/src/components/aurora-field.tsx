import { useEffect, useRef } from "react";

/**
 * A slow-drifting aurora backdrop for the hero -- a nod to the real "Aurora"
 * scene built into Driftwall itself (see app/src/lib/scenes.ts), not a stock
 * stock-photo hero. Three soft radial blobs drift on independent paths;
 * everything is additive-blended so they never read as flat shapes.
 *
 * Paused off-screen (IntersectionObserver) and under reduced motion, where
 * it renders one static frame instead of looping.
 */
export default function AuroraField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let t = reduce ? 1000 : 0;

    // Green and violet, like the app's own built-in Aurora scene (see
    // app/src/lib/scenes.ts) rather than an arbitrary brand gradient.
    const blobs = [
      { x: 0.2, y: 0.3, r: 0.42, hue: 150, speed: 0.00018, phase: 0 },
      { x: 0.75, y: 0.2, r: 0.36, hue: 268, speed: 0.00013, phase: 2.1 },
      { x: 0.55, y: 0.75, r: 0.4, hue: 280, speed: 0.00021, phase: 4.2 },
    ];

    const resize = () => {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.width = Math.round(rect.width * dpr);
      h = cv.height = Math.round(rect.height * dpr);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const base = Math.max(w, h);
      for (const b of blobs) {
        const dx = Math.sin(t * b.speed + b.phase) * 0.08;
        const dy = Math.cos(t * b.speed * 0.8 + b.phase) * 0.08;
        const cx = (b.x + dx) * w;
        const cy = (b.y + dy) * h;
        const r = b.r * base;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `hsla(${b.hue}, 85%, 62%, 0.22)`);
        grad.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = () => {
      if (!visible) return;
      t += 16;
      draw();
      raf = requestAnimationFrame(loop);
    };

    resize();
    draw();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let io: IntersectionObserver | undefined;
    if (!reduce) {
      io = new IntersectionObserver(
        ([entry]) => {
          visible = entry?.isIntersecting ?? true;
          if (visible && !raf) raf = requestAnimationFrame(loop);
        },
        { threshold: 0.01 },
      );
      io.observe(cv);
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="h-full w-full" />;
}
