import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guards the app-shell scrolling contract. jsdom has no layout engine, so we
// assert the CSS invariants whose absence caused the "pages don't scroll" bug:
// a flex/grid child with `min-height: auto` refuses to shrink below its content
// and stops scrolling, while <body> clips the overflow.
const raw = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

describe('app shell layout', () => {
  it('locks the root chain to the window height', () => {
    expect(css).toContain('html,body,#root{height:100%;margin:0;overflow:hidden;}');
  });

  it('makes the main pane the single scroll container', () => {
    expect(css).toContain('.content{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;');
  });

  it('allows every flex/grid ancestor of the scroller to shrink', () => {
    expect(css).toContain('.main{display:flex;flex-direction:column;min-width:0;');
    expect(css).toContain('min-height:0;height:100%;}');
    expect(css).toContain('.app{display:grid;grid-template-columns:var(--sidebar-w)minmax(0,1fr);grid-template-rows:minmax(0,1fr);');
    expect(css).toContain('.sidebar{display:flex;flex-direction:column;gap:var(--space-1);min-height:0;overflow-y:auto;');
  });

  it('keeps the top bar fixed above the scroller', () => {
    expect(css).toContain('.topbar{display:flex;align-items:center;gap:var(--space-3);flex:none;');
  });

  it('styles a thin, token-consistent scrollbar', () => {
    expect(css).toContain('::-webkit-scrollbar{width:10px;height:10px;}');
    expect(css).toContain('::-webkit-scrollbar-thumb{background:var(--border-strong);');
  });
});
