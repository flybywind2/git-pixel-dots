import { describe, expect, it } from 'vitest';
import { ALL_STAGE_IDS, type PixelSimState, type StageId } from '../types/sim';
import {
  STAGE_MAP,
  STAGE_SCENARIOS,
  createStageState,
  executePixelCommand,
  getCommandAutocomplete,
  getNextPendingStep,
  isStepCompleted,
  savePracticeDocument,
} from './index';
import { diffDocumentLines, DOCUMENT_COMPARISONS, DOCUMENT_PATH, getDocumentComparison, ORIGINAL_DOCUMENT } from './documentDiff';
import { ATTENDANCE_DOCUMENT, ATTENDANCE_PATH, MEETING_PR_BRANCH, MEETING_PR_TITLE, MEETING_REVIEWER, MISTAKEN_NOTICE_PATH, SECRET_NOTE_PATH } from './meetingExample';

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
  return obj;
}

function assertValidBubbles(state: PixelSimState): void {
  expect(state.bubbles.length).toBeGreaterThan(0);
  for (const bubble of state.bubbles) {
    expect(bubble.anchorX).toBeGreaterThanOrEqual(22);
    expect(bubble.anchorX).toBeLessThanOrEqual(78);
    expect(bubble.anchorY).toBeGreaterThanOrEqual(22);
    expect(bubble.anchorY).toBeLessThanOrEqual(78);
    expect(bubble.title.trim().length).toBeGreaterThan(0);
    expect(bubble.message.trim().length).toBeGreaterThan(0);
    expect(bubble.speakerName.trim().length).toBeGreaterThan(0);
  }
}

function runSequence(stageId: StageId, commands: string[]): PixelSimState {
  let state = deepFreeze(createStageState(stageId));
  let prevSeq = state.lastAnim.seq;
  for (const cmd of commands) {
    const next = executePixelCommand(state, cmd);
    expect(next).not.toBe(state);
    expect(next.lastAnim.seq).toBeGreaterThan(prevSeq);
    assertValidBubbles(next);
    prevSeq = next.lastAnim.seq;
    state = deepFreeze(next);
  }
  return state;
}

describe('GitDots scenarios & initial stage presets', () => {
  it('defines the ordered stages with cheat sheets', () => {
    expect(STAGE_SCENARIOS.map((scenario) => scenario.id)).toEqual(ALL_STAGE_IDS);
    expect(STAGE_SCENARIOS.map((scenario) => scenario.number)).toEqual(ALL_STAGE_IDS.map((_, index) => index + 1));
    expect(STAGE_SCENARIOS.filter((scenario) => scenario.track === 'basic').map(({ number }) => number)).toEqual([1, 2, 3, 4]);
    for (const id of ALL_STAGE_IDS) {
      const scenario = STAGE_MAP[id];
      expect(scenario).toBeDefined();
      expect(scenario.id).toBe(id);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
      expect(scenario.chips.length).toBeGreaterThanOrEqual(5);
      expect(scenario.cheatSheet.length).toBeGreaterThanOrEqual(5);
      for (const chip of scenario.chips) {
        if (chip.stepIndex === undefined) continue;
        const { command, label } = scenario.steps[chip.stepIndex];
        expect(chip).toMatchObject({ command, label });
      }
    }
  });

  it('creates tailored initial world state and safe opening bubbles for all stages', () => {
    for (const id of ALL_STAGE_IDS) {
      const state = createStageState(id);
      expect(state.stageId).toBe(id);
      if (STAGE_MAP[id].track === 'basic') {
        expect(state.files.every(({ name }) => name.endsWith('.md'))).toBe(true);
        expect(state.commits.every(({ tree }) => Object.keys(tree).every((path) => path.endsWith('.md')))).toBe(true);
      }
      expect(state.lastAnim.kind).toBe('IDLE');
      expect(state.lastAnim.seq).toBe(0);
      expect(state.completedActions).toEqual([]);
      expect(state.terminal.length).toBeGreaterThan(0);
      assertValidBubbles(state);
    }
  });
});

