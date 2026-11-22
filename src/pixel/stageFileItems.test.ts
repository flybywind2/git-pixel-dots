import { describe, expect, it } from 'vitest';
import { createStageState, executePixelCommand } from '../engine';
import { DOCUMENT_PATH } from '../engine/documentDiff';
import { SECRET_NOTE_PATH } from '../engine/meetingExample';
import { remoteHasRevertCommit, remoteRelation } from '../engine/repoVersions';
import { buildStageFileItems } from './stageFileItems';

describe('stage file cards', () => {
  it('keeps the staged copy visible beside a newer working edit', () => {
    let state = createStageState('ch1');
    state = executePixelCommand(state, 'git add .');
    const stagedDocument = state.index[DOCUMENT_PATH];
    state = executePixelCommand(state, `edit ${DOCUMENT_PATH}`);

    const item = buildStageFileItems(state, 'ch1').find((file) => file.name === DOCUMENT_PATH);
    expect(item).toBeDefined();
    expect(item?.badges).toEqual(expect.arrayContaining(['staged', 'extra-edit']));
    expect(item?.stagedContent).toBe(stagedDocument);
    expect(item?.workingContent).not.toBe(stagedDocument);
    expect(item?.workingContent).toContain('스터디 준비 사항을 확인했어요.');
  });

  it('lists every stash entry by its stash@{n} label instead of only the latest one', () => {
    let state = createStageState('ch1');
    state = executePixelCommand(state, 'git stash');
    state = executePixelCommand(state, `edit ${DOCUMENT_PATH}`);
    state = executePixelCommand(state, 'git stash -u');
    expect(state.stashes).toHaveLength(2);

    const items = buildStageFileItems(state, 'ch2');
    const stashLabels = new Set(items.flatMap((item) => item.stash ? [item.stash.label] : []));
    expect(stashLabels).toContain('stash@{0}');
    expect(stashLabels).toContain('stash@{1}');
    const entries = items.filter((item) => item.stash);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((item) => item.badges.includes('stashed'))).toBe(true);
  });
});

describe('remote share relation', () => {
  it('reports ahead before push and synced afterwards', () => {
    let state = createStageState('ch2');
    expect(remoteRelation(state)).toBe('synced');
    state = executePixelCommand(state, `git restore --staged ${SECRET_NOTE_PATH}`);
    state = executePixelCommand(state, 'git revert HEAD');
    expect(state.lastAnim.kind).toBe('REVERT');
    expect(remoteRelation(state)).toBe('ahead');
    state = executePixelCommand(state, 'git push');
    expect(remoteRelation(state)).toBe('synced');
    expect(remoteHasRevertCommit(state)).toBe(true);
  });

  it('reports a soft reset as behind until the revert is shared again', () => {
    let state = createStageState('ch2');
    state = executePixelCommand(state, `git restore --staged ${SECRET_NOTE_PATH}`);
    state = executePixelCommand(state, 'git revert HEAD');
    state = executePixelCommand(state, 'git push');
    state = executePixelCommand(state, 'git reset --soft HEAD~1');
    expect(remoteRelation(state)).toBe('behind');
    expect(remoteHasRevertCommit(state)).toBe(true);
  });

  it('does not show a remote revert gem for an unshared local-only revert', () => {
    let state = createStageState('ch2');
    state = executePixelCommand(state, `git restore --staged ${SECRET_NOTE_PATH}`);
    state = executePixelCommand(state, 'git revert HEAD');
    expect(remoteRelation(state)).toBe('ahead');
    expect(remoteHasRevertCommit(state)).toBe(false);
  });
});