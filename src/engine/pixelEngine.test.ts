import { describe, expect, it } from 'vitest';
import { ALL_STAGE_IDS, type PixelSimState, type StageId } from '../types/sim';
import {
  STAGE_MAP,
  STAGE_SCENARIOS,
  createStageState,
  executePixelCommand,
  getCommandAutocomplete,
} from './index';

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
  it('defines all 8 stages in STAGE_SCENARIOS and STAGE_MAP with cheat sheets', () => {
    expect(STAGE_SCENARIOS).toHaveLength(8);
    for (const id of ALL_STAGE_IDS) {
      const scenario = STAGE_MAP[id];
      expect(scenario).toBeDefined();
      expect(scenario.id).toBe(id);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
      expect(scenario.chips.length).toBeGreaterThanOrEqual(5);
      expect(scenario.cheatSheet.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('creates tailored initial world state and safe opening bubbles for all 8 stages', () => {
    for (const id of ALL_STAGE_IDS) {
      const state = createStageState(id);
      expect(state.stageId).toBe(id);
      expect(state.lastAnim.kind).toBe('IDLE');
      expect(state.lastAnim.seq).toBe(0);
      expect(state.completedActions).toEqual([]);
      expect(state.terminal.length).toBeGreaterThan(0);
      assertValidBubbles(state);
    }
  });
});

describe('Full stage walkthroughs (Ch1 ~ Ch8)', () => {
  it('Ch1: Working Dir -> Staging -> Local Repo -> Remote GitHub', () => {
    let s = deepFreeze(createStageState('ch1'));
    expect(s.files.some((f) => f.status === 'modified')).toBe(true);
    expect(s.files.some((f) => f.status === 'untracked')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'git status'));
    expect(s.lastAnim.kind).toBe('IDLE');
    expect(s.lastAnim.seq).toBe(1);

    s = deepFreeze(executePixelCommand(s, 'edit app.js'));
    expect(s.lastAnim.kind).toBe('EDIT');

    s = deepFreeze(executePixelCommand(s, 'git add .'));
    expect(s.lastAnim.kind).toBe('ADD');
    expect(s.staged).toContain('app.js');
    expect(s.staged).toContain('style.css');
    expect(s.files.find((f) => f.name === 'app.js')?.status).toBe('staged');

    s = deepFreeze(executePixelCommand(s, 'git commit -m "첫 세이브"'));
    expect(s.lastAnim.kind).toBe('COMMIT');
    expect(s.staged).toEqual([]);
    expect(s.commits[s.commits.length - 1]?.message).toBe('첫 세이브');
    expect(s.branches.main).toBe(s.commits[s.commits.length - 1]?.id);

    s = deepFreeze(executePixelCommand(s, 'git push'));
    expect(s.lastAnim.kind).toBe('PUSH');
    expect(s.remoteBranches.main).toBe(s.branches.main);
    expect(s.completedActions).toEqual(expect.arrayContaining(['ADD', 'COMMIT', 'PUSH']));
    expect(s.bubbles[0]?.title).toContain('Stage 1 클리어');
  });

  it('Ch2: git log, diff, stash, stash pop, reset --soft, revert HEAD', () => {
    let s = deepFreeze(createStageState('ch2'));
    const initialCommitCount = s.commits.length;

    s = deepFreeze(executePixelCommand(s, 'git log'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git diff'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git stash'));
    expect(s.lastAnim.kind).toBe('STASH');
    expect(s.stashCount).toBe(1);
    expect(s.files.every((f) => f.status === 'committed')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'git stash pop'));
    expect(s.lastAnim.kind).toBe('STASH_POP');
    expect(s.stashCount).toBe(0);
    expect(s.files[0]?.status).toBe('modified');

    s = deepFreeze(executePixelCommand(s, 'git revert HEAD'));
    expect(s.lastAnim.kind).toBe('REVERT');
    expect(s.commits).toHaveLength(initialCommitCount + 1);
    expect(s.commits[s.commits.length - 1]?.isRevert).toBe(true);
    expect(s.bubbles[0]?.title).toContain('Stage 2 클리어');

    // Bonus: reset --soft marks latest commit as ghost and stages file
    const beforeResetHead = s.branches.main;
    s = deepFreeze(executePixelCommand(s, 'git reset --soft HEAD~1'));
    expect(s.lastAnim.kind).toBe('RESET');
    expect(s.branches.main).not.toBe(beforeResetHead);
    expect(s.commits.find((c) => c.id === beforeResetHead)?.ghost).toBe(true);
    expect(s.staged.length).toBeGreaterThan(0);
  });

  it('Ch3: branch switch, deterministic merge conflict with 1-click actions, resolve, commit, rebase', () => {
    let s = deepFreeze(createStageState('ch3'));

    s = deepFreeze(executePixelCommand(s, 'git branch'));
    expect(s.lastAnim.kind).toBe('IDLE');

    s = deepFreeze(executePixelCommand(s, 'git switch -c feat/dark'));
    expect(s.lastAnim.kind).toBe('BRANCH');
    expect(s.headBranch).toBe('feat/dark');
    expect(s.branches['feat/dark']).toBeDefined();

    // Deterministic conflict on merging feature/ui
    s = deepFreeze(executePixelCommand(s, 'git merge feature/ui'));
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

    // Commit without -m completes merge commit and clears Stage 3
    s = deepFreeze(executePixelCommand(s, 'git commit'));
    expect(s.lastAnim.kind).toBe('COMMIT');
    expect(s.conflict).toBeNull();
    expect(s.commits[s.commits.length - 1]?.isMerge).toBe(true);
    expect(s.commits[s.commits.length - 1]?.parents.length).toBe(2);
    expect(s.bubbles[0]?.title).toContain('Stage 3 클리어');

    // Rebase works cleanly too
    s = deepFreeze(executePixelCommand(s, 'git rebase main'));
    expect(s.lastAnim.kind).toBe('REBASE');
  });

  it('Ch3: supports resolve ours, resolve theirs, and git checkout -b alias', () => {
    let s = runSequence('ch3', ['git checkout -b feat/alt', 'git merge feature/ui']);
    expect(s.headBranch).toBe('feat/alt');
    expect(s.conflict).not.toBeNull();

    const ours = executePixelCommand(s, 'resolve ours');
    expect(ours.conflict?.resolvedChoice).toBe('ours');
    expect(ours.files.find((f) => f.name === 'theme.js')?.content).toContain('dark-midnight');

    const theirs = executePixelCommand(s, 'resolve theirs');
    expect(theirs.conflict?.resolvedChoice).toBe('theirs');
    expect(theirs.files.find((f) => f.name === 'theme.js')?.content).toContain('sunset-coral');
  });

  it('Ch4: fetch, pull, push, gh pr create, gh pr merge', () => {
    let s = runSequence('ch4', [
      'git fetch',
      'git pull',
      'git push',
      'gh pr create --title "새 기능"',
      'gh pr merge',
    ]);
    expect(s.completedActions).toEqual(
      expect.arrayContaining(['FETCH', 'PULL', 'PUSH', 'PR_CREATE', 'PR_MERGE']),
    );
    expect(s.prs).toHaveLength(1);
    expect(s.prs[0]?.title).toBe('새 기능');
    expect(s.prs[0]?.status).toBe('merged');
    expect(s.bubbles[0]?.title).toContain('Stage 4 클리어');
  });

  it('Ch5: gh CLI full walkthrough (auth, repo, pr, issue, run watch, api)', () => {
    let s = deepFreeze(createStageState('ch5'));
    const initialIssues = s.issues.length;
    const initialPrs = s.prs.length;

    s = deepFreeze(executePixelCommand(s, 'gh auth status'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    // Should NOT prematurely celebrate after step 1 even though multiple steps use GH_CMD
    expect(s.bubbles[0]?.title).not.toContain('Stage 5 클리어');

    s = deepFreeze(executePixelCommand(s, 'gh repo view'));
    expect(s.lastAnim.kind).toBe('GH_CMD');

    s = deepFreeze(executePixelCommand(s, 'gh pr create --title "다크모드"'));
    expect(s.lastAnim.kind).toBe('PR_CREATE');
    expect(s.prs).toHaveLength(initialPrs + 1);
    expect(s.prs[s.prs.length - 1]?.title).toBe('다크모드');

    s = deepFreeze(executePixelCommand(s, 'gh pr list'));
    expect(s.lastAnim.kind).toBe('GH_CMD');

    s = deepFreeze(executePixelCommand(s, 'gh issue create --title "버그 수정"'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.issues).toHaveLength(initialIssues + 1);
    expect(s.issues[s.issues.length - 1]?.title).toBe('버그 수정');

    s = deepFreeze(executePixelCommand(s, 'gh run watch'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.bubbles[0]?.title).not.toContain('Stage 5 클리어');

    s = deepFreeze(executePixelCommand(s, 'gh api repos/gitdots/app'));
    expect(s.lastAnim.kind).toBe('GH_CMD');
    expect(s.bubbles[0]?.title).toContain('Stage 5 클리어');
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

    s = deepFreeze(executePixelCommand(s, 'token sso'));
    expect(s.lastAnim.kind).toBe('TOKEN_SSO');
    expect(s.token.ssoAuthorized).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'token ssh'));
    expect(s.lastAnim.kind).toBe('TOKEN_SSH');
    expect(s.token.sshReady).toBe(true);
    expect(s.bubbles[0]?.title).toContain('Stage 6 클리어');

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

    s = deepFreeze(executePixelCommand(s, 'gh api /api/v3/user'));
    expect(s.lastAnim.kind).toBe('GHES_API');
    expect(s.ghes.lastFlow).toBe('api-v3');

    s = deepFreeze(executePixelCommand(s, 'ghes runner'));
    expect(s.lastAnim.kind).toBe('GHES_RUNNER');
    expect(s.ghes.lastFlow).toBe('runner');
    expect(s.bubbles[0]?.title).toContain('Stage 7 클리어');

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

    s = deepFreeze(executePixelCommand(s, 'ai code'));
    expect(s.lastAnim.kind).toBe('AI_CODE');
    expect(s.ai.codeWritten).toBe(true);
    expect(s.files.find((f) => f.name === 'buggy.ts')?.content).toContain('a + b');
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
    // AI bubble MUST include 1-click human approval button
    expect(s.bubbles[0]?.speaker).toBe('ai');
    expect(s.bubbles[0]?.actions?.some((a) => a.command === 'ai approve')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'ai approve'));
    expect(s.lastAnim.kind).toBe('AI_APPROVE');
    expect(s.ai.humanApproved).toBe(true);
    expect(s.ai.merged).toBe(true);
    expect(s.prs[0]?.status).toBe('merged');
    expect(s.branches.main).not.toBe(initialMainCommit);
    expect(s.bubbles[0]?.title).toContain('Stage 8 클리어');
  });
});

describe('Utility commands, unknown commands & autocomplete', () => {
  it('handles unknown commands with a warm Korean fallback bubble and increments seq', () => {
    const init = deepFreeze(createStageState('ch1'));
    const next = executePixelCommand(init, 'git Abracadabra');
    expect(next.lastAnim.seq).toBe(1);
    expect(next.lastAnim.kind).toBe('IDLE');
    assertValidBubbles(next);
    expect(next.bubbles[0]?.message).toContain('어라, 모르는 명령어예요!');
    expect(next.bubbles[0]?.actions?.some((a) => a.command === 'help')).toBe(true);
  });

  it('supports help, clear, and reset cleanly', () => {
    let s = runSequence('ch1', ['git add .', 'help']);
    expect(s.terminal.some((e) => e.command === 'help')).toBe(true);

    s = deepFreeze(executePixelCommand(s, 'clear'));
    expect(s.terminal).toHaveLength(1);
    expect(s.staged).toContain('app.js');

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
      'git merge feature/ui',
    ]);
    const conflictAc = getCommandAutocomplete('res', conflictState);
    expect(conflictAc[0]?.cmd).toBe('resolve both');

    // AI PR context boosts ai approve to top
    const aiPrState = runSequence('ch8', [
      'git worktree add wt-ai -b ai/fix',
      'ai code',
      'ai pr',
    ]);
    const aiAc = getCommandAutocomplete('ai', aiPrState);
    expect(aiAc[0]?.cmd).toBe('ai approve');
  });
});
