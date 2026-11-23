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
import { diffDocumentLines, DOCUMENT_COMPARISONS, DOCUMENT_PATH, EXAMPLE_DOCUMENT, getDocumentComparison, ORIGINAL_DOCUMENT } from './documentDiff';
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
    expect(unauth.lastAnim.kind).toBe('GHES_UNAUTH');
    expect(getNextPendingStep(unauth)?.id).toBe('ch7-block');
    expect(unauth.ghes.lastFlow).toBe('unauth');
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

describe('Review regressions: ordering guards and UX accuracy', () => {
  it('Docs: adding before diffing does not credit the empty working diff', () => {
    let state = savePracticeDocument(createStageState('docs'), EXAMPLE_DOCUMENT);
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, DOCUMENT_COMPARISONS.working.command);
    expect(state.completedActions).not.toContain('DOCUMENT_WORKING_DIFF');
    expect(state.bubbles[0]?.actions?.some((action) => action.command === DOCUMENT_COMPARISONS.staged.command)).toBe(true);

    state = executePixelCommand(state, DOCUMENT_COMPARISONS.staged.command);
    expect(state.completedActions).toContain('DOCUMENT_WORKING_DIFF');
    expect(getNextPendingStep(state)?.id).toBe('docs-staged');
  });

  it('Docs: asks before replacing a hand-written document, and -m keeps every bare word', () => {
    const custom = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '수요일 오후 2시');
    let state = savePracticeDocument(createStageState('docs'), custom);
    const blocked = executePixelCommand(state, 'edit 회의록.md');
    expect(blocked.lastAnim.kind).toBe('IDLE');
    expect(blocked.files[0]?.content).toBe(custom);
    expect(blocked.bubbles[0]?.actions?.[0]?.command).toBe('edit 회의록.md --force');

    state = executePixelCommand(state, 'edit 회의록.md --force');
    expect(state.files[0]?.content).toBe(EXAMPLE_DOCUMENT);

    let ch1 = executePixelCommand(createStageState('ch1'), 'git add .');
    ch1 = executePixelCommand(ch1, 'git commit -m 모임 시간 수정');
    expect(ch1.commits.at(-1)?.message).toBe('모임 시간 수정');
    const missing = executePixelCommand(ch1, 'git commit -m');
    expect(missing.lastAnim.kind).toBe('IDLE');
  });

  it('Ch2: unblock restoring an already-unstaged file and warn on sharing-rewound reset', () => {
    let state = executePixelCommand(createStageState('ch2'), 'git stash');
    state = executePixelCommand(state, 'git revert HEAD');
    state = executePixelCommand(state, 'git stash pop');
    const restored = executePixelCommand(state, `git restore --staged ${SECRET_NOTE_PATH}`);
    expect(restored.completedActions).toContain('UNSTAGE');

    let shared = createStageState('ch2');
    shared = executePixelCommand(shared, `git restore --staged ${SECRET_NOTE_PATH}`);
    shared = executePixelCommand(shared, 'git revert HEAD');
    shared = executePixelCommand(shared, 'git push');
    shared = executePixelCommand(shared, 'git reset --soft HEAD~1');
    expect(shared.bubbles[0]?.message).toContain('팀에 공유한 기록을 되감았어요');
    expect(shared.bubbles[0]?.actions?.some((action) => action.command === 'git pull origin main')).toBe(true);
  });

  it('Ch4 H1: blocks main→main and unpushed PRs before creating anything', () => {
    const initial = createStageState('ch4');
    const fromMain = executePixelCommand(initial, 'gh pr create --title "빈 PR"');
    expect(fromMain.lastAnim.kind).toBe('IDLE');
    expect(fromMain.prs).toEqual([]);
    expect(fromMain.bubbles[0]?.actions?.[0]?.command).toBe(`git switch -c ${MEETING_PR_BRANCH}`);

    let branchOnly = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
    ]);
    branchOnly = executePixelCommand(branchOnly, 'gh pr create --title "아직 안 올림"');
    expect(branchOnly.lastAnim.kind).toBe('IDLE');
    expect(branchOnly.prs).toEqual([]);
    expect(branchOnly.terminal.at(-1)?.lines[0]?.text).toContain(`${MEETING_PR_BRANCH} 브랜치가 아직 GitHub에 없어요`);

    // branch 생성만으로는 1단계가 완료되지 않아요.
    const branchCommand = executePixelCommand(createStageState('ch4'), `git branch ${MEETING_PR_BRANCH}`);
    expect(branchCommand.completedActions).not.toContain('BRANCH');
    expect(branchCommand.headBranch).toBe('main');
    expect(branchCommand.bubbles[0]?.actions?.[0]?.command).toBe(`git switch ${MEETING_PR_BRANCH}`);
  });

  it('Ch4 M2/M3/M6: draft PRs stay locked, unpushed heads do not fall back, and body is kept', () => {
    const prepared = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}" --body "장소를 2층 모임방으로 바꿨어요."`,
    ]);
    expect(prepared.prs[0]?.body).toBe('장소를 2층 모임방으로 바꿨어요.');
    expect(prepared.terminal.at(-1)?.lines.some((line) => line.text.includes('본문:'))).toBe(true);

    const draft = executePixelCommand(prepared, 'gh pr view --comments');
    expect(draft.prs[0]?.approved).toBe(true);
    const withDraft = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}" --draft`,
    ]);
    const locked = executePixelCommand(withDraft, 'gh pr merge');
    expect(locked.lastAnim.kind).toBe('IDLE');
    expect(locked.prs[0]?.status).toBe('draft');

    // 제목에 -d가 들어가도 초안으로 오판하지 않아요.
    let titleDash = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      'git add 회의록.md',
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      'gh pr create --title "update -docs"',
    ]);
    expect(titleDash.prs[0]?.status).toBe('open');

    // 원격 브랜치가 사라진 상태에서는 로컬 사본으로 대신 병합하지 않아요.
    const noRemote = {
      ...draft,
      remoteBranches: Object.fromEntries(Object.entries(draft.remoteBranches).filter(([name]) => name !== MEETING_PR_BRANCH)),
    };
    titleDash = executePixelCommand(noRemote, 'gh pr merge');
    expect(titleDash.lastAnim.kind).toBe('IDLE');
    expect(titleDash.bubbles[0]?.message).toContain('로컬 브랜치만으로는 합칠 수 없어요');
  });

  it('Ch4 M4: fetch reports local-only commits instead of a fake teammate commit', () => {
    let state: PixelSimState = {
      ...createStageState('ch4'),
      branches: { main: 'c2' },
    };
    state = executePixelCommand(state, 'git add 회의록.md');
    state = executePixelCommand(state, 'git commit -m "main에서만 만든 커밋"');
    state = executePixelCommand(state, 'git fetch');
    const text = state.terminal.at(-1)?.lines.map((line) => line.text).join('\n') ?? '';
    expect(text).toContain('내 컴퓨터에만 있는 커밋');
    expect(text).not.toContain('팀원의 새 커밋');
  });

  it('Ch5: blocks staging or committing with conflict markers and rejects unknown resolve args', () => {
    let state = runSequence('ch3', ['git switch -c feat/dark', 'git merge feat/ui']);
    const addBlocked = executePixelCommand(state, 'git add theme.js');
    expect(addBlocked.lastAnim.kind).toBe('IDLE');
    expect(addBlocked.conflict?.resolvedChoice).toBe('none');
    expect(addBlocked.staged).not.toContain('theme.js');

    const unknown = executePixelCommand(state, 'resolve mine');
    expect(unknown.lastAnim.kind).toBe('IDLE');
    expect(unknown.conflict?.resolvedChoice).toBe('none');

    state = executePixelCommand(state, 'resolve both');
    const commitBlocked = {
      ...state,
      index: { ...state.index, 'theme.js': '<<<<<<< HEAD\nexport const theme = "dark-midnight";\n=======\nexport const theme = "sunset-coral";\n>>>>>>> feat/ui\n' },
      conflict: { ...state.conflict!, resolvedChoice: 'manual' as const },
    };
    const blocked = executePixelCommand(commitBlocked, 'git commit');
    expect(blocked.lastAnim.kind).toBe('IDLE');
    expect(blocked.commits).toHaveLength(commitBlocked.commits.length);
  });

  it('Ch6: expiry is separate from scopes and leak demo blocks a real push', () => {
    let state = executePixelCommand(createStageState('ch6'), 'token fine');
    expect(state.token.scopes).not.toContain('expires:30d');
    expect(state.token.expires).toBe('30일 뒤');

    state = executePixelCommand(state, 'token leak-test');
    const text = state.terminal.at(-1)?.lines.map((line) => line.text).join('\n') ?? '';
    expect(text).toContain('토큰');
    expect(text).not.toContain('개인키가');
    const push = executePixelCommand(state, 'git push');
    expect(push.lastAnim.kind).toBe('TOKEN_BLOCK');
  });

  it('Ch7 H1: reports real login state and validates hostnames before success', () => {
    const initial = createStageState('ch7');
    const status = executePixelCommand(initial, 'gh auth status');
    expect(status.lastAnim.kind).toBe('IDLE');
    expect(status.terminal.at(-1)?.lines.map((line) => line.text).join('\n')).toContain('Not logged in');

    const bare = executePixelCommand(initial, 'gh auth login');
    expect(bare.lastAnim.kind).toBe('IDLE');
    expect(bare.ghes.connected).toBe(false);
    expect(bare.terminal.at(-1)?.lines[0]?.text).toContain('--hostname');

    const external = executePixelCommand(initial, 'gh auth login --hostname github.com');
    expect(external.lastAnim.kind).toBe('IDLE');
    expect(external.ghes.connected).toBe(false);

    const typo = executePixelCommand(initial, 'gh auth login --hostname github.corp.internl');
    expect(typo.lastAnim.kind).toBe('IDLE');
    expect(typo.ghes.connected).toBe(false);

    // --hostname=값 형태도 인식해요.
    const loggedIn = executePixelCommand(initial, 'gh auth login --hostname=github.corp.internal');
    expect(loggedIn.lastAnim.kind).toBe('GHES_LOGIN');
    expect(loggedIn.ghes.connected).toBe(true);

    const mismatch = executePixelCommand(loggedIn, 'gh api user --hostname other.corp.internal');
    expect(mismatch.lastAnim.kind).toBe('IDLE');
    expect(mismatch.bubbles[0]?.title).toContain('서버');
    expect(mismatch.terminal.at(-1)?.lines[0]?.text).toContain('요청 주소');
  });

  it('Ch8 H1/H2/H3: guards ai pr, blocks direct main push, and keeps worktree subcommands safe', () => {
    const initial = createStageState('ch8');
    const emptyPr = executePixelCommand(initial, 'ai pr');
    expect(emptyPr.lastAnim.kind).toBe('IDLE');
    expect(emptyPr.prs).toEqual([]);
    expect(emptyPr.bubbles[0]?.actions?.[0]?.command).toBe('ai code');

    const directPush = executePixelCommand(initial, 'git push origin main');
    expect(directPush.lastAnim.kind).toBe('AI_BLOCK_MAIN');
    expect(directPush.completedActions).not.toContain('PUSH');

    let state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    const tip = state.branches['ai/fix'];
    const list = executePixelCommand(state, 'git worktree list');
    expect(list.lastAnim.kind).toBe('IDLE');
    expect(list.branches['ai/fix']).toBe(tip);

    const duplicate = executePixelCommand(state, 'git worktree add -b ai/fix wt-ai');
    expect(duplicate.lastAnim.kind).toBe('IDLE');
    expect(duplicate.bubbles[0]?.title).toContain('이미 작업 폴더');
    expect(duplicate.bubbles[0]?.actions?.[0]?.command).toBe('ai code');
    expect(duplicate.ai.worktreeDir).toBe('wt-ai');

    const mainTree = executePixelCommand(state, 'git worktree add -b main wt-x');
    expect(mainTree.lastAnim.kind).toBe('IDLE');
    expect(mainTree.ai.worktreeBranch).toBe('ai/fix');
  });

  it('Ch8 M1/M2/M3/M4: merge is idempotent, gh view stays honest, and branch displays agree', () => {
    let state = runSequence('ch8', [
      'git worktree add -b ai/fix wt-ai',
      'ai code',
      'ai push-main',
      'ai pr',
      'ai ready',
    ]);
    const draftView = executePixelCommand(state, 'gh pr view --comments');
    expect(draftView.prs[0]?.approved).toBe(false);
    expect(draftView.bubbles[0]?.title).toContain('승인');

    state = executePixelCommand(state, 'ai approve');
    expect(state.ai.merged).toBe(true);
    const again = executePixelCommand(state, 'ai approve');
    expect(again.lastAnim.kind).toBe('IDLE');
    expect(again.commits).toHaveLength(state.commits.length);
    expect(again.bubbles[0]?.title).toContain('이미 병합');

    const status = executePixelCommand(state, 'git status');
    const statusText = status.terminal.at(-1)?.lines.map((line) => line.text).join('\n') ?? '';
    expect(statusText).toContain('On branch main');
    expect(statusText).toContain('작업 폴더: wt-ai');
    const branches = executePixelCommand(state, 'git branch');
    expect(branches.terminal.at(-1)?.lines.some((line) => line.text.startsWith('* main'))).toBe(true);
  });

  it('Ch5 M6/M7 and Ch1 M4: issue numbers share PR numbers, scopes get Korean help, and autocomplete stays in-stage', () => {
    const ch5 = executePixelCommand(createStageState('ch5'), 'gh issue create --title "새 버그"');
    expect(ch5.issues.at(-1)?.number).toBe(13);

    const auth = executePixelCommand(createStageState('ch5'), 'gh auth status');
    expect(auth.terminal.at(-1)?.lines.some((line) => line.text.includes('repo(저장소 읽기·쓰기)'))).toBe(true);

    const suggestions = getCommandAutocomplete('git s', createStageState('ch1'));
    expect(suggestions.some((item) => item.cmd === 'git status')).toBe(true);
    expect(suggestions.some((item) => item.cmd.includes('stash'))).toBe(false);
    expect(suggestions.some((item) => item.cmd.includes('switch'))).toBe(false);
  });
});