describe('Full stage walkthroughs', () => {
  it.each(STAGE_SCENARIOS)('advances one goal per guided command in $id', (lesson) => {
    let state = createStageState(lesson.id);
    for (const [index, step] of lesson.steps.entries()) {
      expect(getNextPendingStep(state)?.id).toBe(step.id);
      state = executePixelCommand(state, step.command);
      expect(lesson.steps.filter((item) => isStepCompleted(state, item))).toHaveLength(index + 1);
    }
    expect(getNextPendingStep(state)).toBeNull();
    expect(state.bubbles[0]?.title).toBe(`${lesson.number}장 실습 완료`);
  });

  it('keeps distinct CLI goals after clearing or scrolling past terminal history', () => {
    let state = runSequence('ch5', ['gh repo view', 'gh issue list', 'gh api unknown']);
    const completed = () => STAGE_MAP.ch5.steps.filter((step) => isStepCompleted(state, step)).map((step) => step.id);
    expect(completed()).toEqual([]);
    state = executePixelCommand(state, 'gh issue create --title "다른 제목"');
    state = executePixelCommand(state, 'clear');
    expect(completed()).toEqual(['ch5-issue']);
    state = executePixelCommand(state, 'gh auth status');
    for (let i = 0; i < 30; i++) state = executePixelCommand(state, 'gh pr list');
    expect(completed()).toEqual(['ch5-auth', 'ch5-issue']);
    expect(getNextPendingStep(state)?.id).toBe('ch5-run');
    state = executePixelCommand(state, 'reset');
    expect(completed()).toEqual([]);
  });

  it('Ch1: Working Dir -> Staging -> Local Repo -> Remote GitHub', () => {
    let s = deepFreeze(createStageState('ch1'));
    expect(s.files.some((f) => f.status === 'modified')).toBe(true);
    expect(s.files.some((f) => f.status === 'untracked')).toBe(true);
    expect(executePixelCommand(s, 'git push').completedActions).not.toContain('PUSH');

    s = deepFreeze(executePixelCommand(s, 'git status'));
    expect(s.lastAnim.kind).toBe('IDLE');
    expect(s.lastAnim.seq).toBe(1);

    s = deepFreeze(executePixelCommand(s, `edit ${DOCUMENT_PATH}`));
    expect(s.lastAnim.kind).toBe('EDIT');
    expect(s.files.find((f) => f.name === DOCUMENT_PATH)?.content).toContain('스터디 준비 사항을 확인했어요.');

    s = deepFreeze(executePixelCommand(s, 'git add .'));
    expect(s.lastAnim.kind).toBe('ADD');
    expect(s.staged).toContain(DOCUMENT_PATH);
    expect(s.staged).toContain(ATTENDANCE_PATH);
    expect(s.files.find((f) => f.name === DOCUMENT_PATH)?.status).toBe('staged');

    s = deepFreeze(executePixelCommand(s, 'git commit -m "첫 세이브"'));
    expect(s.lastAnim.kind).toBe('COMMIT');
    expect(s.staged).toEqual([]);
    expect(s.commits[s.commits.length - 1]?.message).toBe('첫 세이브');
    expect(s.branches.main).toBe(s.commits[s.commits.length - 1]?.id);

    s = deepFreeze(executePixelCommand(s, 'git push'));
    expect(s.lastAnim.kind).toBe('PUSH');
    expect(s.remoteBranches.main).toBe(s.branches.main);
    expect(s.completedActions).toEqual(expect.arrayContaining(['ADD', 'COMMIT', 'PUSH']));
    expect(s.bubbles[0]?.title).toContain('2장 실습 완료');
  });

  it('Ch2: unstage secret note, stash, stash pop, reset --soft, revert HEAD', () => {
    let s = deepFreeze(createStageState('ch2'));
    const initialCommitCount = s.commits.length;
    const originalChange = s.files.find((f) => f.name === DOCUMENT_PATH)?.content;
    expect(s.files.find((f) => f.name === SECRET_NOTE_PATH)?.status).toBe('staged');

    s = deepFreeze(executePixelCommand(s, `git restore --staged ${SECRET_NOTE_PATH}`));
    expect(s.lastAnim.kind).toBe('UNSTAGE');
    expect(s.files.find((f) => f.name === SECRET_NOTE_PATH)?.status).toBe('untracked');
    expect(s.staged).toEqual([]);

    s = deepFreeze(executePixelCommand(s, 'git log'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git diff'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git stash'));
    expect(s.lastAnim.kind).toBe('STASH');
    expect(s.stashCount).toBe(1);
    expect(s.files.filter((f) => f.name !== SECRET_NOTE_PATH).every((f) => f.status === 'committed')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'git stash pop'));
    expect(s.lastAnim.kind).toBe('STASH_POP');
    expect(s.stashCount).toBe(0);
    expect(s.files.find((f) => f.name === DOCUMENT_PATH)?.status).toBe('modified');
    expect(s.files.find((f) => f.name === DOCUMENT_PATH)?.content).toBe(originalChange);

    s = deepFreeze(executePixelCommand(s, 'git revert HEAD'));
    expect(s.lastAnim.kind).toBe('REVERT');
    expect(s.commits).toHaveLength(initialCommitCount + 1);
    expect(s.commits[s.commits.length - 1]?.isRevert).toBe(true);

    // Bonus: reset --soft marks the local-only revert commit as ghost and stages file
    const beforeResetHead = s.branches.main;
    const softReset = deepFreeze(executePixelCommand(s, 'git reset --soft HEAD~1'));
    expect(softReset.lastAnim.kind).toBe('RESET');
    expect(softReset.branches.main).not.toBe(beforeResetHead);
    expect(softReset.commits.find((c) => c.id === beforeResetHead)?.ghost).toBe(true);
    expect(softReset.staged.length).toBeGreaterThan(0);

    // 취소 커밋을 팀에 공유해야 장이 완료돼요.
    s = deepFreeze(executePixelCommand(s, 'git push'));
    expect(s.lastAnim.kind).toBe('PUSH');
    expect(s.remoteBranches.main).toBe(s.branches.main);
    expect(s.bubbles[0]?.title).toContain('3장 실습 완료');
  });

  it('unstages without touching the working file, HEAD or other paths', () => {
    const initial = createStageState('ch2');
    const note = initial.files.find((f) => f.name === SECRET_NOTE_PATH);
    const s = executePixelCommand(initial, `git restore --staged ${SECRET_NOTE_PATH}`);
    expect(s.lastAnim.kind).toBe('UNSTAGE');
    expect(s.completedActions).toContain('UNSTAGE');
    expect(s.files.find((f) => f.name === SECRET_NOTE_PATH)).toEqual({ name: SECRET_NOTE_PATH, status: 'untracked', content: note?.content });
    expect(s.index).toEqual(initial.commits[2]?.tree);
    expect(s.branches).toEqual(initial.branches);
    expect(s.files.find((f) => f.name === DOCUMENT_PATH)?.status).toBe('modified');

    const withoutFlag = executePixelCommand(initial, `git restore ${SECRET_NOTE_PATH}`);
    expect(withoutFlag.files).toBe(initial.files);
    const missing = executePixelCommand(initial, 'git restore --staged unknown.md');
    expect(missing.files).toBe(initial.files);
    const empty = executePixelCommand(s, 'git restore --staged .');
    expect(empty.lastAnim.kind).toBe('IDLE');
  });

  it('restores the files in each stash and keeps the entry when newer edits overlap', () => {
    const initial = createStageState('ch1');
    let s = executePixelCommand(initial, 'git stash');
    expect(s.files.find((file) => file.name === ATTENDANCE_PATH)?.status).toBe('untracked');
    s = executePixelCommand(s, `edit ${DOCUMENT_PATH}`);
    const edited = s.files.find((file) => file.name === DOCUMENT_PATH)?.content;
    s = executePixelCommand(s, 'git stash pop');
    expect(s.stashCount).toBe(1);
    expect(s.files.find((file) => file.name === DOCUMENT_PATH)?.content).toBe(edited);
    s = executePixelCommand(s, 'git stash -u');
    expect(s.stashCount).toBe(2);
    expect(s.files.some((file) => file.name === ATTENDANCE_PATH)).toBe(false);
    s = executePixelCommand(s, 'git stash pop');
    expect(s.stashCount).toBe(1);
    expect(s.files.find((file) => file.name === ATTENDANCE_PATH)).toEqual(initial.files[1]);
    expect(s.files.find((file) => file.name === DOCUMENT_PATH)?.content).toBe(edited);
  });

  it('Ch3: branch switch, deterministic merge conflict with 1-click actions, resolve, commit, rebase', () => {
    let s = deepFreeze(createStageState('ch3'));

    s = deepFreeze(executePixelCommand(s, 'git branch'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git switch -c feat/dark'));
    expect(s.lastAnim.kind).toBe('BRANCH');
    expect(s.headBranch).toBe('feat/dark');
    expect(s.branches['feat/dark']).toBeDefined();

    // Deterministic conflict on merging feat/ui
    s = deepFreeze(executePixelCommand(s, 'git merge feat/ui'));
    expect(s.lastAnim.kind).toBe('CONFLICT');
    expect(s.conflict).not.toBeNull();
    expect(s.conflict?.resolvedChoice).toBe('none');
    expect(s.files.find((f) => f.name === 'theme.js')?.status).toBe('conflict');

    // Bubble MUST offer 1-click actions for ours / theirs / both
    const actions = s.bubbles[0]?.actions ?? [];
    expect(actions.map((a) => a.command)).toEqual(
      expect.arrayContaining(['resolve ours', 'resolve theirs', 'resolve both']),
    );

    // Committing before resolving conflict is blocked politely
    const blockedCommit = executePixelCommand(s, 'git commit');
    expect(blockedCommit.lastAnim.kind).toBe('IDLE');
    expect(blockedCommit.conflict?.resolvedChoice).toBe('none');

    // Resolve with `resolve both`
    s = deepFreeze(executePixelCommand(s, 'resolve both'));
    expect(s.lastAnim.kind).toBe('RESOLVE');
    expect(s.conflict?.resolvedChoice).toBe('both');
    expect(s.staged).toContain('theme.js');
    const resolved = s.files.find((file) => file.name === 'theme.js')?.content;
    expect(resolved).toContain('dark-midnight');
    expect(resolved).toContain('sunset-coral');
    expect(resolved?.match(/export const theme =/g)).toHaveLength(1);

    // Commit without -m completes merge commit and clears Stage 3
    s = deepFreeze(executePixelCommand(s, 'git commit'));
    expect(s.lastAnim.kind).toBe('COMMIT');
    expect(s.conflict).toBeNull();
    expect(s.commits[s.commits.length - 1]?.isMerge).toBe(true);
    expect(s.commits[s.commits.length - 1]?.parents.length).toBe(2);
    expect(s.bubbles[0]?.title).toContain('5장 실습 완료');

    const before = s.branches['feat/dark'];
    s = deepFreeze(executePixelCommand(s, 'git rebase main'));
    expect(s.branches['feat/dark']).toBe(before);
  });

  it('Ch3: supports resolve ours, resolve theirs, and git checkout -b alias', () => {
    let s = runSequence('ch3', ['git checkout -b feat/alt', 'git merge feat/ui']);
    expect(s.headBranch).toBe('feat/alt');
    expect(s.conflict).not.toBeNull();

    const ours = executePixelCommand(s, 'resolve ours');
    expect(ours.conflict?.resolvedChoice).toBe('ours');
    expect(ours.files.find((f) => f.name === 'theme.js')?.content).toContain('dark-midnight');

    const theirs = executePixelCommand(s, 'resolve theirs');
    expect(theirs.conflict?.resolvedChoice).toBe('theirs');
    expect(theirs.files.find((f) => f.name === 'theme.js')?.content).toContain('sunset-coral');
  });

  it('Ch4: create branch, commit, push, PR, teammate approval, merge', () => {
    const initial = createStageState('ch4');
    expect(initial.headBranch).toBe('main');
    expect(initial.branches[MEETING_PR_BRANCH]).toBeUndefined();
    expect(initial.files.find((file) => file.name === DOCUMENT_PATH)?.status).toBe('modified');

    let s = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}"`,
      'gh pr view',
      'gh pr merge',
      'git switch main',
      'git pull origin main',
    ]);
    expect(s.completedActions).toEqual(
      expect.arrayContaining(['BRANCH', 'ADD', 'COMMIT', 'PUSH', 'PR_CREATE', 'PR_REVIEW', 'PR_MERGE', 'RETURN_MAIN', 'SYNC_MAIN']),
    );
    expect(s.headBranch).toBe('main');
    expect(s.prs).toHaveLength(1);
    expect(s.prs[0]?.title).toBe(MEETING_PR_TITLE);
    expect(s.prs[0]?.status).toBe('merged');
    const remoteTree = s.commits.find((commit) => commit.id === s.remoteBranches.main)?.tree;
    expect(remoteTree?.[DOCUMENT_PATH]).toContain('2층 모임방');
    expect(remoteTree?.[ATTENDANCE_PATH]).toBe(ATTENDANCE_DOCUMENT);
    // 합친 뒤 내 컴퓨터의 main에도 같은 내용이 반영돼요.
    const localTree = s.commits.find((commit) => commit.id === s.branches.main)?.tree;
    expect(localTree).toEqual(remoteTree);
    expect(s.files.find((file) => file.name === DOCUMENT_PATH)?.content).toContain('2층 모임방');
    expect(s.bubbles[0]?.title).toContain('4장 실습 완료');
  });

  it('Ch4: merge is blocked until teammate approval is confirmed with gh pr view', () => {
    const s = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}"`,
    ]);
    const blocked = executePixelCommand(s, 'gh pr merge');
    expect(blocked.lastAnim.kind).toBe('IDLE');
    expect(blocked.prs[0]?.status).toBe('open');
    expect(blocked.prs[0]?.approved).toBe(false);
    expect(blocked.bubbles[0]?.actions?.some((action) => action.command === 'gh pr view --comments')).toBe(true);

    const reviewed = executePixelCommand(blocked, 'gh pr view --comments');
    expect(reviewed.prs[0]?.approved).toBe(true);
    expect(reviewed.completedActions).toContain('PR_REVIEW');
    expect(reviewed.bubbles[0]?.message).toContain(MEETING_REVIEWER);

    const merged = executePixelCommand(reviewed, 'gh pr merge');
    expect(merged.lastAnim.kind).toBe('PR_MERGE');
    expect(merged.prs[0]?.status).toBe('merged');
  });

  it('Ch4: finishing steps only count after the merge and on main', () => {
    let s = deepFreeze(createStageState('ch4'));
    const run = (cmd: string) => { s = deepFreeze(executePixelCommand(s, cmd)); };
    run(`git switch -c ${MEETING_PR_BRANCH}`);
    run('git add 회의록.md');
    run(`git commit -m "${MEETING_PR_TITLE}"`);

    // 병합 전에 main으로 이동해도 마무리 단계는 완료되지 않아요.
    run('git switch main');
    expect(s.completedActions).not.toContain('RETURN_MAIN');
    expect(isStepCompleted(s, STAGE_MAP.ch4.steps[7])).toBe(false);

    run(`git switch ${MEETING_PR_BRANCH}`);
    run(`git push -u origin ${MEETING_PR_BRANCH}`);
    run(`gh pr create --title "${MEETING_PR_TITLE}"`);
    run('gh pr view');
    run('gh pr merge');

    // 병합을 마친 뒤 main으로 이동하면 그때 인정돼요.
    run('git switch main');
    expect(s.completedActions).toContain('RETURN_MAIN');
    expect(isStepCompleted(s, STAGE_MAP.ch4.steps[7])).toBe(true);

    // 작업 브랜치에서 pull하면 내 main은 그대로라 장이 완료되지 않아요.
    run(`git switch ${MEETING_PR_BRANCH}`);
    run('git pull origin main');
    expect(s.completedActions).not.toContain('SYNC_MAIN');
    expect(isStepCompleted(s, STAGE_MAP.ch4.steps[8])).toBe(false);
    expect(getNextPendingStep(s)?.id).toBe('ch4-pull');
    expect(s.commits.find((commit) => commit.id === s.branches.main)?.tree[DOCUMENT_PATH]).not.toContain('2층 모임방');

    // main에서 pull해야 비로소 내 컴퓨터에 반영되고 장이 완료돼요.
    run('git switch main');
    run('git pull origin main');
    expect(s.completedActions).toContain('SYNC_MAIN');
    expect(getNextPendingStep(s)).toBeNull();
    expect(s.commits.find((commit) => commit.id === s.branches.main)?.tree[DOCUMENT_PATH]).toContain('2층 모임방');
  });

  it('Ch4: pull completes the sync step even when main is already up to date', () => {
    let s = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}" --body "장소를 2층 모임방으로 바꿨어요."`,
      'gh pr view --comments',
      'gh pr merge',
      'git switch main',
    ]);
    expect(s.completedActions).not.toContain('SYNC_MAIN');

    // 다른 경로로 main을 이미 최신으로 만들어 둔 상황(저장된 진도 8/9)을 재현해요.
    s = deepFreeze(executePixelCommand(s, 'git merge origin/main'));
    expect(s.branches.main).toBe(s.remoteBranches.main);
    expect(s.completedActions).not.toContain('SYNC_MAIN');

    // 가져올 변경이 없어도 pull이 마무리 단계를 완료해야 해요.
    const pulled = executePixelCommand(s, 'git pull origin main');
    expect(pulled.lastAnim.kind).toBe('PULL');
    expect(pulled.completedActions).toContain('SYNC_MAIN');
    expect(getNextPendingStep(pulled)).toBeNull();
  });

  it('Ch5: gh CLI full walkthrough (auth, repo, pr, issue, run watch, api)', () => {
    let s = deepFreeze(createStageState('ch5'));
    const initialIssues = s.issues.length;
    const initialPrs = s.prs.length;

    s = deepFreeze(executePixelCommand(s, 'gh auth status'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    // Should NOT prematurely celebrate after step 1 even though multiple steps use GH_CMD
    expect(s.bubbles[0]?.title).not.toContain('6장 실습 완료');

    s = deepFreeze(executePixelCommand(s, 'gh repo view'));
    expect(s.lastAnim.kind).toBe('GH_CMD');

    s = deepFreeze(executePixelCommand(s, 'gh pr create --title "다크 모드 색상 추가"'));
    expect(s.lastAnim.kind).toBe('PR_CREATE');
    expect(s.prs).toHaveLength(initialPrs + 1);
    expect(s.prs[s.prs.length - 1]?.title).toBe('다크 모드 색상 추가');

    s = deepFreeze(executePixelCommand(s, 'gh pr list'));
    expect(s.lastAnim.kind).toBe('GH_CMD');

    s = deepFreeze(executePixelCommand(s, 'gh issue create --title "다크 모드에서 글자가 안 보여요"'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.issues).toHaveLength(initialIssues + 1);
    expect(s.issues[s.issues.length - 1]?.title).toBe('다크 모드에서 글자가 안 보여요');

    s = deepFreeze(executePixelCommand(s, 'gh run watch'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.bubbles[0]?.title).not.toContain('6장 실습 완료');

    s = deepFreeze(executePixelCommand(s, 'gh api repos/gitdots/app'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.bubbles[0]?.title).toContain('6장 실습 완료');
  });

  it('Ch6: token classic vs fine-grained, SSO, SSH, Push Protection leak-test, --with-token', () => {
    let s = deepFreeze(createStageState('ch6'));

    s = deepFreeze(executePixelCommand(s, 'token classic'));
    expect(s.lastAnim.kind).toBe('TOKEN_CLASSIC');
    expect(s.token.mode).toBe('classic');
    expect(s.token.riskScore).toBeGreaterThanOrEqual(80);

    s = deepFreeze(executePixelCommand(s, 'token fine'));
    expect(s.lastAnim.kind).toBe('TOKEN_FINE');
    expect(s.token.mode).toBe('fine-grained');
    expect(s.token.riskScore).toBeLessThan(30);
    expect(s.token.scopes).toContain('contents:write (gitdots/app)');
    expect(s.token.scopes.join(' ')).not.toContain('delete_repo');

    s = deepFreeze(executePixelCommand(s, 'token sso'));
    expect(s.lastAnim.kind).toBe('TOKEN_SSO');
    expect(s.token.ssoAuthorized).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'token ssh'));
    expect(s.lastAnim.kind).toBe('TOKEN_SSH');
    expect(s.token.sshReady).toBe(true);
    expect(s.bubbles[0]?.title).toContain('7장 실습 완료');

    s = deepFreeze(executePixelCommand(s, 'token leak-test'));
    expect(s.lastAnim.kind).toBe('TOKEN_BLOCK');
    expect(s.token.pushBlockedDemo).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'gh auth login --with-token'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
  });

  it('Ch7: GHES firewall block, unauthorized api block, VPN login pass, /api/v3, private runner, cloud compare', () => {
    let s = deepFreeze(createStageState('ch7'));
    expect(s.ghes.connected).toBe(false);

    // Calling /api/v3 before VPN login is blocked by guard
    const unauth = executePixelCommand(s, 'gh api /api/v3/user');
    expect(unauth.lastAnim.kind).toBe('GHES_BLOCK');
    expect(getNextPendingStep(unauth)?.id).toBe('ch7-block');
    expect(unauth.ghes.lastFlow).toBe('blocked');
    expect(unauth.bubbles[0]?.actions?.[0]?.command).toBe(
      'gh auth login --hostname github.corp.internal',
    );

    s = deepFreeze(executePixelCommand(s, 'ghes test-public'));
    expect(s.lastAnim.kind).toBe('GHES_BLOCK');
    expect(s.ghes.lastFlow).toBe('blocked');

    s = deepFreeze(
      executePixelCommand(s, 'gh auth login --hostname github.corp.internal'),
    );
    expect(s.lastAnim.kind).toBe('GHES_LOGIN');
    expect(s.ghes.connected).toBe(true);
    expect(s.ghes.lastFlow).toBe('vpn-ok');
    expect(s.ghHost).toBe('github.corp.internal');
    const canonical = executePixelCommand(s, 'gh api user --hostname github.corp.internal');
    expect(canonical.terminal.at(-1)?.lines[0]?.text).toBe('GET https://github.corp.internal/api/v3/user');

    s = deepFreeze(executePixelCommand(s, 'gh api /api/v3/user'));
    expect(s.lastAnim.kind).toBe('GHES_API');
    expect(s.ghes.lastFlow).toBe('api-v3');

    s = deepFreeze(executePixelCommand(s, 'ghes runner'));
    expect(s.lastAnim.kind).toBe('GHES_RUNNER');
    expect(s.ghes.lastFlow).toBe('runner');
    expect(s.bubbles[0]?.title).toContain('8장 실습 완료');

    s = deepFreeze(executePixelCommand(s, 'ghes cloud'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.ghes.mode).toBe('cloud');
  });

  it('Ch8: AI worktree isolation, code fix, main push blocked, Draft PR with 1-click approve, HITL merge', () => {
    let s = deepFreeze(createStageState('ch8'));
    const initialMainCommit = s.branches.main;

    // Running ai code before worktree politely asks for worktree first
    const prematureCode = executePixelCommand(s, 'ai code');
    expect(prematureCode.lastAnim.kind).toBe('IDLE');
    expect(prematureCode.ai.codeWritten).toBe(false);

    s = deepFreeze(executePixelCommand(s, 'git worktree add wt-ai -b ai/fix'));
    expect(s.lastAnim.kind).toBe('AI_WORKTREE');
    expect(s.ai.worktreeActive).toBe(true);
    expect(s.ai.worktreeBranch).toBe('ai/fix');
    const canonical = executePixelCommand(createStageState('ch8'), 'git worktree add -b ai/fix wt-ai');
    expect(canonical.lastAnim.label).toContain('wt-ai');

    s = deepFreeze(executePixelCommand(s, 'ai code'));
    expect(s.lastAnim.kind).toBe('AI_CODE');
    expect(s.ai.codeWritten).toBe(true);
    expect(s.files.find((f) => f.name === 'buggy.ts')?.content).toContain('a - b');
    expect(s.commits.at(-1)?.tree['buggy.ts']).toContain('a + b');
    expect(s.branches.main).toBe(initialMainCommit);

    s = deepFreeze(executePixelCommand(s, 'ai push-main'));
    expect(s.lastAnim.kind).toBe('AI_BLOCK_MAIN');
    expect(s.ai.mainPushBlocked).toBe(true);
    expect(s.branches.main).toBe(initialMainCommit);

    s = deepFreeze(executePixelCommand(s, 'ai pr'));
    expect(s.lastAnim.kind).toBe('AI_PR');
    expect(s.ai.prNumber).toBe(1);
    expect(s.prs[0]?.status).toBe('draft');
    expect(s.prs[0]?.ci).toBe('pass');
    // 초안 PR은 바로 합칠 수 없어요 — 검토 준비 전환을 안내해요.
    expect(s.bubbles[0]?.speaker).toBe('ai');
    expect(s.bubbles[0]?.actions?.some((a) => a.command === 'ai ready')).toBe(true);
    const prematureApprove = executePixelCommand(s, 'ai approve');
    expect(prematureApprove.lastAnim.kind).toBe('IDLE');
    expect(prematureApprove.ai.merged).toBe(false);

    s = deepFreeze(executePixelCommand(s, 'ai ready'));
    expect(s.prs[0]?.status).toBe('open');
    expect(s.completedActions).toContain('AI_READY');

    s = deepFreeze(executePixelCommand(s, 'ai approve'));
    expect(s.lastAnim.kind).toBe('AI_APPROVE');
    expect(s.ai.humanApproved).toBe(true);
    expect(s.ai.merged).toBe(true);
    expect(s.prs[0]?.status).toBe('merged');
    expect(s.branches.main).toBe(initialMainCommit);
    expect(s.remoteBranches.main).not.toBe(initialMainCommit);
    expect(s.commits.at(-1)?.tree['buggy.ts']).toContain('a + b');
    expect(s.bubbles[0]?.title).toContain('9장 실습 완료');
  });
});

describe('Beginner guardrails and feedback', () => {
  it('Ch3: blocks merging before creating the lesson branch', () => {
    const initial = createStageState('ch3');
    const blocked = executePixelCommand(initial, 'git merge feat/ui');
    expect(blocked.lastAnim.kind).toBe('IDLE');
    expect(blocked.conflict).toBeNull();
    expect(blocked.completedActions).not.toContain('CONFLICT');
    expect(blocked.bubbles[0]?.actions?.some((action) => action.command === 'git switch -c feat/dark')).toBe(true);
    expect(getNextPendingStep(blocked)?.id).toBe('ch3-branch');
  });

  it('Ch4: pushing with nothing new to upload guides toward committing', () => {
    const initial = createStageState('ch4');
    const pushed = executePixelCommand(initial, 'git push');
    expect(pushed.lastAnim.kind).toBe('IDLE');
    expect(pushed.completedActions).not.toContain('PUSH');
    expect(pushed.bubbles[0]?.message).toContain('올릴 새 커밋이 없어요');
  });

  it('Docs: suggests the closest command for a git typo', () => {
    const initial = createStageState('docs');
    const typo = executePixelCommand(initial, 'git stauts');
    expect(typo.bubbles[0]?.message).toContain('git status');
    expect(typo.bubbles[0]?.actions?.some((action) => action.command === 'git status')).toBe(true);
  });

  it('Docs: refuses to revert the root commit so the document never empties', () => {
    const initial = createStageState('docs');
    const reverted = executePixelCommand(initial, 'git revert HEAD');
    expect(reverted.lastAnim.kind).toBe('IDLE');
    expect(reverted.files[0]?.content).toBe(initial.files[0]?.content);
    expect(reverted.bubbles[0]?.title).toContain('첫 기록은 취소할 수 없어요');
  });
});

describe('Document editing and comparison', () => {
  it('only credits a comparison when it is the next document task', () => {
    let state = executePixelCommand(createStageState('docs'), 'edit 회의록.md');
    state = executePixelCommand(state, DOCUMENT_COMPARISONS.staged.command);
    expect(state.document?.comparison).toBe('staged');
    expect(state.completedActions).not.toContain('DOCUMENT_STAGED_DIFF');
    expect(getNextPendingStep(state)?.id).toBe('docs-diff');
  });

  it('commits the staged document and preserves a later working edit', () => {
    const firstEdit = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '수요일 오후 2시');
    const laterEdit = firstEdit.replace('1층 회의실', '도서관');
    let state = deepFreeze(createStageState('docs'));
    state = deepFreeze(executePixelCommand(state, DOCUMENT_COMPARISONS.commits.command));
    expect(state.completedActions).not.toContain('DOCUMENT_COMMIT_DIFF');

    state = deepFreeze(savePracticeDocument(state, firstEdit));
    state = deepFreeze(executePixelCommand(state, 'git diff 회의록.md'));
    const workingLines = state.terminal.at(-1)?.lines.map(({ text }) => text);
    expect(workingLines).toContain('-다음 모임은 금요일 저녁 7시예요.');
    expect(workingLines).toContain('+다음 모임은 수요일 오후 2시예요.');

    state = deepFreeze(executePixelCommand(state, 'git add -- ./회의록.md'));
    expect(getDocumentComparison(state, 'working')).toEqual({ before: firstEdit, after: firstEdit });
    state = deepFreeze(savePracticeDocument(state, laterEdit));
    expect(getDocumentComparison(state, 'staged')).toEqual({ before: ORIGINAL_DOCUMENT, after: firstEdit });
    expect(getDocumentComparison(state, 'working')).toEqual({ before: firstEdit, after: laterEdit });
    state = deepFreeze(executePixelCommand(state, 'git status'));
    const status = state.terminal.at(-1)?.lines.map(({ text }) => text).join('\n');
    expect(status).toContain('Staged): 회의록.md');
    expect(status).toContain('Modified): 회의록.md');

    state = deepFreeze(executePixelCommand(state, 'git diff --cached -- 회의록.md'));
    expect(state.document?.comparison).toBe('staged');
    state = deepFreeze(executePixelCommand(state, 'git commit -m "안내 수정 -a 아님"'));
    expect(state.commits.at(-1)?.tree[DOCUMENT_PATH]).toBe(firstEdit);
    expect(state.files[0]).toMatchObject({ content: laterEdit, status: 'modified' });
    expect(state.staged).toEqual([]);
    expect(getDocumentComparison(state, 'staged')).toEqual({ before: firstEdit, after: firstEdit });

    state = deepFreeze(executePixelCommand(state, DOCUMENT_COMPARISONS.commits.command));
    expect(getDocumentComparison(state, 'commits')).toEqual({ before: ORIGINAL_DOCUMENT, after: firstEdit });
    expect(state.terminal.at(-1)?.lines.map(({ text }) => text)).not.toContain('+장소는 도서관이에요.');
    expect(getNextPendingStep(state)).toBeNull();
    expect(executePixelCommand(state, 'reset').files[0]?.content).toBe(ORIGINAL_DOCUMENT);
  });

  it('stages an empty document and clears staging when the original is added again', () => {
    let state = savePracticeDocument(createStageState('docs'), '');
    state = executePixelCommand(state, 'git add 회의록.md');
    expect(state.index[DOCUMENT_PATH]).toBe('');
    expect(state.staged).toEqual([DOCUMENT_PATH]);
    state = savePracticeDocument(state, ORIGINAL_DOCUMENT);
    state = executePixelCommand(state, 'git add 회의록.md');
    expect(state.staged).toEqual([]);
    expect(state.files[0]?.status).toBe('committed');
    state = executePixelCommand(state, 'git commit -m "변경 없음"');
    expect(state.commits).toHaveLength(1);
  });

  it('diffs multiline edits, empty text, and a missing final newline', () => {
    const lines = diffDocumentLines('제목\n삭제\n유지\n', '제목\n추가\n유지\n뒤에 더 쓰기');
    expect(lines.map(({ kind, text }) => [kind, text])).toEqual([
      ['unchanged', '제목'],
      ['removed', '삭제'],
      ['added', '추가'],
      ['unchanged', '유지'],
      ['added', '뒤에 더 쓰기'],
    ]);
    expect(lines.at(-1)).toMatchObject({ afterLine: 4, noFinalNewline: true });
    expect(diffDocumentLines('줄\n', '')).toMatchObject([{ kind: 'removed', text: '줄' }]);
    expect(diffDocumentLines('줄\n', '줄').map(({ kind }) => kind)).toEqual(['removed', 'added']);
    expect(diffDocumentLines('줄\n', '줄\n')).toEqual([]);
  });
});

describe('Git file snapshots', () => {
  it('reverts a selected old commit while preserving later edits in the same file', () => {
    const first = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '토요일 오전 10시');
    const extra = '질문은 단체 대화방에 남겨 주세요.\n';
    const second = first + extra;
    let state = savePracticeDocument(createStageState('docs'), first);
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, "git commit -m '시간 수정'");
    const firstCommit = state.commits.at(-1);
    state = savePracticeDocument(state, second);
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, "git commit -m '장소 수정'");
    const secondCommit = state.commits.at(-1);
    state = deepFreeze(executePixelCommand(state, `git revert --no-edit ${firstCommit?.hash}`));
    const expected = ORIGINAL_DOCUMENT + extra;
    expect(state.files[0]?.content).toBe(expected);
    expect(state.index[DOCUMENT_PATH]).toBe(expected);
    expect(state.commits.at(-1)?.tree[DOCUMENT_PATH]).toBe(expected);
    expect(state.commits.at(-1)?.parents).toEqual([secondCommit?.id]);
    expect(state.staged).toEqual([]);
  });

  it('keeps an adjacent-line revert conflict pending until resolved or aborted', () => {
    const first = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '토요일 오전 10시');
    const second = first.replace('1층 회의실', '도서관');
    let state = savePracticeDocument(createStageState('docs'), first);
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, 'git commit -m "시간 수정"');
    state = savePracticeDocument(state, second);
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, 'git commit -m "장소 수정"');
    const conflicted = deepFreeze(executePixelCommand(state, 'git revert HEAD~1'));
    expect(conflicted.commits).toHaveLength(state.commits.length);
    expect(conflicted.conflict?.revert).toBeDefined();
    expect(conflicted.files[0]?.content).toContain('<<<<<<< HEAD');
    expect(executePixelCommand(conflicted, 'git revert --continue').commits).toBe(state.commits);

    const aborted = executePixelCommand(conflicted, 'git revert --abort');
    expect(aborted.conflict).toBeNull();
    expect(aborted.files[0]?.content).toBe(second);
    expect(aborted.index[DOCUMENT_PATH]).toBe(second);

    const chosen = ORIGINAL_DOCUMENT.replace('1층 회의실', '도서관');
    const edited = savePracticeDocument(conflicted, chosen);
    const staged = executePixelCommand(edited, 'git add 회의록.md');
    const finished = executePixelCommand(staged, 'git revert --continue');
    expect(finished.lastAnim.kind).toBe('REVERT');
    expect(finished.conflict).toBeNull();
    expect(finished.commits.at(-1)?.tree[DOCUMENT_PATH]).toBe(chosen);
  });

  it('reverts tracked additions and leaves unrelated working edits intact', () => {
    const before = executePixelCommand(createStageState('ch2'), `git restore --staged ${SECRET_NOTE_PATH}`);
    const state = executePixelCommand(before, 'git revert 7e8f9a0');
    expect(state.files.some((file) => file.name === MISTAKEN_NOTICE_PATH)).toBe(false);
    expect(state.files.find((file) => file.name === DOCUMENT_PATH)).toEqual(before.files[0]);
    expect(state.index).toEqual(before.commits[1]?.tree);
  });

  it('hard resets to the requested ref, restores the index and keeps unrelated untracked files', () => {
    let state = runSequence('ch2', [
      "git branch original",
      "edit 'draft file.md'",
      `edit ${DOCUMENT_PATH}`,
      `git add ${DOCUMENT_PATH}`,
    ]);
    const rejected = executePixelCommand(state, 'git reset --hard unknown');
    expect(rejected.files).toBe(state.files);
    expect(rejected.index).toBe(state.index);
    state = executePixelCommand(state, 'git reset --hard HEAD~2');
    expect(state.branches.main).toBe('c1');
    expect(state.index).toEqual(state.commits[0]?.tree);
    expect(state.files.find((file) => file.name === DOCUMENT_PATH)?.content).toBe(ORIGINAL_DOCUMENT);
    expect(state.files.find((file) => file.name === 'draft file.md')?.status).toBe('untracked');
    expect(state.files.some((file) => file.name === MISTAKEN_NOTICE_PATH)).toBe(false);
    expect(state.staged).toEqual([]);

    state = executePixelCommand(state, 'git reset --hard original');
    expect(state.branches.main).toBe('c3');
    expect(state.files.find((file) => file.name === MISTAKEN_NOTICE_PATH)?.content).toContain('이번 모임은 취소됐어요.');
  });

  it('switches tracked versions, preserves independent edits and refuses to overwrite local work', () => {
    const initial = createStageState('ch3');
    let state = executePixelCommand(initial, 'edit app.js');
    state = executePixelCommand(state, 'git add app.js');
    const stagedApp = state.index['app.js'];
    state = executePixelCommand(state, 'git switch feat/ui');
    expect(state.headBranch).toBe('feat/ui');
    expect(state.files.find((file) => file.name === 'theme.js')?.content).toContain('sunset-coral');
    expect(state.index['app.js']).toBe(stagedApp);
    expect(state.staged).toEqual(['app.js']);
    state = executePixelCommand(state, 'edit theme.js');
    const blocked = executePixelCommand(state, 'git switch main');
    expect(blocked.headBranch).toBe('feat/ui');
    expect(blocked.files).toBe(state.files);
    expect(blocked.index).toBe(state.index);
    state = executePixelCommand(state, 'git reset --hard HEAD');
    state = executePixelCommand(state, 'git checkout main');
    expect(state.files.find((file) => file.name === 'theme.js')?.content).toContain('dark-midnight');
  });
});

