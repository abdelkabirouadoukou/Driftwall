import { describe, expect, it } from 'vitest';
import { parsePlayerMessage } from './ytBridge.ts';

describe('parsePlayerMessage', () => {
  it('accepts the three messages the player page sends', () => {
    expect(parsePlayerMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parsePlayerMessage({ type: 'state', state: 1, title: 'Song', muted: false })).toEqual({
      type: 'state',
      state: 1,
      title: 'Song',
      muted: false,
    });
    expect(parsePlayerMessage({ type: 'error', code: 153 })).toEqual({ type: 'error', code: 153 });
  });

  it('fills in safe defaults for a sparse state message', () => {
    expect(parsePlayerMessage({ type: 'state', state: 2 })).toEqual({
      type: 'state',
      state: 2,
      title: '',
      muted: false,
    });
  });

  it('drops anything malformed or unknown', () => {
    expect(parsePlayerMessage(null)).toBeNull();
    expect(parsePlayerMessage('ready')).toBeNull();
    expect(parsePlayerMessage({ type: 'state', state: '1' })).toBeNull();
    expect(parsePlayerMessage({ type: 'error', code: 'x' })).toBeNull();
    expect(parsePlayerMessage({ type: 'steal-cookies' })).toBeNull();
  });
});