describe('Cycle 1 review regressions', () => {
  it('H1: stash@{0} restores and removes the same newest entry shown by git stash list', () => {
    let state = executePixelCommand(createStageState('ch1'), 'git stash');
    const oldestWorking = state.stashes[0]?.working;
    state = executePixelCommand(state, `edit ${DOCUMENT_PATH}`);
    const newestContent = state.files.find((file) => file.name === DOCUMENT_PATH)?.content;
    state = executePixelCommand(state, 'git stash');
    expect(state.stashes).toHaveLength(2);

    const list = executePixelCommand(state, 'git stash list');
    const listLines = list.terminal.at(-1)?.lines.map((line) => line.text) ?? [];
    expect(listLines[0]).toContain('stash@{1}');
    expect(listLines[1]).toContain('stash@{0}');

    // 플래그가 앞/뒤에 섞여도 stash@{0}은 가장 최근 항목이어야 해요.
    const applied = executePixelCommand(state, 'git stash apply --index stash@{0}');
    expect(applied.files.find((file) => file.name === DOCUMENT_PATH)?.content).toBe(newestContent);
    expect(applied.stashes).toHaveLength(2);

    const popped = executePixelCommand(state, 'git stash pop stash@{0}');
    expect(popped.files.find((file) => file.name === DOCUMENT_PATH)?.content).toBe(newestContent);
    expect(popped.stashes).toHaveLength(1);
    expect(popped.stashes[0]?.working).toEqual(oldestWorking);

    const missing = executePixelCommand(state, 'git stash pop stash@{9}');
    expect(missing.lastAnim.kind).toBe('IDLE');
    expect(missing.bubbles[0]?.title).toContain('보관한 변경이 없어요');
    expect(missing.stashes).toHaveLength(2);
  });

  it('H2: refspec pushes to main are all blocked in ch8 and a bypassed merge still completes the chapter', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    for (const command of [
      'git push origin ai/fix:main',
      'git push -u origin ai/fix:main',
      'git push origin HEAD:main',
      'git push origin main',
    ]) {
      const blocked = executePixelCommand(state, command);
      expect(blocked.lastAnim.kind).toBe('AI_BLOCK_MAIN');
      expect(blocked.completedActions).not.toContain('PUSH');
    }
    // 출발 브랜치가 main이 아니면 정상 push는 계속 허용돼요.
    const normal = executePixelCommand(state, 'git push origin ai/fix');
    expect(normal.lastAnim.kind).toBe('PUSH');

    const deletion = executePixelCommand(state, 'git push origin :main');
    expect(deletion.lastAnim.kind).toBe('IDLE');
    expect(deletion.bubbles[0]?.title).toContain('삭제 push');

    // 우회로 AI 변경이 이미 원격 main에 들어간 경우에도 승인 단계가 막히지 않아요.
    let bypassed = runSequence('ch8', [
      'git worktree add -b ai/fix wt-ai', 'ai code', 'ai push-main', 'ai pr', 'ai ready',
    ]);
    const aiHead = bypassed.branches['ai/fix'];
    bypassed = { ...bypassed, remoteBranches: { ...bypassed.remoteBranches, main: aiHead } };
    const approved = executePixelCommand(bypassed, 'ai approve');
    expect(approved.lastAnim.kind).toBe('AI_APPROVE');
    expect(approved.ai.merged).toBe(true);
    expect(approved.completedActions).toContain('AI_APPROVE');
    expect(approved.bubbles[0]?.title).toContain('9장 실습 완료');
  });

  it('H3: worktree branch switch/delete is refused and a manual AI-branch PR still needs human approval', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    for (const command of ['git switch ai/fix', 'git checkout ai/fix']) {
      const refused = executePixelCommand(state, command);
      expect(refused.lastAnim.kind).toBe('IDLE');
      expect(refused.headBranch).toBe('main');
      expect(refused.bubbles[0]?.title).toContain('AI 작업 폴더');
    }
    for (const command of ['git branch -d ai/fix', 'git branch -D ai/fix']) {
      const refused = executePixelCommand(state, command);
      expect(refused.lastAnim.kind).toBe('IDLE');
      expect(refused.branches['ai/fix']).toBe(state.branches['ai/fix']);
      expect(refused.bubbles[0]?.title).toContain('작업 폴더');
    }

    // ai.prNumber가 비어 있어도 AI 브랜치에서 연 PR은 팀원 자동 승인 대상이 아니에요.
    const manual = {
      ...state,
      prs: [{
        number: 77, title: 'AI 브랜치 수동 PR', headBranch: 'ai/fix', baseBranch: 'main',
        status: 'open' as const, ci: 'pass' as const, approved: false,
      }],
      ai: { ...state.ai, prNumber: null },
    };
    const view = executePixelCommand(manual, 'gh pr view 77 --comments');
    expect(view.prs[0]?.approved).toBe(false);
    expect(view.bubbles[0]?.title).toContain('직접 승인');
  });

  it('M1: issue and PR numbers share one sequence in both creation orders', () => {
    const issueFirst = executePixelCommand(createStageState('ch5'), 'gh issue create --title "새 버그"');
    expect(issueFirst.issues.at(-1)?.number).toBe(13);
    const prAfterIssue = executePixelCommand(issueFirst, 'gh pr create --title "다크 모드"');
    expect(prAfterIssue.prs.at(-1)?.number).toBe(14);

    const prFirst = executePixelCommand(createStageState('ch5'), 'gh pr create --title "다크 모드"');
    expect(prFirst.prs.at(-1)?.number).toBe(13);
    const issueAfterPr = executePixelCommand(prFirst, 'gh issue create --title "새 버그"');
    expect(issueAfterPr.issues.at(-1)?.number).toBe(14);

    let ch8 = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    ch8 = executePixelCommand(ch8, 'gh issue create --title "AI 이슈"');
    expect(ch8.issues.at(-1)?.number).toBe(1);
    ch8 = executePixelCommand(ch8, 'ai pr');
    expect(ch8.prs.at(-1)?.number).toBe(2);
  });

  it('M2: repeating worktree creation points at the existing folder instead of a dead-end branch error', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai']);
    for (const command of ['git worktree add -b ai/fix wt-ai', 'git worktree add wt-ai']) {
      const duplicate = executePixelCommand(state, command);
      expect(duplicate.lastAnim.kind).toBe('IDLE');
      expect(duplicate.bubbles[0]?.title).toContain('이미 작업 폴더');
      expect(duplicate.bubbles[0]?.actions?.[0]?.command).toBe('ai code');
    }
  });

  it('M3: running ai pr twice keeps one draft PR and offers the next step', () => {
    let state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    state = executePixelCommand(state, 'ai pr');
    expect(state.prs).toHaveLength(1);
    const again = executePixelCommand(state, 'ai pr');
    expect(again.prs).toHaveLength(1);
    expect(again.ai.prNumber).toBe(state.ai.prNumber);
    expect(again.bubbles[0]?.title).toContain('이미 초안 PR');
    expect(again.bubbles[0]?.actions?.map((action) => action.command)).toEqual(
      expect.arrayContaining(['ai ready', `gh pr view ${state.ai.prNumber}`]),
    );
  });

  it('M6: pull only blocks on real overlap, not on unrelated staged changes', () => {
    let state = executePixelCommand(createStageState('ch4'), `git add ${DOCUMENT_PATH}`);
    expect(state.staged).toContain(DOCUMENT_PATH);
    state = executePixelCommand(state, 'git pull origin main');
    expect(state.lastAnim.kind).toBe('PULL');
    expect(state.staged).toContain(DOCUMENT_PATH);
    expect(state.files.some((file) => file.name === ATTENDANCE_PATH)).toBe(true);
  });

  it('L1: ci wording follows the current chapter branch instead of always naming feat/darkmode', () => {
    const ch4Watch = executePixelCommand(createStageState('ch4'), 'gh run watch');
    expect(ch4Watch.bubbles[0]?.message).not.toContain('다크 모드');
    expect(ch4Watch.bubbles[0]?.message).toContain('main');
    const ch4List = executePixelCommand(createStageState('ch4'), 'gh run list');
    const ch4Line = ch4List.terminal.at(-1)?.lines[0]?.text ?? '';
    expect(ch4Line).toContain('(main)');
    expect(ch4Line).not.toContain('feat/darkmode');

    const ch5Watch = executePixelCommand(createStageState('ch5'), 'gh run watch');
    expect(ch5Watch.bubbles[0]?.message).toContain('다크 모드');
    const ch5List = executePixelCommand(createStageState('ch5'), 'gh run list');
    expect(ch5List.terminal.at(-1)?.lines[0]?.text).toContain('(feat/darkmode)');
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

  it('keeps non-developer UX copy accurate across bubbles, tabs, and terminal output', () => {
    for (const id of ALL_STAGE_IDS) {
      const initial = createStageState(id);
      expect(initial.bubbles[0]?.nextHint ?? '').not.toContain('아래 추천 버튼');
    }

    let docs = executePixelCommand(createStageState('docs'), 'edit 회의록.md');
    docs = executePixelCommand(docs, 'git add 회의록.md');
    expect(docs.document?.comparison).toBe('working');
    expect(docs.bubbles[0]?.message).toContain('담아 둔 변경 탭');
    expect(docs.bubbles[0]?.message).not.toContain('스테이징 탭');

    const status = executePixelCommand(createStageState('ch1'), 'git status');
    expect(status.terminal.at(-1)?.lines[0]?.text).toContain('현재 main 브랜치');

    const switched = executePixelCommand(createStageState('ch4'), `git switch -c ${MEETING_PR_BRANCH}`);
    expect(switched.terminal.at(-1)?.lines[0]?.text).toContain('새 브랜치');

    const unauth = executePixelCommand(createStageState('ch7'), 'gh api /api/v3/user');
    expect(unauth.terminal.at(-1)?.lines[0]?.text).toContain('인증 필요');

    const blockedPush = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code', 'ai push-main']);
    expect(blockedPush.terminal.at(-1)?.lines.some((line) => line.text.includes('GH006') && line.text.includes('보호된 main'))).toBe(true);
  });

  it('Ch4: separates the author approval check from the reviewer approval action', () => {
    const reviewStep = STAGE_MAP.ch4.steps.find((step) => step.doneAction === 'PR_REVIEW');
    expect(reviewStep?.commandNote).toContain('Conversation');
    expect(reviewStep?.commandNote).toContain('리뷰어(팀원)');
    expect(reviewStep?.commandNote).toContain('자동');
  });

  it('does not point to a missing yellow button after the chapter is complete', () => {
    let state = createStageState('docs');
    for (const step of STAGE_MAP.docs.steps) state = executePixelCommand(state, step.command);
    expect(getNextPendingStep(state)).toBeNull();
    const unknown = executePixelCommand(state, 'git Abracadabra');
    expect(unknown.bubbles[0]?.message).not.toContain('위쪽의 노란');
    expect(unknown.bubbles[0]?.message).toContain('help');
    expect(unknown.terminal.at(-1)?.lines.map(({ text }) => text).join(' ')).not.toContain('노란');
  });
});

