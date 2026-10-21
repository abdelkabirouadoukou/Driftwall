import { useEffect, useRef } from 'react';
import { sceneById } from '../lib/scenes.ts';

interface Props {
  sceneId: string;
  /** Frames per second cap (wallpaper: 30, previews: 15). */
  fps?: number;
  playing?: boolean;
  className?: string;
}

/**
 * Renders a built-in scene into a canvas. The loop only runs while `playing`
 * and the page is visible, and is throttled to `fps`, so a paused or hidden
 * scene costs nothing.
 */
export default function SceneCanvas({ sceneId, fps = 30, playing = true, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const def = sceneById(sceneId);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !def || !ctx) return;

    let raf = 0;
    let disposed = false;
    let scene = def.create(1, 1);
    let time = 0;
    let last = performance.now();
    const interval = 1000 / fps;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1) * def.scale;
      const w = Math.max(2, Math.round(canvas.clientWidth * ratio));
      const h = Math.max(2, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        scene = def.create(w, h);
      }
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);

    if (!playing) {
      // Paused: keep whatever is on screen, but paint one still frame the
      // first time so a preview is never blank.
      if (drawnRef.current !== sceneId) {
        scene.frame(ctx, 4, 0.016);
        drawnRef.current = sceneId;
      }
      return () => observer?.disconnect();
    }

    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        return;
      }
      const elapsed = now - last;
      if (elapsed < interval) return;
      last = now - (elapsed % interval);
      const dt = Math.min(elapsed, 100) / 1000;
      time += dt;
      scene.frame(ctx, time, dt);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [sceneId, fps, playing]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