describe('Utility commands, unknown commands & autocomplete', () => {
  it('handles unknown commands with a warm Korean fallback bubble and increments seq', () => {
    const init = deepFreeze(createStageState('ch1'));
    const next = executePixelCommand(init, 'git Abracadabra');
    expect(next.lastAnim.seq).toBe(1);
    expect(next.lastAnim.kind).toBe('IDLE');
    assertValidBubbles(next);
    expect(next.bubbles[0]?.title).toContain('어라, 모르는 명령어예요!');
    expect(next.bubbles[0]?.message).toContain('help를 입력해');
    expect(next.bubbles[0]?.actions?.some((a) => a.command === 'help')).toBe(true);
  });

  it('supports help, clear, and reset cleanly', () => {
    let s = runSequence('ch1', ['git add .', 'help']);
    expect(s.terminal.some((e) => e.command === 'help')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'clear'));
    expect(s.terminal).toHaveLength(1);
    expect(s.staged).toContain(DOCUMENT_PATH);

    s = deepFreeze(executePixelCommand(s, 'reset'));
    expect(s.staged).toEqual([]);
    expect(s.completedActions).toEqual([]);
    assertValidBubbles(s);
  });

  it('provides context-aware Korean autocomplete suggestions', () => {
    const ch1 = createStageState('ch1');
    const emptySuggestions = getCommandAutocomplete('', ch1);
    expect(emptySuggestions.length).toBeGreaterThan(0);
    expect(emptySuggestions[0]?.cmd).toBe('git add .');

    const gitPushSuggestions = getCommandAutocomplete('git pu', ch1);
    expect(gitPushSuggestions.some((s) => s.cmd === 'git push')).toBe(true);

    // Conflict context boosts resolve commands to top
    const conflictState = runSequence('ch3', [
      'git switch -c feat/dark',
      'git merge feat/ui',
    ]);
    const conflictAc = getCommandAutocomplete('res', conflictState);
    expect(conflictAc[0]?.cmd).toBe('resolve both');

    // 초안 PR 상태에서는 검토 준비 전환(ai ready)을 맨 위로 추천해요.
    const aiPrState = runSequence('ch8', [
      'git worktree add wt-ai -b ai/fix',
      'ai code',
      'ai pr',
    ]);
    const aiAc = getCommandAutocomplete('ai', aiPrState);
    expect(aiAc[0]?.cmd).toBe('ai ready');
    const aiReadyState = deepFreeze(executePixelCommand(aiPrState, 'ai ready'));
    expect(getCommandAutocomplete('ai', aiReadyState)[0]?.cmd).toBe('ai approve');
  });
});