describe('Cycle 2 review regressions', () => {
  it('M-1: a second worktree with another branch is refused and keeps ai/fix protected', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    const attempt = executePixelCommand(state, 'git worktree add -b other wt-x');
    expect(attempt.lastAnim.kind).toBe('IDLE');
    expect(attempt.bubbles[0]?.title).toContain('이미 작업 폴더');
    expect(attempt.bubbles[0]?.actions?.[0]?.command).toBe('ai code');
    expect(attempt.ai.worktreeBranch).toBe('ai/fix');
    expect(attempt.ai.worktreeDir).toBe('wt-ai');
    expect(attempt.branches.other).toBeUndefined();

    // 원래 AI 브랜치의 switch/삭제 보호가 그대로 유지돼요.
    const switched = executePixelCommand(attempt, 'git switch ai/fix');
    expect(switched.lastAnim.kind).toBe('IDLE');
    expect(switched.headBranch).toBe('main');
    expect(switched.bubbles[0]?.title).toContain('AI 작업 폴더');
    const deleted = executePixelCommand(attempt, 'git branch -D ai/fix');
    expect(deleted.branches['ai/fix']).toBe(attempt.branches['ai/fix']);
    expect(deleted.bubbles[0]?.title).toContain('작업 폴더');

    // 수동으로 연 ai/fix PR도 여전히 팀원 자동 승인 대상이 아니에요(HITL 유지).
    const manual = {
      ...attempt,
      prs: [{
        number: 77, title: 'AI 브랜치 수동 PR', headBranch: 'ai/fix', baseBranch: 'main',
        status: 'open' as const, ci: 'pass' as const, approved: false,
      }],
      ai: { ...attempt.ai, prNumber: null },
    };
    const view = executePixelCommand(manual, 'gh pr view 77 --comments');
    expect(view.prs[0]?.approved).toBe(false);
    expect(view.bubbles[0]?.title).toContain('직접 승인');
  });

  it('L-1: deleting a non-main remote branch shows delete guidance without completing ch8-block', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    const deletion = executePixelCommand(state, 'git push origin :ai/fix');
    expect(deletion.lastAnim.kind).toBe('IDLE');
    expect(deletion.bubbles[0]?.title).toContain('삭제 push');
    expect(deletion.bubbles[0]?.message).not.toContain('main은 직접 push');
    expect(deletion.ai.mainPushBlocked).toBe(false);
    expect(deletion.completedActions).not.toContain('AI_BLOCK_MAIN');
    expect(deletion.remoteBranches['ai/fix']).toBe(state.remoteBranches['ai/fix']);

    const blockedMain = executePixelCommand(state, 'git push origin :main');
    expect(blockedMain.lastAnim.kind).toBe('IDLE');
    expect(blockedMain.bubbles[0]?.title).toContain('삭제 push');
    expect(blockedMain.bubbles[0]?.title).toContain('지울 수 없어요');
  });

  it('L-2: refs/heads/ refspecs are normalized before protection and branch lookup', () => {
    const state = runSequence('ch8', ['git worktree add -b ai/fix wt-ai', 'ai code']);
    const blocked = executePixelCommand(state, 'git push origin ai/fix:refs/heads/main');
    expect(blocked.lastAnim.kind).toBe('AI_BLOCK_MAIN');
    expect(blocked.ai.mainPushBlocked).toBe(true);
    expect(blocked.completedActions).toContain('AI_BLOCK_MAIN');
    expect(Object.keys(blocked.remoteBranches).some((branch) => branch.startsWith('refs/'))).toBe(false);

    const sourceBlocked = executePixelCommand(state, 'git push origin refs/heads/main:main');
    expect(sourceBlocked.lastAnim.kind).toBe('AI_BLOCK_MAIN');
    expect(Object.keys(sourceBlocked.remoteBranches).some((branch) => branch.startsWith('refs/'))).toBe(false);
  });
});

