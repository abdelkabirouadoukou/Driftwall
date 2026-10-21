import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the app-shell scrolling and window-chrome contract. jsdom has no
// layout engine, so we parse the stylesheet and assert the invariants whose
// absence caused real bugs: a flex/grid child with `min-height: auto` refuses
// to shrink below its content and stops scrolling, while <body> clips the
// overflow. Parsing rules (rather than matching raw strings) keeps the test
// valid when the stylesheet is reformatted or reordered.
const raw = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

type Decls = Record<string, string>;
const rules = new Map<string, Decls>();
for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const declarations: Decls = {};
  for (const part of match[2]!.split(';')) {
    const index = part.indexOf(':');
    if (index > 0) declarations[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  for (const selector of match[1]!.split(',').map((s) => s.trim())) {
    rules.set(selector, { ...rules.get(selector), ...declarations });
  }
}

const style = (selector: string): Decls => {
  const found = rules.get(selector);
  if (!found) throw new Error(`No CSS rule for ${selector}`);
  return found;
};

describe('app shell layout', () => {
  it('locks the root chain to the window height', () => {
    for (const selector of ['html', 'body', '#root']) {
      expect(style(selector)).toMatchObject({ height: '100%', overflow: 'hidden' });
    }
  });

  it('makes the content pane the single scroll container', () => {
    expect(style('.content')).toMatchObject({
      flex: '1',
      'min-height': '0',
      'overflow-y': 'auto',
      'overscroll-behavior': 'contain',
    });
  });

  it('lets every flex/grid ancestor of the scroller shrink', () => {
    expect(style('.main')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      'min-width': '0',
      'min-height': '0',
      height: '100%',
    });
    expect(style('.app')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'var(--sidebar-w) minmax(0, 1fr)',
      'grid-template-rows': 'minmax(0, 1fr)',
    });
    expect(style('.sidebar')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      'min-height': '0',
      'overflow-y': 'auto',
    });
  });

  it('keeps the top bar fixed above the scroller', () => {
    expect(style('.topbar')).toMatchObject({ display: 'flex', flex: 'none' });
  });

  it('styles a thin, token-consistent scrollbar', () => {
    expect(style('::-webkit-scrollbar')).toMatchObject({ width: '12px', height: '12px' });
    expect(style('::-webkit-scrollbar-thumb')['border-radius']).toBe('var(--radius-pill)');
  });
});

describe('window chrome', () => {
  it('floats the panels with a gap, so the title bar can be transparent', () => {
    expect(style('.app').padding).toBe('var(--gap)');
    expect(style('.app').gap).toBe('var(--gap)');
    expect(style('.main')['border-radius']).toBe('var(--radius-xl)');
    expect(style('.sidebar')['border-radius']).toBe('var(--radius-xl)');
  });

  it('leaves room for the traffic lights above the sidebar content', () => {
    const top = Number.parseInt(style('.sidebar').padding!.split(' ')[0]!, 10);
    expect(top).toBeGreaterThanOrEqual(48);
  });

  it('provides drag regions that sit above the panels', () => {
    for (const selector of ['.drag-top', '.drag-side']) {
      expect(style(selector).position).toBe('absolute');
      expect(Number(style(selector)['z-index'])).toBeGreaterThan(0);
    }
  });

  it('stacks overlays in order: drawer above scrim above content, toasts on top', () => {
    const z = (s: string) => Number(style(s)['z-index']);
    expect(z('.drawer')).toBeGreaterThan(z('.drawer-scrim'));
    expect(z('.drawer-scrim')).toBeGreaterThan(z('.dropzone'));
    expect(z('.dl-pop')).toBeGreaterThan(z('.drawer'));
    expect(z('.toasts')).toBeGreaterThan(z('.dl-pop'));
  });
});
