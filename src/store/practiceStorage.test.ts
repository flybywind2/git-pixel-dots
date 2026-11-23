import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageState } from '../engine';
import type { PixelSimState } from '../types/sim';
import { readPracticeSessions } from './practiceStorage';

const SESSION_KEY = 'gitdots.practice.v4.ch5';

function installStorage() {
  const saved = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
      removeItem: (key: string) => { saved.delete(key); },
      clear: () => { saved.clear(); },
      key: (index: number) => [...saved.keys()][index] ?? null,
      get length() { return saved.size; },
    },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  return saved;
}

function storeSession(sim: PixelSimState, saved: Map<string, string>) {
  const { lastAnim, terminal: _terminal, ...snapshot } = sim;
  saved.set(SESSION_KEY, JSON.stringify({ sim: snapshot, seq: lastAnim.seq, documentDraft: null }));
}

describe('practice storage seed migration', () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = installStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a current ch5 session that includes the fix/font example branch', () => {
    storeSession(createStageState('ch5'), saved);
    const { sessions, issues } = readPracticeSessions();
    expect(sessions.ch5).toBeDefined();
    expect(issues.ch5).toBeUndefined();
  });

  it('flags an older ch5 session without fix/font as example-updated', () => {
    const old = createStageState('ch5');
    const branches = { ...old.branches };
    const remoteBranches = { ...old.remoteBranches };
    delete branches['fix/font'];
    delete remoteBranches['fix/font'];
    storeSession({ ...old, branches, remoteBranches }, saved);

    const { sessions, issues } = readPracticeSessions();
    expect(saved.has(SESSION_KEY)).toBe(true);
    expect(issues.ch5).toBe('example-updated');
    expect(sessions.ch5).toBeUndefined();
  });
});