describe('GLM-5.4 full review regressions', () => {
  it('H-1: skipping both diff steps and going straight to add → commit recovers via commit diff', () => {
    let state = savePracticeDocument(createStageState('docs'), EXAMPLE_DOCUMENT);
    state = executePixelCommand(state, `git add ${DOCUMENT_PATH}`);
    state = executePixelCommand(state, 'git commit -m "비교 건너뛴 기록"');
    expect(getNextPendingStep(state)?.id).toBe('docs-diff');

    // 두 탭이 모두 비어 있을 때 안내 말풍선과 이전 기록 버튼을 제공해요.
    const emptyWorking = executePixelCommand(state, DOCUMENT_COMPARISONS.working.command);
    expect(emptyWorking.bubbles[0]?.message).toContain('이미 기록했네요');
    expect(emptyWorking.bubbles[0]?.actions?.some((a) => a.command === DOCUMENT_COMPARISONS.commits.command)).toBe(true);

    // 이전 기록 탭을 확인하면 두 비교 단계와 커밋 비교 단계가 함께 인정돼요.
    const committedDiff = executePixelCommand(emptyWorking, DOCUMENT_COMPARISONS.commits.command);
    expect(committedDiff.completedActions).toContain('DOCUMENT_WORKING_DIFF');
    expect(committedDiff.completedActions).toContain('DOCUMENT_STAGED_DIFF');
    expect(committedDiff.completedActions).toContain('DOCUMENT_COMMIT_DIFF');
    expect(getNextPendingStep(committedDiff)).toBeNull();
  });

  it('M-1: deleting the currently checked-out branch is refused without leaving an orphan root commit', () => {
    let state = executePixelCommand(createStageState('ch3'), 'git switch -c feat/dark');
    const refused = executePixelCommand(state, 'git branch -d feat/dark');
    expect(refused.lastAnim.kind).toBe('IDLE');
    expect(refused.branches['feat/dark']).toBe(state.branches['feat/dark']);
    expect(refused.bubbles[0]?.message).toContain('지금 서 있는 브랜치는 지울 수 없어요');

    state = executePixelCommand(refused, 'edit theme.js');
    state = executePixelCommand(state, 'git add .');
    state = executePixelCommand(state, 'git commit -m "브랜치 유지"');
    expect(state.commits.at(-1)?.parents.length).toBeGreaterThan(0);
  });

  it('M-2: git branch -d deletes only local branch, prints 7-char hash, and checks merge against HEAD', () => {
    let state = runSequence('ch4', [
      `git switch -c ${MEETING_PR_BRANCH}`,
      `git add ${DOCUMENT_PATH}`,
      `git commit -m "${MEETING_PR_TITLE}"`,
      `git push -u origin ${MEETING_PR_BRANCH}`,
      `gh pr create --title "${MEETING_PR_TITLE}"`,
      'gh pr view --comments',
      'gh pr merge',
      'git switch main',
      'git pull origin main',
    ]);
    const tipHash = state.commits.find((c) => c.id === state.branches[MEETING_PR_BRANCH])?.hash;
    const deleted = executePixelCommand(state, `git branch -d ${MEETING_PR_BRANCH}`);
    expect(deleted.branches[MEETING_PR_BRANCH]).toBeUndefined();
    expect(deleted.remoteBranches[MEETING_PR_BRANCH]).toBe(state.remoteBranches[MEETING_PR_BRANCH]);
    const output = deleted.terminal.at(-1)?.lines.map((l) => l.text).join(' ') ?? '';
    expect(output).toContain(`was ${tipHash}`);
    expect(deleted.bubbles[0]?.message).toContain('git push origin --delete');

    // HEAD 기준으로 병합 판정: main에 합치지 않았더라도 현재 HEAD에 합친 브랜치는 -d가 허용돼요.
    let headMerged = runSequence('ch3', [
      'git switch -c feat/dark',
      'git merge feat/ui',
      'resolve both',
      'git commit',
    ]);
    const deleteUi = executePixelCommand(headMerged, 'git branch -d feat/ui');
    expect(deleteUi.branches['feat/ui']).toBeUndefined();
    expect(deleteUi.remoteBranches['feat/ui']).toBe(headMerged.remoteBranches['feat/ui']);
  });

  it('M-3: token fine/classic/sso/ssh do not clear pushBlockedDemo; only removing the secret and committing unlocks push', () => {
    let state = executePixelCommand(createStageState('ch6'), 'token leak-test');
    expect(state.token.pushBlockedDemo).toBe(true);

    for (const cmd of ['token fine', 'token classic', 'token sso', 'token ssh']) {
      state = executePixelCommand(state, cmd);
      expect(state.token.pushBlockedDemo).toBe(true);
      const blockedPush = executePixelCommand(state, 'git push');
      expect(blockedPush.lastAnim.kind).toBe('TOKEN_BLOCK');
      expect(blockedPush.bubbles[0]?.nextHint).toContain('파일에서 토큰을 뺀 뒤 다시 기록');
    }

    // 작업 폴더의 .env.example(GITHUB_TOKEN=***)을 스테이징하고 다시 커밋하면 차단이 풀려요.
    state = executePixelCommand(state, 'git add .env.example');
    state = executePixelCommand(state, 'git commit -m "비밀 토큰 제거"');
    expect(state.token.pushBlockedDemo).toBe(false);
    const pushed = executePixelCommand(state, 'git push');
    expect(pushed.lastAnim.kind).toBe('PUSH');
  });

  it('M-5: Ch4 ADD/COMMIT require non-main branch and Ch2 REVERT requires removing 임시안내.md commit', () => {
    // 4장: main에서 바로 add/commit 해도 단계 완료로 인정되지 않아요.
    let ch4 = executePixelCommand(createStageState('ch4'), `git add ${DOCUMENT_PATH}`);
    expect(getNextPendingStep(ch4)?.id).toBe('ch4-branch');
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[1])).toBe(false);
    ch4 = executePixelCommand(ch4, 'git commit -m "실수로 main에 기록"');
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[1])).toBe(false);
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[2])).toBe(false);
    expect(ch4.bubbles[0]?.title).toContain('main에 직접 기록');

    // 되감고 새 브랜치에 기록하면 완료되고, 마지막 git switch main 뒤에도 완료가 유지돼요.
    ch4 = executePixelCommand(ch4, 'git reset --soft HEAD~1');
    ch4 = executePixelCommand(ch4, `git switch -c ${MEETING_PR_BRANCH}`);
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[1])).toBe(true);
    ch4 = executePixelCommand(ch4, `git commit -m "${MEETING_PR_TITLE}"`);
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[2])).toBe(true);
    ch4 = executePixelCommand(ch4, `git push -u origin ${MEETING_PR_BRANCH}`);
    ch4 = executePixelCommand(ch4, `gh pr create --title "${MEETING_PR_TITLE}"`);
    ch4 = executePixelCommand(ch4, 'gh pr view --comments');
    ch4 = executePixelCommand(ch4, 'gh pr merge');
    ch4 = executePixelCommand(ch4, 'git switch main');
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[1])).toBe(true);
    expect(isStepCompleted(ch4, STAGE_MAP.ch4.steps[2])).toBe(true);

    // 3장: 다른 커밋(c2)을 revert하면 임시안내.md가 남아 있어 REVERT 미완료.
    let ch2 = runSequence('ch2', [`git restore --staged ${SECRET_NOTE_PATH}`, 'git stash']);
    ch2 = executePixelCommand(ch2, 'git revert 4d5e6f7');
    expect(isStepCompleted(ch2, STAGE_MAP.ch2.steps[2])).toBe(false);
    expect(ch2.bubbles[0]?.title).toContain('잘못 올린 임시 안내 커밋이 아니에요');
  });

  it('L-1/L-2/L-4/L-6/L-7/L-8/L-13: stash restore hint, ch3 merge noop, checkout file, stage-only guards, merge abort, post-merge ai pr, and CLI fidelity', () => {
    // L-1: 3장 비밀 메모가 stash에 있을 때 stash pop 안내와 버튼 제공
    const ch2Stash = executePixelCommand(createStageState('ch2'), 'git stash');
    const restoreHint = executePixelCommand(ch2Stash, `git restore --staged ${SECRET_NOTE_PATH}`);
    expect(restoreHint.bubbles[0]?.message).toContain('임시 보관함');
    expect(restoreHint.bubbles[0]?.actions?.[0]?.command).toBe('git stash pop');

    // L-2: 5장 feat/ui 위에서 feat/dark 생성 후 merge no-op 시 원인 안내
    let ch3Noop = runSequence('ch3', ['git switch feat/ui', 'git switch -c feat/dark']);
    ch3Noop = executePixelCommand(ch3Noop, 'git merge feat/ui');
    expect(ch3Noop.bubbles[0]?.title).toContain('main에서 시작하지 않았어요');
    expect(ch3Noop.bubbles[0]?.actions?.[0]?.command).toBe('git switch main');

    // L-4: git checkout -- <file>은 브랜치 오류가 아니라 파일 되돌리기 안내로 분기
    const checkoutFile = executePixelCommand(createStageState('docs'), `git checkout -- ${DOCUMENT_PATH}`);
    expect(checkoutFile.bubbles[0]?.title).toContain('작업 파일 되돌리기는 이 실습에서 다루지 않아요');

    // L-6: 장 전용 체험 명령은 다른 장에서 상태를 바꾸지 않고 안내만 반환
    const wrongToken = executePixelCommand(createStageState('ch1'), 'token classic');
    expect(wrongToken.bubbles[0]?.title).toContain('7장');
    expect(wrongToken.token.riskScore).toBe(85);
    const wrongGhes = executePixelCommand(createStageState('ch1'), 'ghes test-public');
    expect(wrongGhes.bubbles[0]?.title).toContain('8장');
    const wrongAi = executePixelCommand(createStageState('ch1'), 'ai code');
    expect(wrongAi.bubbles[0]?.title).toContain('9장');

    // L-7: 충돌 중 git merge --abort
    let ch3Conflict = runSequence('ch3', ['git switch -c feat/dark', 'git merge feat/ui']);
    expect(ch3Conflict.conflict).not.toBeNull();
    const aborted = executePixelCommand(ch3Conflict, 'git merge --abort');
    expect(aborted.conflict).toBeNull();
    expect(aborted.bubbles[0]?.title).toContain('합치기를 중단했어요');

    // L-8: 9장 병합 완료 후 ai pr 재실행 시 고아 초안 PR 생성 차단
    const ch8Merged = runSequence('ch8', [
      'git worktree add -b ai/fix wt-ai',
      'ai code',
      'ai push-main',
      'ai pr',
      'ai ready',
      'ai approve',
    ]);
    const afterMergePr = executePixelCommand(ch8Merged, 'ai pr');
    expect(afterMergePr.prs).toHaveLength(1);
    expect(afterMergePr.bubbles[0]?.title).toContain('이미 합쳐진 변경');

    // L-13: 8장 repo 이름 일치, pull 미등록 리모트 차단, log --oneline 간략 형식, 1장 git pull 오안내 제거
    const ch7Issue = executePixelCommand(createStageState('ch7'), 'gh issue create --title "사내 이슈"');
    expect(ch7Issue.terminal.at(-1)?.lines.map((l) => l.text).join(' ')).toContain('corp/payroll-core/issues/');
    const badRemotePull = executePixelCommand(createStageState('ch4'), 'git pull upstream main');
    expect(badRemotePull.lastAnim.kind).toBe('IDLE');
    expect(badRemotePull.bubbles[0]?.message).toContain('origin');
    const oneline = executePixelCommand(createStageState('ch2'), 'git log --oneline');
    const firstLogLine = oneline.terminal.at(-1)?.lines[0]?.text ?? '';
    expect(firstLogLine).toMatch(/^[0-9a-f]{7} /);
    expect(firstLogLine).not.toContain('HEAD ->');
    const docsPull = executePixelCommand(createStageState('docs'), 'git pull');
    expect(docsPull.bubbles[0]?.message).not.toContain('git push');
  });
});
