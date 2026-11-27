import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageState, executePixelCommand, getNextPendingStep } from '../engine';
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

  it('restores the next goal and work without the previous command error or output', () => {
    const progressed = executePixelCommand(createStageState('ch5'), 'gh auth status');
    const command = 'unknown-test-command';
    const failed = executePixelCommand(progressed, command);
    expect(failed.bubbles[0].title).toMatch(/모르는 명령어/);
    expect(failed.terminal.at(-1)?.command).toBe(command);
    storeSession(failed, saved);

    const resumed = readPracticeSessions().sessions.ch5?.sim;
    expect(resumed?.bubbles[0].title).toBe('하던 실습을 이어 가요');
    expect(resumed?.bubbles[0].message).toBe(getNextPendingStep(progressed)?.goal);
    expect(resumed?.files).toEqual(progressed.files);
    expect(resumed?.completedActions).toEqual(progressed.completedActions);
    expect(resumed?.terminal.map((entry) => entry.command)).toEqual(['welcome']);
  });

  it('removes legacy keys after migrating a valid older session into v4', () => {
    const docs = createStageState('docs');
    const { lastAnim, terminal: _terminal, ...snapshot } = docs;
    saved.set('gitdots.practice.v2.docs', JSON.stringify({ sim: snapshot, seq: lastAnim.seq, documentDraft: null }));

    const { sessions, issues } = readPracticeSessions();
    expect(sessions.docs).toBeDefined();
    expect(issues.docs).toBeUndefined();
    expect(saved.has('gitdots.practice.v4.docs')).toBe(true);
    expect(saved.has('gitdots.practice.v2.docs')).toBe(false);
  });
});
