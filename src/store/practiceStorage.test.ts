import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageState, executePixelCommand, getNextPendingStep } from '../engine';
import type { PixelSimState } from '../types/sim';
import { readExternalSession, readPracticeSessions, writePracticeSession } from './practiceStorage';

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

function storeSession(sim: PixelSimState, saved: Map<string, string>, exampleVersion?: number) {
  const { lastAnim, terminal: _terminal, ...snapshot } = sim;
  saved.set(`gitdots.practice.v4.${sim.stageId}`, JSON.stringify({
    sim: snapshot, seq: lastAnim.seq, documentDraft: null, exampleVersion,
  }));
}

describe('practice storage seed migration', () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = installStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts an unversioned ch5 session with the current seed after local branch cleanup', () => {
    const sim = createStageState('ch5');
    delete sim.branches['fix/font'];
    storeSession(sim, saved);
    const { sessions, issues } = readPracticeSessions();
    expect(sessions.ch5).toBeDefined();
    expect(issues.ch5).toBeUndefined();
  });

  it('flags an older ch5 session without the fix/font example commit as example-updated', () => {
    const old = createStageState('ch5');
    const branches = { ...old.branches };
    const remoteBranches = { ...old.remoteBranches };
    delete branches['fix/font'];
    delete remoteBranches['fix/font'];
    storeSession({ ...old, branches, remoteBranches, commits: old.commits.filter(({ id }) => id !== 'c0') }, saved);

    const { sessions, issues } = readPracticeSessions();
    expect(saved.has(SESSION_KEY)).toBe(true);
    expect(issues.ch5).toBe('example-updated');
    expect(sessions.ch5).toBeUndefined();
  });

  it('restores a user-created feature/ui branch from both unversioned and newly saved ch3 snapshots', () => {
    const sim = executePixelCommand(createStageState('ch3'), 'git switch -c feature/ui');
    const key = 'gitdots.practice.v4.ch3';
    storeSession(sim, saved);
    expect(readPracticeSessions().issues.ch3).toBeUndefined();
    expect(readPracticeSessions().sessions.ch3?.sim.headBranch).toBe('feature/ui');

    writePracticeSession({ sim, documentDraft: null });
    const raw = saved.get(key)!;
    expect(JSON.parse(raw).exampleVersion).toBe(2);
    expect(readPracticeSessions().sessions.ch3?.sim.branches['feature/ui']).toBe(sim.branches['feature/ui']);
    expect(readExternalSession(key, raw)?.session.sim.headBranch).toBe('feature/ui');
  });

  it('flags the old ch3 seed even when the user has deleted its original local branch', () => {
    const sim = createStageState('ch3');
    sim.commits = sim.commits.map((commit) => commit.id === 'c3'
      ? { ...commit, branch: 'feature/ui', message: 'UI 버튼 색상 변경' } : commit);
    sim.branches = { main: 'c2' };
    sim.remoteBranches = { main: 'c2', 'feature/ui': 'c3' };
    storeSession(sim, saved);
    const key = 'gitdots.practice.v4.ch3';
    expect(readPracticeSessions().issues.ch3).toBe('example-updated');
    expect(readExternalSession(key, saved.get(key)!)).toBeNull();
  });

  it('uses the explicit ch3 example version even when the snapshot has the current seed', () => {
    storeSession(createStageState('ch3'), saved, 1);
    expect(readPracticeSessions()).toEqual({ sessions: {}, issues: { ch3: 'example-updated' } });
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
