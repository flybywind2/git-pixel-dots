import type {
  AiWorldState,
  BubbleAction,
  BubbleSpeaker,
  DocumentComparison,
  FileTree,
  GhesWorldState,
  LessonAction,
  PixelAnimKind,
  PixelCommit,
  PixelIssue,
  PixelPr,
  PixelSimState,
  SpeechBubble,
  StageId,
  StageStep,
  TerminalLine,
  TerminalLogEntry,
  TokenWorldState,
} from '../types/sim';
import { STAGE_MAP } from './scenarios';
import {
  diffDocumentLines,
  DOCUMENT_COMPARISONS,
  DOCUMENT_LIMIT,
  DOCUMENT_PATH,
  DOCUMENT_SAVE_LABEL,
  EXAMPLE_DOCUMENT,
  getDocumentComparison,
  getDocumentComparisonLabels,
  getDocumentWorkingText,
  ORIGINAL_DOCUMENT,
} from './documentDiff';
import { ATTENDANCE_DOCUMENT, ATTENDANCE_PATH, MEETING_PR_BRANCH, MEETING_PR_TITLE, MEETING_REVIEW_COMMENT, MEETING_REVIEWER, MISTAKEN_NOTICE_PATH, SECRET_NOTE_DOCUMENT, SECRET_NOTE_PATH } from './meetingExample';
import {
  changedPaths,
  checkoutTree,
  commitById,
  headCommit,
  headTree,
  mergeBase,
  mergeTrees,
  reachableCommits,
  remoteRelation,
  resolveRevision,
  restoreWorktree,
  trackedChanges,
  treeEntry,
  updateWorkspace,
  workingTree,
  writeTreeEntry,
} from './repoVersions';

const SPEAKER_NAMES: Record<BubbleSpeaker, string> = {
  buddy: '도트 버디',
  cloud: 'GitHub',
  guard: '보안 수문장',
  ai: '에이전트 봇',
  system: '도트 안내',
};

// 비개발자도 권한 이름을 바로 읽을 수 있게 짧은 풀이를 붙여요.
const SCOPE_LABELS: Readonly<Record<string, string>> = {
  repo: '저장소 읽기·쓰기',
  'admin:org': '조직 설정 관리',
  delete_repo: '저장소 삭제',
  workflow: '자동 검사(워크플로) 설정 수정',
  'contents:write (gitdots/app)': 'gitdots/app 파일 쓰기',
  'pull_requests:write': 'PR 작성·수정',
  'expires:30d': '30일 뒤 만료',
};

function scopeText(scope: string): string {
  const label = SCOPE_LABELS[scope];
  return label ? `${scope}(${label})` : scope;
}

const GHES_DEFAULT_HOST = 'github.corp.internal';

const DOCUMENT_GIT_COMMANDS = new Set([
  'status', 'diff', 'add', 'commit', 'log', 'push', 'revert', 'reset', 'branch', 'switch', 'checkout', 'stash', 'show',
]);

function clampAnchor(value: number): number {
  return Math.max(22, Math.min(78, Math.round(value)));
}

function makeBubble(
  id: string,
  speaker: BubbleSpeaker,
  anchorX: number,
  anchorY: number,
  title: string,
  message: string,
  nextHint?: string,
  actions?: BubbleAction[],
): SpeechBubble {
  const bubble: SpeechBubble = {
    id,
    speaker,
    speakerName: SPEAKER_NAMES[speaker],
    anchorX: clampAnchor(anchorX),
    anchorY: clampAnchor(anchorY),
    title,
    message,
  };
  if (nextHint !== undefined) {
    bubble.nextHint = nextHint;
  }
  if (actions && actions.length > 0) {
    bubble.actions = actions;
  }
  return bubble;
}

function mergeConflictBubble(file: string, seq: number): SpeechBubble {
  return makeBubble(`conflict-${seq}`, 'buddy', 48, 52, `${file}의 변경이 겹쳤어요`,
    `${file}의 같은 부분을 두 브랜치가 바꿨어요. 아래 버튼에서 남길 내용을 고르세요.`, undefined, [
      { label: '현재 브랜치 내용 유지', command: 'resolve ours', tone: 'primary' },
      { label: '상대 브랜치 내용 사용', command: 'resolve theirs', tone: 'amber' },
      { label: '두 변경 함께 남기기', command: 'resolve both', tone: 'mint' },
    ]);
}

export function resumePracticeBubbles(state: PixelSimState): SpeechBubble[] {
  if (Array.isArray(state.bubbles) && state.bubbles.length > 0) return state.bubbles;
  if (state.conflict && !state.conflict.revert && state.conflict.resolvedChoice === 'none') {
    return [mergeConflictBubble(state.conflict.file, state.lastAnim.seq)];
  }
  if (state.lastAnim.seq === 0) return createStageState(state.stageId).bubbles;
  const next = getNextPendingStep(state);
  return [makeBubble('resume', 'system', 50, 50,
    next ? '하던 실습을 이어 가요' : '이 장의 실습을 마쳤어요',
    next?.goal ?? STAGE_MAP[state.stageId].takeaway)];
}

function defaultTokenState(): TokenWorldState {
  return {
    mode: 'classic',
    scopes: ['repo', 'admin:org', 'delete_repo'],
    ssoAuthorized: false,
    sshReady: false,
    riskScore: 85,
    pushBlockedDemo: false,
    expires: undefined,
  };
}

function defaultGhesState(): GhesWorldState {
  return {
    host: GHES_DEFAULT_HOST,
    connected: false,
    mode: 'ghes',
    lastFlow: 'idle',
    auditLogs: ['[INFO] 사내 방화벽 활성화 (외부 github.com 차단 중)'],
  };
}

function defaultAiState(): AiWorldState {
  return {
    worktreeActive: false,
    worktreeBranch: 'ai/fix',
    worktreeDir: 'wt-ai',
    codeWritten: false,
    tokenSafe: true,
    mainPushBlocked: false,
    prNumber: null,
    humanApproved: false,
    merged: false,
  };
}

function makeHash(seed: number, salt: string): string {
  let acc = (seed * 2654435761) >>> 0;
  for (let i = 0; i < salt.length; i += 1) {
    acc = ((acc << 5) - acc + salt.charCodeAt(i)) >>> 0;
  }
  return acc.toString(16).padStart(7, '0').slice(0, 7);
}

function makeLogEntry(
  seq: number,
  command: string,
  branch: string,
  lines: TerminalLine[],
): TerminalLogEntry {
  return {
    id: `log-${seq}-${command.length}`,
    command,
    branch,
    lines,
  };
}

function extractQuotedFlag(cmd: string, flags: string[]): string | null {
  for (const flag of flags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // --hostname=github.corp.internal 처럼 등호로 붙여 쓴 형태도 받아요.
    const equalsForm = new RegExp(`${escaped}=("([^"]*)"|'([^']*)'|([^\\s]+))`);
    const matchEquals = cmd.match(equalsForm);
    if (matchEquals) return matchEquals[2] ?? matchEquals[3] ?? matchEquals[4] ?? null;

    const doubleQuoted = new RegExp(`${escaped}\\s+"([^"]*)"`);
    const matchDouble = cmd.match(doubleQuoted);
    if (matchDouble) return matchDouble[1];

    const singleQuoted = new RegExp(`${escaped}\\s+'([^']*)'`);
    const matchSingle = cmd.match(singleQuoted);
    if (matchSingle) return matchSingle[1];

    const bare = new RegExp(`${escaped}\\s+([^\\s]+)`);
    const matchBare = cmd.match(bare);
    if (matchBare?.[1]) return matchBare[1];
  }
  return null;
}

/**
 * -m/--message 값을 읽어요. 따옴표가 없어도 뒤따르는 단어를 모두 이어 붙여
 * 첫 단어만 잘리는 일이 없게 하고, 값이 비어 있으면 오류로 알려요.
 */
function parseCommitMessage(tokens: string[]): { message: string | null; missing: boolean } {
  const flagIndex = tokens.findIndex((token) => token === '-m' || token === '--message' || token === '-am');
  if (flagIndex === -1) return { message: null, missing: false };
  const rest = tokens.slice(flagIndex + 1).filter((token) => token !== '--no-edit');
  const words = rest.filter((token) => !token.startsWith('-'));
  if (words.length === 0) return { message: null, missing: true };
  return { message: words.join(' '), missing: false };
}

function scopeLines(scopes: string[], expires?: string): string[] {
  const base = scopes.filter((scope) => !scope.startsWith('expires:'));
  const expiry = expires ?? scopes.find((scope) => scope.startsWith('expires:'))?.replace('expires:', '');
  return [`  ✓ Token scopes: ${base.map(scopeText).join(', ')} (부여된 권한)`,
    ...(expiry ? [`  ✓ Expiration: ${expiry} (만료 — 권한이 아니라 토큰 속성이에요)`] : [])];
}

function reviewCommentFor(state: PixelSimState, pr: PixelPr): string {
  if (state.stageId === 'ch8') return '덧셈 결과가 5로 고쳐졌는지 테스트로 확인했어요. 변경 범위도 한 줄이라 안전해 보여요!';
  if (state.stageId === 'ch5') return '다크 모드 색상 대비를 확인했어요. 글자가 잘 보여요!';
  if (state.stageId === 'ch4') return MEETING_REVIEW_COMMENT;
  return pr.title.includes('다크') ? '다크 모드 색상 대비를 확인했어요. 글자가 잘 보여요!' : MEETING_REVIEW_COMMENT;
}

function reviewSpeaker(state: PixelSimState): string {
  return state.stageId === 'ch8' ? '@dot-dev' : `@${MEETING_REVIEWER}`;
}

function nextSharedNumber(state: PixelSimState): number {
  // 실제 GitHub는 이슈와 PR이 하나의 번호를 함께 써요.
  const prMax = state.prs.reduce((max, pr) => Math.max(max, pr.number), 0);
  const issueMax = state.issues.reduce((max, issue) => Math.max(max, issue.number), 0);
  return Math.max(prMax, issueMax) + 1;
}

function aheadCommitCount(state: PixelSimState, branch: string): number {
  const local = treeEntry(state.branches, branch);
  const remote = treeEntry(state.remoteBranches, branch);
  if (!local) return 0;
  const localHistory = reachableCommits(state, local);
  const remoteHistory = reachableCommits(state, remote);
  return [...localHistory].filter((id) => !remoteHistory.has(id)).length;
}

function hasMergeMarker(text: string | undefined): boolean {
  return Boolean(text && /^<{7}|^={7}$|^>{7}/m.test(text));
}

export function isStepCompleted(state: PixelSimState, step: StageStep): boolean {
  if (Array.isArray(step.doneAction)) {
    return step.doneAction.some((act) => state.completedActions.includes(act));
  }
  return state.completedActions.includes(step.doneAction);
}

export function getNextPendingStep(state: PixelSimState): StageStep | null {
  const scenario = STAGE_MAP[state.stageId];
  for (const step of scenario.steps) {
    if (!isStepCompleted(state, step)) {
      return step;
    }
  }
  return null;
}

function areAllStepsCompleted(state: PixelSimState): boolean {
  return getNextPendingStep(state) === null;
}

function nextStepHintText(state: PixelSimState): string {
  const next = getNextPendingStep(state);
  if (next) {
    return `다음 목표: ${next.goal}`;
  }
  return `${STAGE_MAP[state.stageId].number}장 실습을 마쳤어요.`;
}

function appendTerminal(state: PixelSimState, entry: TerminalLogEntry): TerminalLogEntry[] {
  return [...state.terminal.slice(-24), entry];
}

function withCompletedAction(
  prev: LessonAction[],
  kind: LessonAction,
): LessonAction[] {
  if (kind === 'IDLE' || prev.includes(kind)) {
    return prev;
  }
  return [...prev, kind];
}

function finalizeTransition(
  prevState: PixelSimState,
  draft: PixelSimState,
  kind: PixelAnimKind,
  label: string,
  detail: string | undefined,
  command: string,
  lines: TerminalLine[],
  primaryBubble: SpeechBubble,
): PixelSimState {
  const seq = prevState.lastAnim.seq + 1;
  const completedActions = withCompletedAction(draft.completedActions, kind);
  const terminal = appendTerminal(
    draft,
    makeLogEntry(seq, command, draft.headBranch, lines),
  );

  const nextState: PixelSimState = {
    ...draft,
    completedActions,
    terminal,
    lastAnim: detail !== undefined ? { kind, seq, label, detail } : { kind, seq, label },
    bubbles: [primaryBubble],
  };

  const wasCleared = areAllStepsCompleted(prevState);
  const nowCleared = areAllStepsCompleted(nextState);

  if (!wasCleared && nowCleared) {
    const scenario = STAGE_MAP[nextState.stageId];
    return {
      ...nextState,
      bubbles: [{ ...primaryBubble, title: `${scenario.number}장 실습 완료` }],
    };
  }

  return nextState;
}

type StageSeed = Omit<PixelSimState, 'commits' | 'index'> & {
  commits: (Omit<PixelCommit, 'tree'> & { tree?: FileTree })[];
};

export function createStageState(id: StageId): PixelSimState {
  const seed = stageSeed(id);
  const committed = workingTree({ files: seed.files.filter((file) => file.status === 'committed') });
  const commits = seed.commits.map((commit) => ({ ...commit, tree: commit.tree ?? committed }));
  const state = { ...seed, commits, index: {} };
  const index = { ...headTree(state) };
  for (const file of seed.files) {
    if (file.status === 'staged') writeTreeEntry(index, file.name, file.content);
  }
  return updateWorkspace(state, workingTree(seed), index);
}

function stageSeed(id: StageId): StageSeed {

  switch (id) {
    case 'ch1':
      return {
        stageId: 'ch1',
        files: [
          { name: DOCUMENT_PATH, status: 'modified', content: EXAMPLE_DOCUMENT },
          { name: ATTENDANCE_PATH, status: 'untracked', content: ATTENDANCE_DOCUMENT },
        ],
        staged: [],
        commits: [
          {
            id: 'c1',
            hash: 'a1b2c3d',
            message: '스터디 회의록 초안',
            branch: 'main',
            parents: [],
            tree: { [DOCUMENT_PATH]: ORIGINAL_DOCUMENT },
          },
        ],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c1' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '작업 폴더 준비 완료' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch1',
            'buddy',
            32,
            54,
            '공유할 문서 두 개가 있어요',
            `회의록.md의 모임 시간을 바꿨고 ${ATTENDANCE_PATH}를 새로 썼어요. 두 문서를 다음 커밋에 담아서 팀에 보낼 수 있어요.`,
            '위쪽의 노란 버튼을 눌러 두 문서를 다음 기록에 담아 보세요.',
            [{ label: '다음 기록에 담기', command: 'git add .', tone: 'mint' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: `작업 폴더에 수정한 ${DOCUMENT_PATH}와 새로 쓴 ${ATTENDANCE_PATH}가 있어요.`, tone: 'muted' },
          ]),
        ],
      };

    case 'docs':
      return {
        stageId: 'docs',
        files: [{ name: DOCUMENT_PATH, status: 'committed', content: ORIGINAL_DOCUMENT }],
        document: { comparison: 'working' },
        staged: [],
        commits: [{
          id: 'c1',
          hash: '4a9cda1',
          message: '스터디 회의록 초안',
          branch: 'main',
          parents: [],
        }],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c1' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '문서 편집 준비' },
        completedActions: [],
        bubbles: [
          makeBubble('init-docs', 'buddy', 32, 54, '스터디 안내를 고쳐 볼까요?',
            '편집기에서 회의록을 고친 뒤 어떤 줄이 바뀌었는지 확인하세요.'),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '연습 저장소에 스터디 회의록의 초안이 기록돼 있어요.', tone: 'muted' },
          ]),
        ],
      };

    case 'ch2': {
      const currentDocuments = { [DOCUMENT_PATH]: EXAMPLE_DOCUMENT, [ATTENDANCE_PATH]: ATTENDANCE_DOCUMENT };
      const mistakenNotice = '# 임시 모임 안내\n\n이번 모임은 취소됐어요.\n';
      return {
        stageId: 'ch2',
        files: [
          { name: DOCUMENT_PATH, status: 'modified', content: `${EXAMPLE_DOCUMENT}\n준비물은 읽을 책과 필기 도구예요.\n` },
          { name: ATTENDANCE_PATH, status: 'committed', content: ATTENDANCE_DOCUMENT },
          { name: MISTAKEN_NOTICE_PATH, status: 'committed', content: mistakenNotice },
          { name: SECRET_NOTE_PATH, status: 'staged', content: SECRET_NOTE_DOCUMENT },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '1a2b3c4', message: '회의록 초안', branch: 'main', parents: [], tree: { [DOCUMENT_PATH]: ORIGINAL_DOCUMENT } },
          { id: 'c2', hash: '4d5e6f7', message: '모임 시간 수정과 참석 안내', branch: 'main', parents: ['c1'], tree: currentDocuments },
          { id: 'c3', hash: '7e8f9a0', message: '잘못 올린 임시 안내', branch: 'main', parents: ['c2'],
            tree: { ...currentDocuments, [MISTAKEN_NOTICE_PATH]: mistakenNotice } },
        ],
        branches: { main: 'c3' },
        headBranch: 'main',
        remoteBranches: { main: 'c3' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '임시 보관 준비 완료' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch2',
            'buddy',
            34,
            54,
            '작업 중에 급한 수정이 생겼어요',
            `마지막 커밋에 ${MISTAKEN_NOTICE_PATH}를 실수로 넣었고, ${SECRET_NOTE_PATH}까지 장바구니에 담겨 있어요. 비밀 메모부터 빼고, 준비물 수정을 임시 보관한 뒤 잘못 올린 안내를 취소해 보세요.`,
            '위쪽의 노란 버튼을 눌러 비밀번호 메모를 장바구니에서 빼 보세요.',
            [{ label: '장바구니에서 비밀 메모 빼기', command: `git restore --staged ${SECRET_NOTE_PATH}`, tone: 'amber' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: `수정 중인 ${DOCUMENT_PATH}, 잘못 올린 ${MISTAKEN_NOTICE_PATH}, 장바구니에 담긴 ${SECRET_NOTE_PATH}가 있어요.`, tone: 'muted' },
          ]),
        ],
      };
    }

    case 'ch3':
      return {
        stageId: 'ch3',
        files: [
          { name: 'theme.js', status: 'committed', content: 'export const theme = "dark-midnight";' },
          { name: 'app.js', status: 'committed', content: 'import { theme } from "./theme";' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '10aa20b', message: '기본 테마 설정', branch: 'main', parents: [],
            tree: { 'theme.js': 'export const theme = "light";', 'app.js': 'import { theme } from "./theme";' } },
          { id: 'c2', hash: '30cc40d', message: '테마를 dark-midnight으로 변경', branch: 'main', parents: ['c1'] },
          { id: 'c3', hash: '50ee60f', message: '테마를 sunset-coral로 변경', branch: 'feat/ui', parents: ['c1'],
            tree: { 'theme.js': 'export const theme = "sunset-coral";', 'app.js': 'import { theme } from "./theme";' } },
        ],
        branches: { main: 'c2', 'feat/ui': 'c3' },
        headBranch: 'main',
        remoteBranches: { main: 'c2', 'feat/ui': 'c3' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '브랜치 월드 준비' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch3',
            'buddy',
            34,
            54,
            'theme.js의 두 버전을 합쳐 봐요',
            'main과 feat/ui가 같은 줄에 서로 다른 색을 골랐어요. main에서 새 브랜치를 만들어 합치기를 연습해요.',
            '위쪽의 노란 버튼을 눌러 새 브랜치를 만들어 보세요.',
            [{ label: '새 브랜치 만들기', command: 'git switch -c feat/dark', tone: 'primary' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '브랜치: main (현재), feat/ui', tone: 'muted' },
          ]),
        ],
      };

    case 'ch4':
      return {
        stageId: 'ch4',
        files: [
          { name: DOCUMENT_PATH, status: 'modified', content: EXAMPLE_DOCUMENT.replace('1층 회의실', '2층 모임방') },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: 'a01b02c', message: '팀 회의록 초안', branch: 'main', parents: [], tree: { [DOCUMENT_PATH]: EXAMPLE_DOCUMENT } },
          { id: 'c2', hash: 'd03e04f', message: '팀원: 참석 안내 추가', branch: 'origin/main', parents: ['c1'],
            tree: { [DOCUMENT_PATH]: EXAMPLE_DOCUMENT, [ATTENDANCE_PATH]: ATTENDANCE_DOCUMENT } },
        ],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c2' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: 'GitHub 협업 준비' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch4',
            'buddy',
            34,
            54,
            '회의록 장소를 바꿨어요',
            '작업 폴더의 회의록에 바꾼 장소가 아직 기록되지 않았어요. 팀원은 GitHub에 참석 안내를 올려 두었어요(마지막에 함께 가져올 거예요). 새 브랜치를 만들어 내 변경을 기록해 보세요.',
            '위쪽의 노란 버튼을 눌러 새 브랜치를 만들어 보세요.',
            [{ label: '새 브랜치 만들기', command: `git switch -c ${MEETING_PR_BRANCH}`, tone: 'primary' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: 'main 브랜치예요. 회의록.md에 바꾼 장소가 아직 커밋되지 않았어요.', tone: 'muted' },
          ]),
        ],
      };

    case 'ch5':
      return {
        stageId: 'ch5',
        files: [
          { name: 'darkmode.css', status: 'committed', content: ':root { color-scheme: dark; }' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: 'b11c22d', message: '초기 앱 구조', branch: 'main', parents: [],
            tree: { 'index.html': '<main class="app">GitDots</main>', 'app.css': ':root { color-scheme: light; }' } },
          { id: 'c2', hash: 'e33f44a', message: '다크 모드 스타일 추가', branch: 'feat/darkmode', parents: ['c1'],
            tree: { 'index.html': '<main class="app">GitDots</main>', 'app.css': ':root { color-scheme: light; }', 'darkmode.css': ':root { color-scheme: dark; }' } },
          { id: 'c0', hash: 'f00a11b', message: '도트 폰트 크기 조정', branch: 'fix/font', parents: ['c1'],
            tree: { 'index.html': '<main class="app">GitDots</main>', 'app.css': ':root { color-scheme: light; font-size: 15px; }' } },
        ],
        branches: { main: 'c1', 'feat/darkmode': 'c2', 'fix/font': 'c0' },
        headBranch: 'feat/darkmode',
        remoteBranches: { main: 'c1', 'feat/darkmode': 'c2', 'fix/font': 'c0' },
        stashes: [],
        stashCount: 0,
        prs: [
          {
            number: 12,
            title: '도트 폰트 가독성 개선',
            headBranch: 'fix/font',
            baseBranch: 'main',
            status: 'open',
            ci: 'pass',
            approved: true,
          },
        ],
        issues: [
          { number: 7, title: '모바일 말풍선 여백 조정', status: 'open' },
        ],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: 'gh CLI 준비' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch5',
            'buddy',
            34,
            54,
            '다크 모드 변경이 준비됐어요',
            'feat/darkmode 브랜치가 GitHub 연습 저장소에 올라가 있어요. 먼저 gh가 어느 계정으로 작업하는지 확인해요.',
            '위쪽의 노란 버튼을 눌러 로그인 상태를 확인해 보세요.',
            [{ label: '로그인 상태 확인하기', command: 'gh auth status', tone: 'primary' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'feat/darkmode', [
            { text: 'gh CLI가 설치되어 있어요. gh auth status부터 실행해 봐요!', tone: 'muted' },
          ]),
        ],
      };

    case 'ch6':
      return {
        stageId: 'ch6',
        files: [
          { name: '.env.example', status: 'committed', content: 'GITHUB_TOKEN=***' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '9a8b7c6', message: '보안 설정 초기화', branch: 'main', parents: [],
            tree: { '.env.example': 'GITHUB_TOKEN=ghp_***\n' } },
        ],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c1' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '보안 관문 준비' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch6',
            'guard',
            56,
            48,
            '토큰 보안 관문에 오신 걸 환영해요! 🛡️',
            '예제에서는 gitdots/app 한 곳에만 쓸 수 있으면 돼요. 두 토큰으로 각각 어느 저장소를 열 수 있는지 확인해 보세요.',
            '위쪽의 노란 버튼을 눌러 예제 토큰의 권한을 확인해 보세요.',
            [{ label: '넓은 권한 살펴보기', command: 'token classic', tone: 'coral' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '예제 classic 토큰에는 repo, admin:org, delete_repo, workflow 범위가 설정돼 있어요.', tone: 'amber' },
          ]),
        ],
      };

    case 'ch7':
      return {
        stageId: 'ch7',
        files: [
          { name: 'payroll-core.ts', status: 'committed', content: '// 사내 대외비 핵심 로직' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '7c6d5e4', message: '사내 핵심 서비스 초기화', branch: 'main', parents: [] },
        ],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c1' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: GHES_DEFAULT_HOST,
        ghUser: 'corp-dev',
        token: defaultTokenState(),
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: '사내망 GHES 대기' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch7',
            'guard',
            52,
            48,
            '이 회사는 사내 GitHub를 써요',
            '이 예제 회사의 방화벽은 github.com 전송을 막아요. 사내 GitHub의 주소는 github.corp.internal이에요.',
            '위쪽의 노란 버튼을 눌러 외부 차단부터 확인해 보세요.',
            [{ label: '외부 전송 차단 확인하기', command: 'ghes test-public', tone: 'coral' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '대상 호스트: github.corp.internal (회사 내부망)', tone: 'muted' },
          ]),
        ],
      };

    case 'ch8':
      return {
        stageId: 'ch8',
        files: [
          { name: 'buggy.ts', status: 'committed', content: 'export const sum = (a: number, b: number) => a - b;' },
          { name: 'buggy.test.ts', status: 'committed', content: 'expect(sum(2, 3)).toBe(5);' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: 'a11b22c', message: '계산기 초기 버전 (덧셈 버그)', branch: 'main', parents: [] },
        ],
        branches: { main: 'c1' },
        headBranch: 'main',
        remoteBranches: { main: 'c1' },
        stashes: [],
        stashCount: 0,
        prs: [],
        issues: [],
        conflict: null,
        ghHost: 'github.com',
        ghUser: 'dot-dev',
        token: {
          mode: 'fine-grained',
          scopes: ['contents:write (gitdots/app)', 'pull_requests:write'],
          ssoAuthorized: true,
          sshReady: true,
          riskScore: 12,
          pushBlockedDemo: false,
        },
        ghes: defaultGhesState(),
        ai: defaultAiState(),
        lastAnim: { kind: 'IDLE', seq: 0, label: 'AI 에이전트 대기' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch8',
            'ai',
            66,
            52,
            '삐빅! AI 에이전트 준비 완료 🤖',
            'buggy.ts의 덧셈 버그를 고쳐드릴게요! 다만 main 폴더를 바로 건드리면 위험하니 별도 작업 폴더(worktree)를 먼저 열어 주세요.',
            '위쪽의 노란 버튼을 눌러 AI 작업 폴더를 만들어 보세요.',
            [{ label: 'AI 작업 폴더 만들기', command: 'git worktree add -b ai/fix wt-ai', tone: 'mint' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '브랜치 보호 규칙 적용 중 (기본 브랜치 직접 공유 금지, 승인 필요)', tone: 'muted' },
          ]),
        ],
      };
  }
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function closestCommand(sub: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(sub, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// 파일명·변수명 뒤 조사(을/를)는 마지막 글자의 받침 여부로 골라요.
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 > 0 ? '을' : '를';
  return '를';
}

function commandNotice(
  state: PixelSimState,
  command: string,
  title: string,
  message: string,
  tone: TerminalLine['tone'] = 'muted',
): PixelSimState {
  return finalizeTransition(
    state, state, 'IDLE', title, undefined, command,
    [{ text: message, tone }],
    makeBubble(`command-notice-${state.lastAnim.seq + 1}`, 'buddy', 32, 54, title, message),
  );
}

function recordRevert(state: PixelSimState, draft: PixelSimState, target: PixelCommit, cmd: string): PixelSimState {
  const changed = changedPaths(headTree(state), draft.index);
  if (changed.length === 0) {
    return commandNotice(state, cmd, '기록할 취소 변경이 없어요', '지금 버전을 유지하려면 git revert --skip으로 넘어가세요.', 'amber');
  }
  const head = state.branches[state.headBranch];
  const seq = state.lastAnim.seq + 1;
  const message = `Revert "${target.message}"`;
  const commit: PixelCommit = {
    id: `c${state.commits.length + 1}`,
    hash: makeHash(seq, message),
    message,
    branch: state.headBranch,
    parents: [head],
    tree: draft.index,
    isRevert: true,
  };
  const next = updateWorkspace({
    ...draft,
    commits: [...state.commits, commit],
    branches: { ...state.branches, [state.headBranch]: commit.id },
    conflict: null,
  }, workingTree(draft), draft.index);
  const description = `“${target.message}”의 변경을 취소했어요. 바뀐 파일은 ${changed.join(', ')}예요.`;
  return finalizeTransition(
    state, next, 'REVERT', '취소 커밋 기록', commit.hash, cmd,
    [
      { text: `[${state.headBranch} ${commit.hash}] ${message}`, tone: 'mint' },
      { text: description, tone: 'sky' },
    ],
    makeBubble(`revert-${seq}`, 'buddy', 48, 52, '지난 변경을 취소하는 커밋을 만들었어요', description),
  );
}

export function savePracticeDocument(
  state: PixelSimState,
  text: string,
  command = DOCUMENT_SAVE_LABEL,
): PixelSimState {
  if (!state.document) return state;

  const working = text.replace(/\r\n?/g, '\n');
  if (working.length > DOCUMENT_LIMIT) {
    return commandNotice(state, command, '문서 길이를 확인해 주세요', `편집기에서는 ${DOCUMENT_LIMIT}자까지 저장할 수 있어요.`);
  }
  if (working === getDocumentWorkingText(state)) {
    return commandNotice(state, command, '같은 문서 내용', '이미 저장한 작업 문서와 내용이 같아요.');
  }

  const draft = updateWorkspace(state, { ...workingTree(state), [DOCUMENT_PATH]: working }, state.index);
  return finalizeTransition(
    state, draft, 'EDIT', '작업 문서 저장', DOCUMENT_PATH, command,
    [
      { text: `${DOCUMENT_PATH}를 작업 파일에 저장했어요.`, tone: 'mint' },
      { text: `${DOCUMENT_COMPARISONS.working.command}로 바뀐 줄을 확인할 수 있어요.`, tone: 'muted' },
    ],
    makeBubble(`document-save-${state.lastAnim.seq + 1}`, 'buddy', 32, 54, '작업 파일에 저장했어요',
      '작업 파일에 저장했을 뿐 아직 기록(커밋)은 아니에요. 먼저 바뀐 줄을 확인해 볼까요?'),
  );
}

function getDocumentDiffMode(args: string[]): DocumentComparison | null {
  const options = [...args];
  const path = options.at(-1);
  if (path === DOCUMENT_PATH || path === `./${DOCUMENT_PATH}` || path === '.') options.pop();
  if (options.at(-1) === '--') options.pop();

  switch (options.join(' ')) {
    case '':
      return 'working';
    case '--staged':
    case '--cached':
    case '--staged HEAD':
    case '--cached HEAD':
      return 'staged';
    case 'HEAD~1 HEAD':
    case 'HEAD^ HEAD':
    case 'HEAD~1..HEAD':
    case 'HEAD^..HEAD':
      return 'commits';
    default:
      return null;
  }
}

function comparePracticeDocument(state: PixelSimState, cmd: string, args: string[]): PixelSimState {
  const mode = getDocumentDiffMode(args);
  if (!mode || !state.document) {
    return commandNotice(state, cmd, '비교할 대상을 골라 주세요',
      '이 장에서 쓸 수 있는 git diff 명령은 비교 패널과 명령어 사전에 있어요.');
  }

  const view = DOCUMENT_COMPARISONS[mode];
  const labels = getDocumentComparisonLabels(state, mode);
  const comparison = getDocumentComparison(state, mode);
  const changes = comparison ? diffDocumentLines(comparison.before, comparison.after) : [];
  const lines: TerminalLine[] = [{ text: `${labels.before} → ${labels.after}`, tone: 'sky' }];
  const stagedDocument = state.staged.includes(DOCUMENT_PATH);
  const emptyWorkingAfterAdd = mode === 'working' && changes.length === 0 && stagedDocument;
  const message = !comparison
    ? '문서를 커밋하면 이전 기록과 비교할 수 있어요.'
    : changes.length === 0
      ? emptyWorkingAfterAdd
        ? '이미 장바구니에 담겨 있어서 바뀐 줄 탭은 비어 있어요. ‘담아 둔 변경’ 탭에서 확인할 수 있어요.'
        : view.empty
      : '−는 빠진 줄, +는 들어간 줄이에요.';

  if (changes.length === 0) {
    lines.push({ text: message, tone: 'muted' });
  } else {
    lines.push({ text: `--- a/${DOCUMENT_PATH}\n+++ b/${DOCUMENT_PATH}`, tone: 'muted' });
    for (const change of changes) {
      const prefix = change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : ' ';
      const tone = change.kind === 'added' ? 'mint' : change.kind === 'removed' ? 'coral' : 'default';
      lines.push({ text: `${prefix}${change.text}`, tone });
      if (change.noFinalNewline) lines.push({ text: '  (문서 끝에 줄바꿈 없음)', tone: 'muted' });
    }
  }

  // 빈 diff로 조용히 단계가 끝나지 않도록, 실제로 바뀐 줄이 있을 때만 완료로 인정해요.
  // add를 먼저 해서 바뀐 줄 탭이 비었다면, 담아 둔 변경 탭에서 확인한 것도 같은 학습 목표로 인정해요.
  const nextAction = getNextPendingStep(state)?.doneAction;
  const creditComparison = comparison && changes.length > 0 && (
    nextAction === view.action
    || (nextAction === 'DOCUMENT_WORKING_DIFF' && mode === 'staged' && state.staged.includes(DOCUMENT_PATH))
  );
  const draft: PixelSimState = {
    ...state,
    document: { ...state.document, comparison: mode },
    completedActions: creditComparison ? withCompletedAction(state.completedActions, nextAction as LessonAction) : state.completedActions,
  };
  return finalizeTransition(
    state, draft, 'IDLE', `${view.label} 비교`, DOCUMENT_PATH, cmd, lines,
    makeBubble(
      `document-diff-${state.lastAnim.seq + 1}`,
      'buddy',
      34,
      52,
      `${view.label} 비교`,
      message,
      emptyWorkingAfterAdd ? '담아 둔 변경 탭에서 방금 담은 줄을 확인해 보세요.' : undefined,
      emptyWorkingAfterAdd
        ? [{ label: '담아 둔 변경 보기', command: DOCUMENT_COMPARISONS.staged.command, tone: 'mint' }]
        : undefined,
    ),
  );
}

function commandWords(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) => word.replace(/^(["'])(.*)\1$/, '$2'));
}

function readResetArgs(args: string[]) {
  const separator = args.indexOf('--');
  const paths = separator === -1 ? [] : args.slice(separator + 1);
  const options = separator === -1 ? args : args.slice(0, separator);
  const modes = options.filter((arg) => arg.startsWith('-'));
  const revisions = options.filter((arg) => !arg.startsWith('-'));
  const mode = modes[0] ?? '--mixed';
  if (!['--soft', '--mixed', '--hard'].includes(mode) || modes.length > 1 || revisions.length > 1) return null;
  if (paths.length > 0 && modes.length > 0) return null;
  return { mode, revision: revisions[0] ?? 'HEAD', paths };
}

export function pendingHardReset(state: PixelSimState, command: string): string | undefined {
  const [program, sub, ...args] = commandWords(command);
  if (program?.toLowerCase() !== 'git' || sub?.toLowerCase() !== 'reset') return undefined;
  const reset = readResetArgs(args);
  if (reset?.mode !== '--hard') return undefined;
  const target = resolveRevision(state, reset.revision);
  return target && `${reset.revision} (${target.hash})`;
}

export function executePixelCommand(state: PixelSimState, rawCmd: string): PixelSimState {
  const cmd = rawCmd.trim();
  if (!cmd) return state;

  const lower = cmd.toLowerCase();
  const tokens = commandWords(cmd);
  const seqNext = state.lastAnim.seq + 1;

  // ── Meta commands: reset / clear / help ──────────────────────────────────
  if (lower === 'reset') {
    const fresh = createStageState(state.stageId);
    const seq = state.lastAnim.seq + 1;
    const scenario = STAGE_MAP[state.stageId];
    return {
      ...fresh,
      lastAnim: { kind: 'IDLE', seq, label: '스테이지 초기화' },
      bubbles: [
        makeBubble(
          `reset-${seq}`,
          'buddy',
          36,
          54,
          '처음 상태로 깔끔하게 초기화했어요! 🔄',
          `${scenario.number}장 실습을 다시 시작할 준비가 됐어요.`,
          nextStepHintText(fresh),
          fresh.bubbles[0]?.actions,
        ),
      ],
      terminal: [
        makeLogEntry(seq, cmd, fresh.headBranch, [
          { text: `🔄 ${scenario.title} 상태를 초기화했어요.`, tone: 'sky' },
        ]),
      ],
    };
  }

  if (lower === 'clear' || lower === 'cls') {
    return {
      ...state,
      lastAnim: { kind: 'IDLE', seq: seqNext, label: '터미널 비우기' },
      terminal: [
        makeLogEntry(seqNext, cmd, state.headBranch, [
          { text: '터미널 기록을 깔끔하게 비웠어요.', tone: 'muted' },
        ]),
      ],
      bubbles: [
        makeBubble(
          `clear-${seqNext}`,
          'buddy',
          34,
          54,
          '터미널이 반짝반짝 깨끗해졌어요! ✨',
          '화면만 정리했을 뿐, 저장소 상태와 진행 기록은 그대로 안전해요.',
          nextStepHintText(state),
        ),
      ],
    };
  }

  if (lower === 'help' || lower === '?') {
    const scenario = STAGE_MAP[state.stageId];
    const nextStep = getNextPendingStep(state);
    const lines: TerminalLine[] = [
      { text: `📖 ${scenario.title} 추천 명령어:`, tone: 'sky' },
      ...scenario.cheatSheet.map((item) => ({
        text: `  • ${item.cmd}  —  ${item.desc}`,
        tone: 'default' as const,
      })),
      { text: '  • clear — 터미널 화면 비우기', tone: 'muted' },
      { text: '  • reset — 현재 장을 처음부터 다시 (진행 상태가 사라지니 주의)', tone: 'amber' },
    ];
    return finalizeTransition(
      state,
      state,
      'IDLE',
      '도움말 표시',
      undefined,
      cmd,
      lines,
      makeBubble(
        `help-${seqNext}`,
        'buddy',
        38,
        52,
        '명령어 치트시트를 펼쳐 드렸어요! 📖',
        '아래 추천 칩을 클릭하거나, 터미널에 바로 입력해서 실행할 수 있어요.',
        nextStepHintText(state),
        nextStep
          ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
          : undefined,
      ),
    );
  }

  if (state.document) {
    if (lower === 'edit' || lower.startsWith(`edit ${DOCUMENT_PATH}`) || lower === 'edit') {
      const current = getDocumentWorkingText(state);
      const force = tokens.includes('--force');
      // 이미 직접 쓴 내용을 확인 없이 예시로 덮어쓰지 않아요. UI의 확인 창과 같은 안전장치예요.
      if (!force && current !== ORIGINAL_DOCUMENT && current !== EXAMPLE_DOCUMENT) {
        return finalizeTransition(
          state, state, 'IDLE', '문서 덮어쓰기 확인', undefined, cmd,
          [{ text: '이미 직접 저장한 회의록 내용이 있어요. 예시로 바꾸려면 확인이 필요해요.', tone: 'amber' }],
          makeBubble(
            `docs-edit-confirm-${seqNext}`, 'buddy', 34, 54, '직접 쓴 내용을 덮어쓸까요?',
            '지금 실행하면 예시 문장으로 바뀌어요. 이전 단계로(Undo) 되돌릴 수 있지만, 먼저 확인해 주세요.',
            '예시로 바꾸려면 아래 버튼을 눌러요.',
            [{ label: '예시로 덮어쓰기', command: `edit ${DOCUMENT_PATH} --force`, tone: 'amber' }],
          ),
        );
      }
      return savePracticeDocument(state, EXAMPLE_DOCUMENT, cmd);
    }
    const sub = tokens[1]?.toLowerCase();
    const resolveConflict = state.conflict && lower.startsWith('resolve ');
    if (!resolveConflict && (tokens[0].toLowerCase() !== 'git' || !sub || !DOCUMENT_GIT_COMMANDS.has(sub))) {
      if (tokens[0].toLowerCase() === 'git' && sub) {
        const suggestion = closestCommand(sub, DOCUMENT_GIT_COMMANDS);
        if (suggestion) {
          return finalizeTransition(
            state, state, 'IDLE', '명령어 오타 안내', undefined, cmd,
            [{ text: `어라, 'git ${sub}'는 아직 모르는 말이에요. git ${suggestion}를 찾으셨나요?`, tone: 'amber' }],
            makeBubble(
              `docs-typo-${seqNext}`, 'buddy', 38, 54, '어라, 모르는 명령어예요! 🤔',
              `git ${sub}는 아직 모르는 말이에요. git ${suggestion}를 찾으셨나요? 위쪽의 노란 버튼을 누르거나 help를 입력해 보세요.`,
              undefined,
              [{ label: `git ${suggestion}`, command: `git ${suggestion}`, tone: 'primary' }],
            ),
          );
        }
      }
      return commandNotice(state, cmd, '문서 실습 명령어',
        getNextPendingStep(state)
          ? '회의록 편집과 비교에 쓰는 명령은 명령어 사전에서 확인할 수 있어요.'
          : '이 장은 모두 마쳤어요. help를 입력하거나 명령어 사전에서 사용 가능한 명령어를 확인해 보세요.');
    }
  }

  // ── Edit command ─────────────────────────────────────────────────────────
  if (lower === 'edit' || lower.startsWith('edit ')) {
    const targetName = tokens[1] ?? state.files[0]?.name ?? 'app.js';
    const working = workingTree(state);
    const previous = treeEntry(working, targetName);
    const exists = previous !== undefined;
    const content = targetName.toLowerCase().endsWith('.md')
      ? exists ? `${previous.trimEnd()}\n\n${state.stageId === 'ch4' ? '- 모임 장소는 2층 모임방으로 안내했어요.' : '- 스터디 준비 사항을 확인했어요.'} (수정 ${seqNext})\n` : `# ${targetName.slice(0, -3)}\n`
      : exists ? `${previous}\n// 수정됨 (#${seqNext})` : `// 새 파일 ${targetName}`;
    const draft = updateWorkspace(state, { ...working, [targetName]: content }, state.index);
    return finalizeTransition(
      state,
      draft,
      'EDIT',
      `${targetName} 수정`,
      targetName,
      cmd,
      [
        {
          text: exists
            ? `✏️ ${targetName} 파일을 작업 폴더에서 수정했어요.`
            : `✨ 새 파일 ${targetName} 을 작업 폴더에 만들었어요.`,
          tone: 'amber',
        },
        { text: '이제 git add .로 다음 커밋에 담아 보세요.', tone: 'muted' },
      ],
      makeBubble(
        `edit-${seqNext}`,
        'buddy',
        30,
        54,
        `${targetName} 파일을 뚝딱 고쳤어요! ✏️`,
        '작업 파일을 수정했어요. 이 변경을 기록하려면 먼저 스테이징 영역에 담으세요.',
        'git add .로 바뀐 파일을 다음 커밋에 담을 수 있어요.',
        [{ label: '다음 기록에 담기', command: 'git add .', tone: 'mint' }],
      ),
    );
  }

  // ── Conflict resolution commands: resolve ours | theirs | both ───────────
  if (lower.startsWith('resolve')) {
    const choiceRaw = (tokens[1] ?? '').toLowerCase();
    if (choiceRaw !== 'ours' && choiceRaw !== 'theirs' && choiceRaw !== 'both') {
      return finalizeTransition(
        state, state, 'IDLE', '남길 내용을 골라 주세요', undefined, cmd,
        [{ text: 'resolve 뒤에는 ours, theirs, both 중 하나를 적어 주세요. (예: resolve both)', tone: 'amber' }],
        makeBubble(
          `resolve-arg-${seqNext}`, 'buddy', 44, 52, '남길 내용을 골라 주세요',
          '내 코드(ours), 상대 코드(theirs), 둘 다(both) 중 하나를 골라야 해요.',
          'resolve both처럼 선택지를 함께 적어 주세요.',
          [
            { label: '내 코드 유지', command: 'resolve ours', tone: 'primary' },
            { label: '상대 코드 사용', command: 'resolve theirs', tone: 'amber' },
            { label: '둘 다 남기기', command: 'resolve both', tone: 'mint' },
          ],
        ),
      );
    }
    const choice: 'ours' | 'theirs' | 'both' = choiceRaw;

    if (!state.conflict) {
      return finalizeTransition(
        state,
        state,
        'IDLE',
        '충돌 없음',
        undefined,
        cmd,
        [{ text: '현재 해결해야 할 충돌(Conflict) 파일이 없어요.', tone: 'muted' }],
        makeBubble(
          `resolve-none-${seqNext}`,
          'buddy',
          38,
          54,
          '지금은 충돌이 없어요! 🙂',
          state.stageId === 'ch3'
            ? '먼저 git merge feat/ui 를 실행하면 충돌 상황을 직접 체험할 수 있어요!'
            : '모든 파일이 평화로운 상태예요.',
          nextStepHintText(state),
          state.stageId === 'ch3'
            ? [{ label: '두 버전 합치기', command: 'git merge feat/ui', tone: 'amber' }]
            : undefined,
        ),
      );
    }

    const resolvedContent =
      choice === 'ours'
        ? state.conflict.oursCode
        : choice === 'theirs'
          ? state.conflict.theirsCode
          : state.conflict.bothCode;

    const choiceLabel =
      choice === 'ours'
        ? '내 코드(ours) 유지'
        : choice === 'theirs'
          ? '상대 코드(theirs) 채택'
          : '둘 다 합치기(both)';

    const conflictFile = state.conflict.file;
    const finish = state.conflict.revert ? 'git revert --continue' : 'git commit';
    const working = { ...workingTree(state) };
    const index = { ...state.index };
    const deleted = (choice === 'ours' && state.conflict.oursDeleted) || (choice === 'theirs' && state.conflict.theirsDeleted);
    writeTreeEntry(working, conflictFile, deleted ? undefined : resolvedContent);
    writeTreeEntry(index, conflictFile, deleted ? undefined : resolvedContent);
    const draft = updateWorkspace({
      ...state,
      conflict: { ...state.conflict, resolvedChoice: choice },
    }, working, index);

    return finalizeTransition(
      state,
      draft,
      'RESOLVE',
      `충돌 해결 (${choice})`,
      choiceLabel,
      cmd,
      [
        { text: `🧩 ${conflictFile} 충돌 해결: ${choiceLabel}`, tone: 'mint' },
        { text: `✓ 해결된 ${conflictFile}${objectParticle(conflictFile)} 스테이징 영역에 담았어요.`, tone: 'sky' },
        { text: `${finish}로 해결한 내용을 기록하세요.`, tone: 'muted' },
      ],
      makeBubble(
        `resolve-${seqNext}`,
        'buddy',
        46,
        52,
        `충돌 해결 완료! (${choiceLabel}) 🧩`,
        `${conflictFile}에서 선택한 내용을 남기고 스테이징했어요. 실제 Git에서는 파일을 직접 수정해 충돌 표시를 지운 뒤 git add로 해결을 표시해요.`,
        `${finish}로 기록을 마무리하세요.`,
        [{ label: '해결한 내용 기록하기', command: finish, tone: 'mint' }],
      ),
    );
  }

  // ── Token security commands (Ch6) ────────────────────────────────────────
  if (lower.startsWith('token ')) {
    const sub = (tokens[1] ?? '').toLowerCase();

    if (sub === 'classic') {
      const alreadyDone = state.completedActions.includes('TOKEN_SSH');
      const nextToken: TokenWorldState = {
        ...state.token,
        mode: 'classic',
        scopes: ['repo', 'admin:org', 'delete_repo', 'workflow'],
        riskScore: 88,
        pushBlockedDemo: false,
        expires: undefined,
      };
      const draft: PixelSimState = { ...state, token: nextToken };
      return finalizeTransition(
        state,
        draft,
        'TOKEN_CLASSIC',
        '권한이 넓은 예제 토큰',
        'ghp_***',
        cmd,
        [
          { text: '예제 classic 토큰의 범위 · repo, admin:org, delete_repo, workflow', tone: 'coral' },
          { text: '계정에 권한이 있는 여러 저장소를 수정하거나 삭제할 수 있는 설정이에요.', tone: 'amber' },
        ],
        makeBubble(
          `token-classic-${seqNext}`,
          'guard',
          56,
          48,
          '이 토큰에는 삭제 권한도 있어요',
          alreadyDone
            ? '실습은 마쳤지만 지금 토큰은 다시 넓은 권한 상태예요. token fine으로 최소 권한을 복원할 수 있어요.'
            : '이 예제 토큰에는 delete_repo 범위를 선택했어요. 실제로 할 수 있는 일은 계정의 권한과 토큰에 부여한 범위에 따라 달라져요.',
          alreadyDone
            ? 'token fine으로 안전한 최소 권한 상태로 되돌려 보세요.'
            : 'token fine으로 Fine-Grained 최소 권한 토큰으로 교체해 보세요.',
          alreadyDone
            ? [{ label: '최소 권한으로 복원', command: 'token fine', tone: 'mint' }]
            : [{ label: '필요한 권한만 주기', command: 'token fine', tone: 'mint' }],
        ),
      );
    }

    if (sub === 'fine' || sub === 'fine-grained') {
      const nextToken: TokenWorldState = {
        ...state.token,
        mode: 'fine-grained',
        scopes: ['contents:write (gitdots/app)'],
        expires: '30일 뒤',
        riskScore: state.token.ssoAuthorized ? 12 : 22,
        pushBlockedDemo: false,
      };
      const draft: PixelSimState = { ...state, token: nextToken };
      return finalizeTransition(
        state,
        draft,
        'TOKEN_FINE',
        'Fine-Grained 최소 권한',
        'github_pat_***',
        cmd,
        [
          { text: '✨ Fine-Grained PAT (github_pat_7mQ1...): gitdots/app 1개만 허용', tone: 'mint' },
          { text: `예제 설정 · Contents 쓰기 권한, 만료까지 30일`, tone: 'sky' },
        ],
        makeBubble(
          `token-fine-${seqNext}`,
          'guard',
          56,
          48,
          '딱 필요한 권한만! Fine-Grained ✨',
          '예제 토큰은 gitdots/app에만 내용을 쓸 수 있고 30일 뒤에 만료돼요. 다른 저장소의 권한은 따로 부여해야 해요.',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'TOKEN_FINE') }),
          !state.token.ssoAuthorized
            ? [{ label: '회사 계정 인증하기', command: 'token sso', tone: 'primary' }]
            : undefined,
        ),
      );
    }

    if (sub === 'sso') {
      const nextToken: TokenWorldState = {
        ...state.token,
        ssoAuthorized: true,
        riskScore: Math.max(8, state.token.riskScore - 10),
        pushBlockedDemo: false,
      };
      const draft: PixelSimState = { ...state, token: nextToken };
      return finalizeTransition(
        state,
        draft,
        'TOKEN_SSO',
        '회사 계정 인증 완료',
        'SSO OK',
        cmd,
        [
          { text: '🏢 조직의 SAML(회사 통합 로그인 방식)로 신원을 확인했어요.', tone: 'mint' },
          { text: `예제 조직에서 회사 계정의 신원을 확인했어요.`, tone: 'sky' },
        ],
        makeBubble(
          `token-sso-${seqNext}`,
          'guard',
          56,
          48,
          '회사 계정으로 신원을 확인했어요',
          `회사 통합 로그인(SSO)을 쓰는 조직에서는 회사 계정과 GitHub 계정을 연결해요. ${state.token.mode === 'classic' ? '지금은 classic 토큰이라 먼저 token fine으로 최소 권한 토큰을 만든 뒤 조직 인증을 붙이는 흐름이에요.' : 'Fine-grained 토큰의 조직 인증은 토큰을 만들 때 이뤄져요.'}`,
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'TOKEN_SSO') }),
          !state.token.sshReady
            ? [{ label: 'SSH 공개키 등록하기', command: 'token ssh', tone: 'mint' }]
            : undefined,
        ),
      );
    }

    if (sub === 'ssh') {
      const nextToken: TokenWorldState = {
        ...state.token,
        sshReady: true,
        riskScore: Math.max(5, state.token.riskScore - 7),
        pushBlockedDemo: false,
      };
      const draft: PixelSimState = { ...state, token: nextToken };
      return finalizeTransition(
        state,
        draft,
        'TOKEN_SSH',
        'SSH 키 인증 준비',
        'ed25519',
        cmd,
        [
          { text: '🔐 ssh-ed25519(암호화 열쇠 종류) 키 쌍 생성 & GitHub 공개키 등록 완료!', tone: 'mint' },
          { text: 'Hi dot-dev! (SSH 키 인증 성공) 개인키는 내 컴퓨터에, 공개키는 GitHub에 있어요.', tone: 'sky' },
        ],
        makeBubble(
          `token-ssh-${seqNext}`,
          'guard',
          56,
          48,
          'SSH 암호화 열쇠 짝꿍 완성! 🔐',
          '개인키는 내 컴퓨터에만 두고 공개키만 GitHub에 등록해서 비밀번호 없이도 안전하게 연결해요!',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'TOKEN_SSH') }),
        ),
      );
    }

    if (sub === 'leak-test' || sub === 'leak') {
      const nextToken: TokenWorldState = {
        ...state.token,
        pushBlockedDemo: true,
      };
      const draft: PixelSimState = { ...state, token: nextToken };
      return finalizeTransition(
        state,
        draft,
        'TOKEN_BLOCK',
        '비밀 정보 유출 방지 기능이 차단',
        'SECRET_BLOCKED',
        cmd,
        [
          { text: 'remote: error: GH013: Repository rule violations found! (저장소 보안 규칙 위반으로 전송 차단)', tone: 'coral' },
          { text: 'remote: - GITHUB PUSH PROTECTION: .env.example에서 GitHub Personal Access Token(ghp_***) 감지됨', tone: 'coral' },
          { text: '🛡️ 토큰(비밀 정보)이 외부에 올라가기 직전에 자동으로 막았어요!', tone: 'mint' },
        ],
        makeBubble(
          `token-leak-${seqNext}`,
          'guard',
          56,
          48,
          '푸시에서 토큰이 감지됐어요',
          '이 저장소는 푸시 보호를 켜 두었어요. .env.example에 들어 있던 ghp_로 시작하는 토큰 패턴을 감지해 푸시를 차단했어요. 이제 git push를 다시 해 보면 실제로 막히는 걸 확인할 수 있어요.',
          nextStepHintText(draft),
        ),
      );
    }
  }

  // ── GHES commands (Ch7) ──────────────────────────────────────────────────
  if (lower.startsWith('ghes ')) {
    const sub = (tokens[1] ?? '').toLowerCase();

    if (sub === 'test-public' || sub === 'block') {
      const nextGhes: GhesWorldState = {
        ...state.ghes,
        mode: 'ghes',
        lastFlow: 'blocked',
        auditLogs: [
          ...state.ghes.auditLogs.slice(-5),
          '[BLOCK] github.com:443 외부 전송 차단 (사내 방화벽)',
        ],
      };
      const draft: PixelSimState = {
        ...state,
        ghes: nextGhes,
        completedActions: withCompletedAction(state.completedActions, 'FIREWALL_TEST'),
      };
      return finalizeTransition(
        state,
        draft,
        'GHES_BLOCK',
        '외부 클라우드 차단',
        'FIREWALL',
        cmd,
        [
          { text: 'git push https://github.com/corp/payroll-core → 연결 차단 (사내 보안 프록시가 외부 전송을 막음)', tone: 'coral' },
          { text: '🧱 사내 보안 정책에 따라 외부 github.com으로의 코드 전송이 차단됐어요.', tone: 'amber' },
        ],
        makeBubble(
          `ghes-block-${seqNext}`,
          'guard',
          52,
          48,
          '외부 전송 철벽 차단! 🧱',
          '회사 대외비 코드는 바깥 github.com으로 못 나가요. 대신 사내 전용 GHES 서버에 VPN으로 접속해야 해요!',
          state.ghes.connected
            ? '이미 사내 서버에 로그인했어요. 다음은 내 계정 정보를 조회해 보세요.'
            : 'gh auth login --hostname github.corp.internal로 사내 서버에 로그인해 보세요.',
          [
            state.ghes.connected
              ? { label: '내 계정 정보 보기', command: 'gh api user --hostname github.corp.internal', tone: 'primary' }
              : {
                label: '사내 서버 로그인',
                command: 'gh auth login --hostname github.corp.internal',
                tone: 'primary',
              },
          ],
        ),
      );
    }

    if (sub === 'runner') {
      if (!state.ghes.connected) {
        return finalizeTransition(
          state, state, 'IDLE', '사내 로그인 필요', undefined, cmd,
          [{ text: '사내 실행기 빌드는 사내 GitHub 로그인을 마친 뒤에 돌릴 수 있어요.', tone: 'amber' }],
          makeBubble(
            `ghes-runner-gate-${seqNext}`, 'guard', 54, 48, '먼저 사내 서버에 로그인해 주세요 🔒',
            '사내 실행기는 회사 내부 인증을 마친 사용자만 사용할 수 있어요.',
            'gh auth login --hostname github.corp.internal로 로그인해 보세요.',
            [{ label: '사내 서버 로그인', command: 'gh auth login --hostname github.corp.internal', tone: 'primary' }],
          ),
        );
      }
      const nextGhes: GhesWorldState = {
        ...state.ghes,
        mode: 'ghes',
        lastFlow: 'runner',
        auditLogs: [
          ...state.ghes.auditLogs.slice(-5),
          '[CI] Self-Hosted Private Runner 빌드·테스트 통과 ✓',
        ],
      };
      const draft: PixelSimState = { ...state, ghes: nextGhes };
      return finalizeTransition(
        state,
        draft,
        'GHES_RUNNER',
        '사내 실행기로 빌드',
        'corp-runner-01',
        cmd,
        [
          { text: '⚙️ Job assigned to [self-hosted, linux, corp-private-01] (사내 전용 실행기에 빌드 배정)', tone: 'sky' },
          { text: '✓ 사내망 안에서 빌드·보안 검사 통과 (외부 전송 0바이트)', tone: 'mint' },
          { text: '빌드 대상: payroll-core.ts 최근 커밋 (사내 저장소)', tone: 'muted' },
        ],
        makeBubble(
          `ghes-runner-${seqNext}`,
          'guard',
          68,
          48,
          '사내에서 자동 빌드와 테스트를 마쳤어요',
          '이 예제에서는 사내 실행기가 회사 서버 안에서 payroll-core.ts의 최근 커밋을 빌드·테스트했어요.',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'GHES_RUNNER') }),
        ),
      );
    }

    if (sub === 'cloud') {
      const toggledMode = state.ghes.mode === 'cloud' ? 'ghes' : 'cloud';
      const nextGhes: GhesWorldState = {
        ...state.ghes,
        mode: toggledMode,
        auditLogs: [
          ...state.ghes.auditLogs.slice(-5),
          toggledMode === 'cloud'
            ? '[VIEW] GitHub.com 클라우드 아키텍처 비교 보기'
            : '[VIEW] 사내 GHES 폐쇄망 모드로 복귀',
        ],
      };
      const draft: PixelSimState = { ...state, ghes: nextGhes };
      return finalizeTransition(
        state,
        draft,
        'GH_CMD',
        toggledMode === 'cloud' ? 'Cloud 비교 보기' : 'GHES 모드 복귀',
        toggledMode,
        cmd,
        [
          { text: '☁️ GitHub.com (Cloud)  vs  🏢 GHES (사내 설치형)', tone: 'sky' },
          { text: '  • 주소: github.com        vs  github.corp.internal', tone: 'default' },
          { text: '  • API : api.github.com    vs  /api/v3', tone: 'default' },
          { text: '  • CI  : GitHub-hosted runner  vs  사내 Private Runner', tone: 'default' },
          { text: toggledMode === 'cloud' ? '지금은 비교를 위해 클라우드 관점을 보여 주고 있어요. 화면 왼쪽 공용 구역이 강조돼요.' : '다시 사내 GHES 관점으로 돌아왔어요. 오른쪽 사내 성이 기준이에요.', tone: 'muted' },
        ],
        makeBubble(
          `ghes-cloud-${seqNext}`,
          'cloud',
          66,
          48,
          toggledMode === 'cloud' ? '클라우드 vs 사내 GHES 비교! ☁️' : '다시 사내 GHES 모드로! 🏢',
          'GitHub.com은 누구나 쓰는 공용 클라우드고, GHES는 우리 회사 방화벽 안에 직접 설치해 쓰는 전용 서버예요!',
          nextStepHintText(draft),
        ),
      );
    }
  }

  // ── AI Agent commands (Ch8) ──────────────────────────────────────────────
  if (lower.startsWith('ai ')) {
    const sub = (tokens[1] ?? '').toLowerCase();

    if (sub === 'code') {
      if (!state.ai.worktreeActive) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '별도 작업 폴더 필요',
          undefined,
          cmd,
          [
            { text: '⚠️ AI가 main 폴더를 직접 수정하지 않도록 worktree가 먼저 필요해요!', tone: 'amber' },
          ],
          makeBubble(
            `ai-need-wt-${seqNext}`,
            'ai',
            66,
            52,
            '잠깐! AI 작업 폴더부터 만들어 주세요 🏗️',
            '사람이 쓰는 main 작업 폴더를 바로 건드리면 충돌이 날 수 있어요. 독립된 worktree 공간을 먼저 열어 주세요!',
            'git worktree add -b ai/fix wt-ai를 실행해 보세요.',
            [
              {
                label: 'AI 작업 폴더 만들기',
                command: 'git worktree add -b ai/fix wt-ai',
                tone: 'mint',
              },
            ],
          ),
        );
      }

      const aiBranch = state.ai.worktreeBranch;
      if (state.ai.codeWritten) {
        return commandNotice(state, cmd, '이미 코드를 고쳤어요', '같은 수정이 두 번 쌓이지 않도록 새 커밋은 만들지 않았어요. 테스트도 통과했으니 다음 단계로 가요.', 'mint');
      }
      const parentId = state.branches[aiBranch] ?? state.branches[state.headBranch] ?? 'c1';
      const newCommitId = `c${state.commits.length + 1}`;
      const newCommit: PixelCommit = {
        id: newCommitId,
        hash: makeHash(seqNext, 'ai-code'),
        message: 'fix: sum 연산자 버그 수정 (by AI)',
        branch: aiBranch,
        parents: [parentId],
        tree: { ...commitById(state, parentId)?.tree, 'buggy.ts': 'export const sum = (a: number, b: number) => a + b;' },
      };

      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, newCommit],
        branches: { ...state.branches, [aiBranch]: newCommitId },
        ai: { ...state.ai, codeWritten: true },
      };

      return finalizeTransition(
        state,
        draft,
        'AI_CODE',
        'AI 코드 수정·커밋',
        newCommit.hash,
        cmd,
        [
          { text: `🤖 [${state.ai.worktreeDir ?? 'wt-ai'} @ ${aiBranch}] buggy.ts 수정: a - b → a + b`, tone: 'mint' },
          { text: `✓ unit test: sum(2, 3) === 5 PASS (단위 테스트 통과)`, tone: 'mint' },
          { text: `[${aiBranch} ${newCommit.hash}] ${newCommit.message}`, tone: 'sky' },
        ],
        makeBubble(
          `ai-code-${seqNext}`,
          'ai',
          66,
          52,
          'AI 작업 폴더에서 덧셈을 고쳤어요',
          'wt-ai 폴더 안에서만 코드를 고치고 테스트까지 통과했어요. 이제 main에 바로 푸시하면 어떻게 될까요?',
          'ai push-main 을 실행해서 브랜치 보호 가드레일을 시험해 보세요!',
          [{ label: '직접 공유 제한 확인하기', command: 'ai push-main', tone: 'coral' }],
        ),
      );
    }

    if (sub === 'push-main' || sub === 'push') {
      const draft: PixelSimState = {
        ...state,
        ai: { ...state.ai, mainPushBlocked: true },
      };
      return finalizeTransition(
        state,
        draft,
        'AI_BLOCK_MAIN',
        'main 직접 푸시 차단',
        'BRANCH_PROTECTION',
        cmd,
        [
          { text: 'git push origin main (by ai-bot)', tone: 'muted' },
          { text: 'remote: error: GH006: Protected branch update failed for refs/heads/main. (보호된 main 브랜치 직접 수정 거부)', tone: 'coral' },
          { text: '브랜치 보호 규칙으로 기본 브랜치(main)에 직접 올리는 변경을 막았어요.', tone: 'amber' },
          ...(state.ai.codeWritten ? [] : [{ text: '아직 AI가 만든 변경은 없지만, 보호 규칙은 이렇게 동작해요.', tone: 'muted' as const }]),
        ],
        makeBubble(
          `ai-block-${seqNext}`,
          'guard',
          52,
          48,
          '스톱! main 직접 푸시 차단! 🛑',
          state.ai.codeWritten
            ? '브랜치 보호 규칙이 직접 공유를 막았어요. 변경을 제안하려면 PR을 여세요.'
            : '아직 올릴 변경은 없지만, main은 보호 규칙 때문에 직접 push할 수 없어요. 변경을 제안하려면 PR을 열어요.',
          'ai pr로 초안 PR을 열고 자동 테스트 결과를 확인해 보세요.',
          [{ label: '검토 초안과 테스트 확인', command: 'ai pr', tone: 'primary' }],
        ),
      );
    }

    if (sub === 'pr') {
      if (!state.ai.worktreeActive || !state.ai.codeWritten) {
        return finalizeTransition(
          state, state, 'IDLE', 'AI 코드 수정 필요', undefined, cmd,
          [{ text: '검토할 변경이 없어요. 먼저 AI 작업 폴더에서 버그를 고쳐 주세요.', tone: 'amber' }],
          makeBubble(
            `ai-need-code-${seqNext}`, 'ai', 66, 52, '먼저 AI가 코드를 고쳐야 해요 🤖',
            '코드 수정 없이 PR만 열면 빈 검토 요청이 돼요. worktree에서 버그를 고치고 테스트를 통과한 뒤 PR을 열어요.',
            'ai code로 덧셈 버그를 먼저 고쳐 주세요.',
            [{ label: '덧셈 오류 고치기', command: 'ai code', tone: 'mint' }],
          ),
        );
      }
      const nextNum =
        state.prs.reduce((max, p) => Math.max(max, p.number), 0) + 1;
      const aiBranch = state.ai.worktreeBranch;
      const newPr: PixelPr = {
        number: nextNum,
        title: '[AI] 덧셈 연산자 버그 수정',
        body: 'AI가 worktree에서 a - b를 a + b로 고쳤고, 단위 테스트가 통과했어요. 사람이 변경을 확인해 주세요.',
        headBranch: aiBranch,
        baseBranch: 'main',
        status: 'draft',
        ci: 'pass',
        approved: false,
      };
      const aiHead = state.branches[aiBranch] ?? state.branches.main ?? 'c1';
      const draft: PixelSimState = {
        ...state,
        prs: [...state.prs, newPr],
        remoteBranches: { ...state.remoteBranches, [aiBranch]: aiHead },
        ai: { ...state.ai, prNumber: nextNum },
      };

      return finalizeTransition(
        state,
        draft,
        'AI_PR',
        `초안 PR #${nextNum} 자동 테스트 통과`,
        `#${nextNum}`,
        cmd,
        [
          { text: `초안 PR #${nextNum} 생성 "${newPr.title}" (${aiBranch} → main)`, tone: 'sky' },
          { text: '✅ GitHub Actions CI: 코드 형식(Lint) · 단위 테스트(Unit Test) · 비밀키 검사(Secret Scan) 모두 통과!', tone: 'mint' },
          { text: '이 실습에서는 자동 검사가 바로 통과한 것으로 보여 줘요.', tone: 'muted' },
          { text: '👤 사람 리뷰어의 최종 승인을 기다리고 있어요...', tone: 'amber' },
        ],
        makeBubble(
          `ai-pr-${seqNext}`,
          'ai',
          66,
          52,
          `초안 PR #${nextNum}의 자동 테스트가 통과했어요`,
          '자동 테스트를 모두 통과했어요! 초안 PR이라 바로 합칠 수 없으니, 먼저 검토 준비로 전환한 뒤 사람의 승인을 받아요.',
          nextStepHintText(draft),
          [{ label: '검토 준비로 전환하기', command: 'ai ready', tone: 'primary' }],
        ),
      );
    }

    if (sub === 'ready') {
      if (state.ai.prNumber === null) {
        return commandNotice(state, cmd, '먼저 초안 PR이 필요해요', 'ai pr로 초안 PR을 연 뒤에 검토 준비로 전환할 수 있어요.', 'amber');
      }
      const prNum = state.ai.prNumber;
      const targetPr = state.prs.find((p) => p.number === prNum);
      if (!targetPr || targetPr.status !== 'draft') {
        return commandNotice(state, cmd, '이미 검토 준비 상태예요', '초안 PR이 아니에요. 바로 승인하고 합칠 수 있어요.');
      }
      const draft: PixelSimState = {
        ...state,
        prs: state.prs.map((p) => (p.number === prNum ? { ...p, status: 'open' } : p)),
        completedActions: withCompletedAction(state.completedActions, 'AI_READY'),
      };
      return finalizeTransition(
        state,
        draft,
        'GH_CMD',
        `PR #${prNum} 검토 준비로 전환`,
        `#${prNum}`,
        cmd,
        [{ text: `초안 PR #${prNum}을 검토 준비(Ready for review) 상태로 전환했어요.`, tone: 'mint' }],
        makeBubble(
          `ai-ready-${seqNext}`,
          'ai',
          66,
          52,
          `PR #${prNum}을 검토 준비로 전환했어요`,
          '초안 PR은 바로 합칠 수 없어요. 검토 준비로 전환해야 리뷰어가 승인하고 합칠 수 있어요. 이제 변경을 확인하고 승인해 주세요.',
          nextStepHintText(draft),
          [{ label: '승인하고 합치기', command: 'ai approve', tone: 'mint' }],
        ),
      );
    }

    if (sub === 'approve') {
      if (state.ai.prNumber === null) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          'PR 먼저 필요',
          undefined,
          cmd,
          [{ text: '승인할 AI PR이 아직 없어요. ai pr로 초안 PR을 열어 주세요.', tone: 'amber' }],
          makeBubble(
            `ai-need-pr-${seqNext}`,
            'ai',
            66,
            52,
            '먼저 초안 PR을 열어 주세요',
            '아직 리뷰할 PR이 없어요. ai pr 명령어로 PR과 자동 테스트를 먼저 실행해 볼까요?',
            'ai pr로 초안 PR을 만들어 보세요.',
            [{ label: '검토 초안과 테스트 확인', command: 'ai pr', tone: 'primary' }],
          ),
        );
      }

      const prNum = state.ai.prNumber;
      const targetPr = state.prs.find((p) => p.number === prNum);
      if (state.ai.merged || targetPr?.status === 'merged') {
        return commandNotice(state, cmd, '이미 병합 완료됨',
          '이 PR은 이미 main에 합쳐졌어요. 다시 연습하려면 초기화 버튼을 눌러 주세요.', 'mint');
      }
      if (targetPr?.status === 'draft') {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '초안 PR은 바로 합칠 수 없어요',
          undefined,
          cmd,
          [{ text: '초안 PR은 검토 준비로 전환해야 합칠 수 있어요. ai ready를 먼저 실행하세요.', tone: 'amber' }],
          makeBubble(
            `ai-need-ready-${seqNext}`,
            'ai',
            66,
            52,
            '초안 PR은 바로 합칠 수 없어요',
            '초안 PR은 아직 검토 준비가 안 됐어요. 먼저 검토 준비로 전환한 뒤 승인하고 합쳐 주세요.',
            'ai ready 명령을 실행해 보세요.',
            [{ label: '검토 준비로 전환하기', command: 'ai ready', tone: 'primary' }],
          ),
        );
      }
      const aiBranch = state.ai.worktreeBranch;
      const mainHead = state.remoteBranches.main ?? state.branches.main ?? 'c1';
      const aiHead = state.branches[aiBranch] ?? mainHead;
      if (aiHead === mainHead) {
        return commandNotice(state, cmd, '합칠 변경이 없어요',
          'AI 브랜치가 main과 같은 커밋이라 PR에 담긴 변경이 없어요. 먼저 ai code로 코드를 고쳐 주세요.', 'amber');
      }
      const result = mergeTrees(
        mergeBase(state, mainHead, aiHead)?.tree ?? {},
        commitById(state, mainHead)?.tree ?? {},
        commitById(state, aiHead)?.tree ?? {},
      );
      if (result.conflicts.length > 0) {
        return commandNotice(state, cmd, 'PR에 충돌이 있어요', `${result.conflicts.join(', ')}의 변경을 확인하세요.`, 'amber');
      }
      if (changedPaths(commitById(state, mainHead)?.tree ?? {}, result.tree).length === 0) {
        return commandNotice(state, cmd, '합칠 변경이 없어요',
          'AI 수정 내용이 main에 이미 들어 있어 새로 합칠 변경이 없어요.', 'amber');
      }
      const mergeId = `c${state.commits.length + 1}`;
      const mergeCommit: PixelCommit = {
        id: mergeId,
        hash: makeHash(seqNext, `merge-pr-${prNum}`),
        message: `Merge PR #${prNum}: [AI] 덧셈 연산자 버그 수정`,
        branch: 'main',
        parents: aiHead !== mainHead ? [mainHead, aiHead] : [mainHead],
        tree: result.tree,
        isMerge: true,
      };

      const nextPrs: PixelPr[] = state.prs.map((p) =>
        p.number === prNum ? { ...p, status: 'merged', approved: true, ci: 'pass' } : p,
      );

      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, mergeCommit],
        remoteBranches: { ...state.remoteBranches, main: mergeId },
        prs: nextPrs,
        ai: { ...state.ai, humanApproved: true, merged: true },
      };

      return finalizeTransition(
        state,
        draft,
        'AI_APPROVE',
        `사람 승인 후 PR #${prNum} 합치기`,
        'HITL_MERGED',
        cmd,
        [
          { text: '🔍 변경 확인: buggy.ts  a - b → a + b (2+3을 -1에서 5로 고침)', tone: 'sky' },
          { text: `👤 Reviewed & Approved by @${state.ghUser} (사람이 직접 확인하는 절차, Human-in-the-Loop)`, tone: 'mint' },
          { text: `🎉 PR #${prNum} 이 GitHub의 기본 브랜치(main)에 합쳐졌어요. (${mergeCommit.hash})`, tone: 'mint' },
          { text: '내 컴퓨터의 main은 아직 옛 코드예요. 4장에서 배운 git pull origin main으로 가져올 수 있어요.', tone: 'muted' },
        ],
        makeBubble(
          `ai-approve-${seqNext}`,
          'ai',
          64,
          50,
          '사람이 승인한 변경을 합쳤어요',
          '리뷰어(팀원) 역할로 덧셈 수정과 테스트 결과를 확인하고 승인했어요. 작성자(AI)와 다른 사람이 승인해야 main에 들어갈 수 있어요. GitHub의 main에 합쳐졌고, 내 컴퓨터의 main은 git pull로 가져올 수 있어요.',
          'AI 협업 실습을 마쳤어요. 상단에서 다시 연습할 장을 고를 수 있어요.',
        ),
      );
    }
  }

  // ── Git commands ─────────────────────────────────────────────────────────
  if (tokens[0]?.toLowerCase() === 'git') {
    const sub = (tokens[1] ?? '').toLowerCase();

    // git status
    if (sub === 'status') {
      const stagedFiles = state.staged;
      const modifiedFiles = state.files.filter((f) => f.status === 'modified');
      const untrackedFiles = state.files.filter((f) => f.status === 'untracked');
      const conflictFiles = state.files.filter((f) => f.status === 'conflict');

      // 작업 폴더와 브랜치 표시를 일치시켜요. worktree는 별도 줄로만 알려 줘요.
      const statusBranch = state.headBranch;
      const relation = remoteRelation(state, statusBranch);
      const aheadCount = relation === 'ahead' ? aheadCommitCount(state, statusBranch) : 0;
      const lines: TerminalLine[] = [
        { text: `On branch ${statusBranch} (현재 ${statusBranch} 브랜치에 있어요)`, tone: 'sky' },
      ];
      if (state.stageId === 'ch8' && state.ai.worktreeActive) {
        lines.push({ text: `작업 폴더: ${state.ai.worktreeDir ?? 'wt-ai'} (브랜치 ${state.ai.worktreeBranch})`, tone: 'lavender' });
      }
      if (conflictFiles.length > 0) {
        lines.push({
          text: `⚡ 충돌 파일: ${conflictFiles.map((f) => f.name).join(', ')}`,
          tone: 'coral',
        });
      }
      if (stagedFiles.length > 0) {
        lines.push({
          text: `스테이징(Staged): ${stagedFiles.join(', ')}`,
          tone: 'mint',
        });
      }
      if (modifiedFiles.length > 0) {
        lines.push({
          text: `✏️ 수정됨(Modified): ${modifiedFiles.map((f) => f.name).join(', ')}`,
          tone: 'amber',
        });
      }
      if (untrackedFiles.length > 0) {
        lines.push({
          text: `🆕 새 파일(Untracked): ${untrackedFiles.map((f) => f.name).join(', ')}`,
          tone: 'coral',
        });
      }
      if (
        conflictFiles.length === 0 &&
        stagedFiles.length === 0 &&
        modifiedFiles.length === 0 &&
        untrackedFiles.length === 0
      ) {
        lines.push({ text: '커밋할 변경이 없어요 (nothing to commit, working tree clean — 작업 폴더가 깨끗해요)', tone: 'mint' });
      }
      if (relation === 'ahead') {
        lines.push({ text: `공유 대기 · 내 컴퓨터에만 있는 커밋이 ${aheadCount}개 있어요 (git push로 팀에 올려요)`, tone: 'amber' });
      } else if (relation === 'behind') {
        lines.push({ text: '원격이 앞섬 · 팀 저장소에 내 기록에 없는 커밋이 있어요 (git pull로 가져와요)', tone: 'amber' });
      } else if (relation === 'diverged') {
        lines.push({ text: '갈라진 기록 · 내 컴퓨터와 팀 저장소에 서로 다른 커밋이 있어요', tone: 'amber' });
      }

      const statusSummary =
        conflictFiles.length > 0
          ? `충돌 난 파일이 ${conflictFiles.length}개 있어요! 먼저 해결해 볼까요?`
          : stagedFiles.length > 0
            ? `스테이징 영역에 ${stagedFiles.length}개 파일이 담겨 있어요. 이제 기록을 남길 차례예요.`
            : modifiedFiles.length + untrackedFiles.length > 0
              ? `아직 스테이징하지 않은 파일이 ${modifiedFiles.length + untrackedFiles.length}개 있어요.`
              : relation === 'ahead'
                ? `작업 폴더는 깨끗하지만, 아직 팀에 공유하지 않은 커밋이 ${aheadCount}개 있어요. git push로 올려 보세요.`
                : '커밋할 변경이 없어요.';

      return finalizeTransition(
        state,
        state,
        'IDLE',
        '상태 확인',
        state.headBranch,
        cmd,
        lines,
        makeBubble(
          `status-${seqNext}`,
          'buddy',
          32,
          54,
          '현재 파일의 변경 상태예요',
          statusSummary,
          nextStepHintText(state),
        ),
      );
    }

    // git add
    if (sub === 'add') {
      const args = tokens.slice(2).filter((arg) => arg !== '--');
      const working = workingTree(state);
      const paths = [...new Set([...Object.keys(working), ...Object.keys(state.index)])];
      const matches = new Set<string>();
      for (const arg of args) {
        const target = arg === './' ? '.' : arg.replace(/^\.\//, '').replace(/\/$/, '');
        const selected = target === '-u' || target === '--update'
          ? Object.keys(state.index)
          : paths.filter((path) => target === '.' || target === '-A' || target === '--all'
            || path === target || path.startsWith(target + '/'));
        if (selected.length === 0 && target !== '.' && target !== '-A' && target !== '--all') {
          return commandNotice(state, cmd, '파일 경로를 확인해 주세요', `${arg} 경로와 일치하는 파일이 없어요.`, 'amber');
        }
        selected.forEach((path) => matches.add(path));
      }
      if (args.length === 0) {
        return commandNotice(state, cmd, '파일 이름을 적어 주세요', 'git add 뒤에 파일 이름이나 현재 폴더를 뜻하는 점(.)을 적으세요.', 'amber');
      }

      const index = { ...state.index };
      for (const path of matches) writeTreeEntry(index, path, treeEntry(working, path));
      const conflict = state.conflict;
      if (conflict?.resolvedChoice === 'none' && matches.has(conflict.file)) {
        const workingContent = treeEntry(working, conflict.file);
        if (hasMergeMarker(workingContent)) {
          return finalizeTransition(
            state, state, 'IDLE', '충돌 표시가 남아 있어요', undefined, cmd,
            [
              { text: '⚠️ 파일에 <<<<<<< / ======= / >>>>>>> 충돌 표시가 아직 남아 있어요.', tone: 'amber' },
              { text: '남길 내용을 고르거나 편집기에서 표시를 지운 뒤 다시 담아 주세요.', tone: 'muted' },
            ],
            makeBubble(
              `add-conflict-marker-${seqNext}`, 'buddy', 44, 52, '충돌 표시를 먼저 정리해 주세요 ⚡',
              '지금 담으면 충돌 표시가 그대로 커밋돼요. 아래 비교 카드에서 남길 내용을 골라 주세요.',
              '내 코드·상대 코드·둘 다 중 하나를 고르면 표시가 사라져요.',
              [
                { label: '내 코드 유지', command: 'resolve ours', tone: 'primary' },
                { label: '상대 코드 사용', command: 'resolve theirs', tone: 'amber' },
                { label: '둘 다 남기기', command: 'resolve both', tone: 'mint' },
              ],
            ),
          );
        }
        const draft = updateWorkspace({ ...state, conflict: { ...conflict, resolvedChoice: 'manual' } }, working, index);
        return finalizeTransition(
          state, draft, 'RESOLVE', '충돌 해결 스테이징', conflict.file, cmd,
          [{ text: `${conflict.file}의 현재 작업 파일을 해결 결과로 담았어요.`, tone: 'mint' }],
          makeBubble(`add-resolved-${seqNext}`, 'buddy', 38, 54, '해결한 파일을 담았어요',
            conflict.revert ? 'git revert --continue로 취소 커밋의 기록을 마무리하세요.' : 'git commit으로 합친 결과를 기록하세요.'),
        );
      }

      const draft = updateWorkspace(state, working, index);
      const indexChanged = changedPaths(state.index, index).length > 0;
      if (!indexChanged) {
        const message = draft.staged.length > 0
          ? '현재 문서와 스테이징 영역의 내용이 이미 같아요. 고친 내용이 사라진 게 아니라 똑같이 담겨 있어요.'
          : '다음 커밋에 들어갈 변경이 없어요.';
        return finalizeTransition(
          state, state, 'IDLE', '스테이징 영역 확인', undefined, cmd,
          [{ text: message, tone: 'muted' }],
          makeBubble(`add-empty-${seqNext}`, 'buddy', 34, 54, '스테이징 영역을 확인했어요', message),
        );
      }
      if (draft.staged.length === 0) {
        const message = '다음 커밋에 들어갈 변경이 없어요.';
        return finalizeTransition(
          state, draft, 'IDLE', '스테이징 영역 확인', undefined, cmd,
          [{ text: message, tone: 'muted' }],
          makeBubble(`add-empty-${seqNext}`, 'buddy', 34, 54, '스테이징 영역을 확인했어요', message),
        );
      }

      // 바뀐 줄 탭을 유지해 git add 뒤 작업 폴더와 장바구니가 같아졌음을 보여 주고, 다음 단계에서 담아 둔 변경 탭을 직접 확인하게 해요.
      const addMessage = state.document
        ? '고친 내용을 다음 기록의 장바구니(스테이징 영역)에 담았어요. 작업 문서와 장바구니가 같아져서 바뀐 줄 탭은 비어 보이지만, 사라진 게 아니라 장바구니에 담겨 있어요. 아래 비교에서 담아 둔 변경 탭으로 확인할 수 있어요.'
        : `수정한 파일(${draft.staged.join(', ')})을 다음 기록의 장바구니(스테이징 영역)에 담았어요. 이제 기록 남기기로 커밋할 수 있어요.`;
      return finalizeTransition(
        state, draft, 'ADD', '다음 기록에 담기', draft.staged.join(', '), cmd,
        [{ text: `스테이징: ${draft.staged.join(', ')}`, tone: 'mint' }],
        makeBubble(`add-${seqNext}`, 'buddy', 38, 54, '다음 기록에 담았어요', addMessage),
      );
    }

    // git commit
    if (sub === 'commit') {
      if (state.conflict && state.conflict.resolvedChoice === 'none') {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '충돌 해결 필요',
          undefined,
          cmd,
          [{ text: 'error: Committing is not possible because you have unmerged files. (충돌이 남아 있어 커밋할 수 없어요)', tone: 'coral' }],
          makeBubble(
            `commit-conflict-${seqNext}`,
            'buddy',
            46,
            52,
            '아직 충돌이 해결되지 않았어요! ⚡',
            '먼저 내 코드·상대 코드·둘 다 중 하나를 고른 뒤에 커밋할 수 있어요.',
            '아래 버튼으로 충돌을 먼저 해결해 주세요!',
            [
              { label: '내 코드 유지 (ours)', command: 'resolve ours', tone: 'primary' },
              { label: '상대 코드 채택 (theirs)', command: 'resolve theirs', tone: 'amber' },
              { label: '둘 다 합치기 (both)', command: 'resolve both', tone: 'mint' },
            ],
          ),
        );
      }

      if (state.conflict?.revert) {
        const target = commitById(state, state.conflict.theirsCommit);
        if (target) return recordRevert(state, state, target, cmd);
      }
      const isAutoStage = /\s(?:-[a-z]*a[a-z]*|--all)(?=\s|$)/.test(cmd.replace(/"[^"]*"|'[^']*'/g, ''));
      const working = workingTree(state);
      const index = { ...state.index };
      if (isAutoStage) {
        for (const path of Object.keys(index)) writeTreeEntry(index, path, treeEntry(working, path));
      }
      const staged = changedPaths(headTree(state), index);
      const isMergeCommit = state.conflict?.resolvedChoice !== undefined && state.conflict.resolvedChoice !== 'none';
      if (isMergeCommit && hasMergeMarker(treeEntry(index, state.conflict?.file ?? ''))) {
        return finalizeTransition(
          state, state, 'IDLE', '충돌 표시가 남아 있어요', undefined, cmd,
          [{ text: '⚠️ 커밋하려는 파일에 충돌 표시가 남아 있어요. 남길 내용을 먼저 골라 주세요.', tone: 'amber' }],
          makeBubble(
            `commit-marker-${seqNext}`, 'buddy', 44, 52, '충돌 표시가 그대로예요',
            '충돌 표시를 지우거나 아래 선택지로 남길 내용을 골라야 안전하게 기록할 수 있어요.',
            '내 코드·상대 코드·둘 다 중 하나를 골라 주세요.',
          ),
        );
      }
      if (staged.length === 0 && !isMergeCommit && !tokens.includes('--allow-empty')) {
        return commandNotice(state, cmd, '기록할 변경이 없어요', '변경을 작업 파일에 저장하고 git add로 다음 커밋에 담아 주세요.', 'amber');
      }

      const parsedMessage = parseCommitMessage(tokens);
      if (parsedMessage.missing) {
        return commandNotice(state, cmd, '-m 뒤에 메시지를 적어 주세요',
          '예: git commit -m "모임 장소 수정". 여러 단어는 따옴표로 감싸면 그대로 기록돼요.', 'amber');
      }
      const parsedMsg = parsedMessage.message
        ?? (isMergeCommit ? `Merge branch '${state.conflict?.theirsLabel}' into ${state.headBranch}`
          : staged.length > 0 ? `${staged.join(', ')} 변경 기록` : '변경 기록');
      const parents = [state.branches[state.headBranch], state.conflict?.theirsCommit]
        .filter((id): id is string => Boolean(id));
      const newCommitId = `c${state.commits.length + 1}`;
      const newCommit: PixelCommit = {
        id: newCommitId,
        hash: makeHash(seqNext, parsedMsg),
        message: parsedMsg,
        branch: state.headBranch,
        parents: [...new Set(parents)],
        tree: index,
        ...(isMergeCommit ? { isMerge: true } : {}),
      };
      const draft = updateWorkspace({
        ...state,
        commits: [...state.commits, newCommit],
        branches: { ...state.branches, [state.headBranch]: newCommitId },
        conflict: null,
        completedActions: isMergeCommit
          ? withCompletedAction(state.completedActions, 'MERGE_COMMIT') : state.completedActions,
      }, working, index);

      const message = isMergeCommit
        ? '합친 파일이 새 커밋에 기록됐어요.'
        : `${parsedMessage.message ? '적은 메시지' : '메시지를 적지 않아 기본 이름'}으로 “${parsedMsg}” 커밋을 기록했어요. 커밋 ID(7자리 고유 번호)는 ${newCommit.hash}예요.`;
      return finalizeTransition(
        state, draft, 'COMMIT', '커밋 기록', newCommit.hash, cmd,
        [
          { text: `[${state.headBranch} ${newCommit.hash}] ${parsedMsg}`, tone: 'mint' },
          { text: message, tone: 'sky' },
        ],
        makeBubble(`commit-${seqNext}`, 'buddy', 48, 52, '새 커밋을 기록했어요', message),
      );
    }

    // git push
    if (sub === 'push') {
      const args = tokens.slice(2).filter((arg) => arg !== '-u' && arg !== '--set-upstream');
      const [remote = 'origin', refspec = state.headBranch] = args;
      const [branch, remoteBranch = branch] = refspec.split(':');

      // 9장: 브랜치 보호 규칙은 체험용 ai push-main뿐 아니라 일반 git push에도 적용돼요.
      if (state.stageId === 'ch8' && branch === 'main') {
        const draft: PixelSimState = { ...state, ai: { ...state.ai, mainPushBlocked: true } };
        return finalizeTransition(
          state, draft, 'AI_BLOCK_MAIN', 'main 직접 푸시 차단', 'BRANCH_PROTECTION', cmd,
          [
            { text: `git push origin ${branch} (직접 입력)`, tone: 'muted' },
            { text: 'remote: error: GH006: Protected branch update failed for refs/heads/main. (보호된 main 브랜치 직접 수정 거부)', tone: 'coral' },
            { text: '브랜치 보호 규칙은 AI뿐 아니라 모든 직접 push를 막아요. PR과 사람의 승인을 거쳐야 해요.', tone: 'amber' },
          ],
          makeBubble(
            `push-protected-${seqNext}`, 'guard', 52, 48, 'main은 직접 push할 수 없어요 🛑',
            '보호 규칙은 작성자가 누구든 main에 바로 올리는 변경을 막아요. 변경은 PR로 제안하고 사람이 승인해야 해요.',
            'ai pr로 검토를 요청하거나 ai approve로 승인된 변경을 합쳐 보세요.',
            [{ label: '검토 초안 열기', command: 'ai pr', tone: 'primary' }],
          ),
        );
      }

      // 7장: 유출 차단 데모 뒤에는 실제 push도 같은 규칙으로 막아요.
      if (state.stageId === 'ch6' && state.token.pushBlockedDemo) {
        return finalizeTransition(
          state, state, 'TOKEN_BLOCK', '비밀 정보 유출 차단', 'SECRET_BLOCKED', cmd,
          [
            { text: 'remote: error: GH013: Repository rule violations found! (저장소 보안 규칙 위반)', tone: 'coral' },
            { text: 'remote: - PUSH PROTECTION: .env.example의 GitHub Personal Access Token(ghp_***) 감지', tone: 'coral' },
            { text: '토큰이 담긴 파일은 push할 수 없어요. 토큰을 빼거나 token fine으로 안전한 토큰 상태를 확인하세요.', tone: 'amber' },
          ],
          makeBubble(
            `push-leak-blocked-${seqNext}`, 'guard', 56, 48, '토큰이 담긴 push는 막혔어요 🛡️',
            '.env.example에 들어 있던 토큰 패턴을 GitHub가 감지해 전송을 거부했어요.',
            'token fine으로 최소 권한 토큰 상태를 확인한 뒤 다시 시도해 보세요.',
            [{ label: '최소 권한 토큰 보기', command: 'token fine', tone: 'mint' }],
          ),
        );
      }

      const localHead = treeEntry(state.branches, branch);
      if (!localHead) {
        const stageBranch = state.stageId === 'ch4' ? MEETING_PR_BRANCH : branch;
        return commandNotice(state, cmd, '올릴 브랜치를 확인하세요',
          state.stageId === 'ch4'
            ? `내 컴퓨터에 ${stageBranch} 브랜치가 없어요. git branch로 목록을 확인하고 git switch -c ${stageBranch}로 만들어 보세요.`
            : `${branch} 브랜치가 내 컴퓨터에 없어요. git branch로 목록을 확인하세요.`, 'amber');
      }
      if (remote !== 'origin' || args.length > 2 || !remoteBranch) {
        return commandNotice(state, cmd, '올릴 브랜치를 확인하세요', 'git push origin 브랜치이름으로 로컬 브랜치를 지정할 수 있어요.', 'amber');
      }
      const remoteHead = treeEntry(state.remoteBranches, remoteBranch);
      if (remoteHead === localHead) {
        const localDirty = trackedChanges(state).length > 0 || state.staged.length > 0;
        if (localDirty) {
          const next = getNextPendingStep(state);
          return finalizeTransition(
            state, state, 'IDLE', '아직 올릴 새 커밋이 없어요', undefined, cmd,
            [{ text: '아직 올릴 새 커밋이 없어요. 고친 내용이 있다면 git add → git commit으로 먼저 기록을 남겨 보세요.', tone: 'amber' }],
            makeBubble(
              `push-before-commit-${seqNext}`, 'cloud', 68, 48, '아직 올릴 새 커밋이 없어요',
              'push는 커밋된 기록을 올려요. 작업 폴더의 변경은 아직 커밋이 아니라서 올라가지 않아요. 먼저 장바구니에 담고 기록을 남겨 주세요.',
              'git add . → git commit 순서로 기록을 만들면 push할 수 있어요.',
              [
                { label: '다음 기록에 담기', command: 'git add .', tone: 'mint' },
                ...(next && next.command !== 'git add .'
                  ? [{ label: `▶ ${next.label}`, command: next.command, tone: 'primary' as const }]
                  : []),
              ],
            ),
          );
        }
        return commandNotice(state, cmd, '이미 같은 커밋이에요', '로컬 브랜치와 원격 브랜치가 같은 커밋을 가리켜요.');
      }
      if (remoteHead && reachableCommits(state, remoteHead).has(localHead)) {
        const stagedHint = state.staged.length > 0 || trackedChanges(state).length > 0;
        return finalizeTransition(
          state, state, 'IDLE', '올릴 새 커밋이 없어요', undefined, cmd,
          [
            { text: '아직 올릴 새 커밋이 없어요. 고친 내용이 있다면 git add → git commit으로 먼저 기록을 남겨 보세요.', tone: 'amber' },
            ...(stagedHint ? [{ text: '장바구니나 작업 폴더에 아직 기록되지 않은 변경이 남아 있어요.', tone: 'muted' as const }] : []),
          ],
          makeBubble(
            `push-nothing-${seqNext}`, 'cloud', 68, 48, '올릴 새 커밋이 없어요',
            '아직 올릴 새 커밋이 없어요. push는 커밋 기록만 올려요. 지금은 원격이 내 브랜치보다 앞서 있거나 같은 상태예요.',
            'git add → git commit으로 새 기록을 만든 뒤 다시 push해 보세요.',
            [
              { label: '다음 기록에 담기', command: 'git add .', tone: 'mint' },
            ],
          ),
        );
      }
      if (remoteHead && !reachableCommits(state, localHead).has(remoteHead)) {
        return finalizeTransition(
          state, state, 'IDLE', '원격 기록을 먼저 확인하세요', undefined, cmd,
          [
            { text: '원격 브랜치에 현재 이력에 없는 커밋이 있어 푸시가 거절됐어요. (non-fast-forward)', tone: 'amber' },
            { text: 'git pull origin main으로 원격 변경을 먼저 가져온 뒤 다시 push해 보세요.', tone: 'muted' },
          ],
          makeBubble(
            `push-behind-${seqNext}`, 'guard', 62, 48, '원격 기록을 먼저 가져와야 해요',
            '팀 저장소에 내 이력에 없는 커밋이 있어요. 강제로 덮어쓰지 말고, git pull로 원격 변경을 먼저 가져와요.',
            'git pull origin main을 실행해 보세요.',
            [{ label: '원격 변경 가져오기', command: 'git pull origin main', tone: 'primary' }],
          ),
        );
      }

      const draft = { ...state, remoteBranches: { ...state.remoteBranches, [remoteBranch]: localHead } };
      const message = state.stageId === 'docs'
        ? '미리 체험해 본 push예요. 2장에서 정식 단계로 다시 다뤄요.'
        : (state.stageId === 'ch1' || state.stageId === 'ch2')
          ? '방금 만든 새 커밋을 팀의 GitHub(원격 저장소)에 올렸어요.'
          : `이제 GitHub(원격)에 있는 ${remoteBranch} 브랜치에 내 ${branch}의 새 커밋이 올라갔어요.`;
      const upstreamNote = tokens.includes('-u') || tokens.includes('--set-upstream')
        ? `이제 이 브랜치는 origin/${remoteBranch}와 연결됐어요. 다음부터는 git push만으로 보내요.`
        : `처음 올리는 브랜치라면 git push -u origin ${branch}로 연결해 두면 다음부터 git push만 쓰면 돼요.`;
      return finalizeTransition(
        state, draft, 'PUSH', '변경 공유', `origin/${remoteBranch}`, cmd,
        [
          { text: `${branch} → origin/${remoteBranch}`, tone: 'mint' },
          { text: message, tone: 'sky' },
          ...(state.stageId === 'ch4' ? [{ text: upstreamNote, tone: 'muted' as const }] : []),
        ],
        makeBubble(`push-${seqNext}`, 'cloud', 68, 48, '팀이 볼 수 있도록 커밋을 공유했어요', message),
      );
    }

    // git fetch
    if (sub === 'fetch') {
      const relation = remoteRelation(state, 'main');
      const ahead = relation === 'ahead' ? aheadCommitCount(state, 'main') : 0;
      const behindCount = (() => {
        const local = treeEntry(state.branches, 'main');
        const remote = treeEntry(state.remoteBranches, 'main');
        if (!local || !remote) return 0;
        const localHistory = reachableCommits(state, local);
        return [...reachableCommits(state, remote)].filter((id) => !localHistory.has(id)).length;
      })();
      const hasNewRemote = relation === 'behind' || relation === 'diverged';

      const draft: PixelSimState = { ...state };
      const afterCompleted = withCompletedAction(draft.completedActions, 'FETCH');
      const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

      return finalizeTransition(
        state,
        draft,
        'FETCH',
        '원격 소식 확인',
        'origin',
        cmd,
        [
          { text: `From https://${state.ghHost}/gitdots/app (원격 저장소에서 최신 정보 확인)`, tone: 'sky' },
          {
            text: relation === 'behind'
              ? ` * [updated] origin/main — 팀원의 새 커밋 ${behindCount}건이 있어요!`
              : relation === 'diverged'
                ? ` * [updated] origin/main — 원격에 내 이력에 없는 커밋 ${behindCount}건이 있어요(갈라진 기록).`
                : relation === 'ahead'
                  ? ` ↑ 내 컴퓨터에만 있는 커밋 ${ahead}건이 아직 공유되지 않았어요.`
                  : ' ✓ 원격 저장소와 최신 정보를 동기화했어요.',
            tone: hasNewRemote || relation === 'ahead' ? 'amber' : 'mint',
          },
        ],
        makeBubble(
          `fetch-${seqNext}`,
          'cloud',
          68,
          48,
          '원격 소식만 살짝 확인했어요! 🔭',
          'git fetch는 내 작업 폴더를 건드리지 않고, GitHub에 어떤 새 커밋이 올라왔는지만 안전하게 살펴봐요!',
          nextStepHintText({ ...draft, completedActions: afterCompleted }),
          nextStep
            ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
            : undefined,
        ),
      );
    }

    // git pull
    if (sub === 'pull') {
      const branch = tokens[2] === 'origin' ? (tokens[3] ?? state.headBranch) : state.headBranch;
      const remote = resolveRevision(state, `origin/${branch}`);
      const local = headCommit(state);
      if (!remote || !local) {
        return commandNotice(state, cmd, '가져올 원격 브랜치를 확인하세요', 'git pull origin main처럼 원격과 브랜치를 지정할 수 있어요.', 'amber');
      }
      if (reachableCommits(state, local.id).has(remote.id)) {
        // 합친 뒤 main이 이미 최신이어도 마무리 단계는 완료로 인정해요.
        if (state.headBranch === 'main' && state.completedActions.includes('PR_MERGE')) {
          const draft = { ...state, completedActions: withCompletedAction(state.completedActions, 'SYNC_MAIN') };
          return finalizeTransition(
            state, draft, 'PULL', '원격 변경 적용', `origin/${branch}`, cmd,
            [{ text: '이미 최신이에요. 합친 내용이 내 컴퓨터의 main에 반영돼 있어요.', tone: 'mint' }],
            makeBubble(`pull-${seqNext}`, 'cloud', 66, 48, '합친 내용을 내 컴퓨터로 가져왔어요',
              '내 컴퓨터의 main이 이미 GitHub의 최신 main과 같아요. 합친 회의록 수정과 팀원의 참석 안내가 모두 반영돼 있어요.'),
          );
        }
        return commandNotice(state, cmd, '이미 가져온 커밋이에요', '현재 브랜치에 원격 변경이 들어 있어요.');
      }
      const common = mergeBase(state, local.id, remote.id);
      const merged = mergeTrees(common?.tree ?? {}, local.tree, remote.tree);
      const checkout = checkoutTree(state, merged.tree);
      if (merged.conflicts.length > 0 || checkout.blocked.length > 0 || state.staged.length > 0) {
        return commandNotice(state, cmd, '원격 변경을 합치기 전에 확인하세요', '변경이 겹쳐요. 작업을 기록한 뒤 파일 차이를 확인하세요.', 'amber');
      }
      const fastForward = common?.id === local.id;
      const commit: PixelCommit = fastForward ? remote : {
        id: `c${state.commits.length + 1}`, hash: makeHash(seqNext, 'git-pull'),
        message: `Merge origin/${branch} into ${state.headBranch}`, branch: state.headBranch,
        parents: [local.id, remote.id], tree: merged.tree, isMerge: true,
      };
      // 합친 내용을 내 컴퓨터의 main에 가져올 때만 마무리 단계로 인정해요.
      const syncingMain = state.headBranch === 'main' && state.completedActions.includes('PR_MERGE');
      const draft = updateWorkspace({
        ...state,
        commits: fastForward ? state.commits : [...state.commits, commit],
        branches: { ...state.branches, [state.headBranch]: commit.id },
        completedActions: syncingMain ? withCompletedAction(state.completedActions, 'SYNC_MAIN') : state.completedActions,
      }, checkout.working, checkout.index);
      const message = syncingMain
        ? 'GitHub의 최신 main을 내 컴퓨터에도 가져왔어요. 방금 합친 회의록 수정과 팀원의 참석 안내가 모두 반영됐어요.'
        : `origin/${branch}의 변경을 현재 브랜치에 적용했어요.`;
      return finalizeTransition(
        state, draft, 'PULL', '원격 변경 적용', `origin/${branch}`, cmd,
        [{ text: message, tone: 'mint' }],
        makeBubble(`pull-${seqNext}`, 'cloud', 66, 48, syncingMain ? '합친 내용을 내 컴퓨터로 가져왔어요' : '팀원의 변경을 가져왔어요', message),
      );
    }

    // git log
    if (sub === 'log') {
      const branchByCommit = new Map<string, string[]>();
      for (const [bName, cId] of Object.entries(state.branches)) {
        const list = branchByCommit.get(cId) ?? [];
        list.push(bName === state.headBranch ? `HEAD -> ${bName}` : bName);
        branchByCommit.set(cId, list);
      }
      // --all이면 실제 git처럼 origin/원격 브랜치 이름표도 함께 보여 줘요.
      if (tokens.includes('--all')) {
        for (const [bName, cId] of Object.entries(state.remoteBranches)) {
          const list = branchByCommit.get(cId) ?? [];
          if (!list.includes(`origin/${bName}`)) list.push(`origin/${bName}`);
          branchByCommit.set(cId, list);
        }
      }

      const refs = tokens.includes('--all')
        ? [...Object.values(state.branches), ...Object.values(state.remoteBranches)]
        : [state.branches[state.headBranch]];
      const reachable = new Set(refs.flatMap((id) => [...reachableCommits(state, id)]));
      const recent = [...state.commits]
        .filter((c) => reachable.has(c.id))
        .reverse()
        .slice(0, 7);

      const lines: TerminalLine[] = recent.map((c) => {
        const refs = branchByCommit.get(c.id);
        const refTag = refs ? ` (${refs.join(', ')})` : '';
        return {
          text: `* ${c.hash}${refTag} ${c.message}`,
          tone: c.isRevert ? 'amber' : c.isMerge ? 'lavender' : 'sky',
        };
      });

      return finalizeTransition(
        state,
        state,
        'IDLE',
        '커밋 기록 조회',
        `${recent.length}건`,
        cmd,
        lines,
        makeBubble(
          `log-${seqNext}`,
          'buddy',
          44,
          52,
          '커밋 기록을 열었어요',
          `최근 커밋 ${recent.length}개예요. git show HEAD:파일이름으로 그 시점의 파일을 열어 볼 수 있어요.`,
          nextStepHintText(state),
        ),
      );
    }

    // git show <commit>:<file>
    if (sub === 'show') {
      const spec = tokens[2] ?? '';
      const [ref, path] = spec.split(':', 2);
      const commit = resolveRevision(state, ref);
      const content = commit && path ? treeEntry(commit.tree, path) : undefined;
      if (!commit || !path || content === undefined) {
        return commandNotice(state, cmd, '확인할 파일을 골라 주세요', 'git show HEAD:파일이름으로 커밋에 기록된 파일을 읽을 수 있어요.', 'amber');
      }
      return finalizeTransition(
        state, state, 'IDLE', '커밋의 파일 읽기', path, cmd,
        [{ text: `${commit.hash} · ${path}`, tone: 'sky' }, { text: content, tone: 'default' }],
        makeBubble(`show-${seqNext}`, 'buddy', 34, 52, '커밋에서 파일을 열었어요', `${commit.hash}에 저장된 ${path}예요.`),
      );
    }

    // git diff
    if (sub === 'diff') {
      const args = tokens.slice(2);
      if (state.document && getDocumentDiffMode(args)) return comparePracticeDocument(state, cmd, args);
      const separator = args.indexOf('--');
      const options = separator === -1 ? args : args.slice(0, separator);
      let paths = separator === -1 ? [] : args.slice(separator + 1);
      const staged = options.some((arg) => arg === '--staged' || arg === '--cached');
      const refs = options.filter((arg) => arg !== '--staged' && arg !== '--cached');
      if (separator === -1 && refs.length > 0 && !resolveRevision(state, refs.at(-1) ?? '')) {
        const name = refs.at(-1) ?? '';
        if (!name.startsWith('-') && [...Object.keys(state.index), ...state.files.map((file) => file.name)].includes(name)) {
          paths = [name];
          refs.pop();
        }
      }
      const range = refs.length === 1 && refs[0].includes('..') && !refs[0].includes('...')
        ? refs[0].split('..').map((ref) => ref || 'HEAD') : refs;
      const commits = range.map((ref) => resolveRevision(state, ref));
      if (commits.some((commit) => !commit) || commits.length > (staged ? 1 : 2)) {
        return commandNotice(state, cmd, '비교할 커밋이나 경로를 확인하세요',
          'git diff, git diff --staged 또는 git diff HEAD~1 HEAD로 비교할 수 있어요.', 'amber');
      }
      const before = commits[0]?.tree ?? (staged ? headTree(state) : state.index);
      const after = commits[1]?.tree ?? (staged ? state.index : workingTree(state));
      const files = changedPaths(before, after).filter((path) =>
        (Boolean(commits[1]) || staged || treeEntry(state.index, path) !== undefined) &&
        (paths.length === 0 || paths.some((filter) => filter === '.' || path === filter || path.startsWith(filter + '/'))),
      );
      const lines: TerminalLine[] = files.flatMap((path) => [
        { text: `--- ${path}\n+++ ${path}`, tone: 'sky' },
        ...diffDocumentLines(treeEntry(before, path) ?? '', treeEntry(after, path) ?? '').map((row): TerminalLine => ({
          text: `${row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}${row.text}`,
          tone: row.kind === 'added' ? 'mint' : row.kind === 'removed' ? 'coral' : 'default',
        })),
      ]);
      if (!lines.length) lines.push({ text: '비교한 파일에 변경이 없어요.', tone: 'muted' });
      return finalizeTransition(
        state, state, 'IDLE', '변경 비교', undefined, cmd, lines,
        makeBubble(`diff-${seqNext}`, 'buddy', 34, 54, '파일의 바뀐 줄을 비교했어요',
          '−는 빠진 줄이고, +는 들어간 줄이에요. 터미널에서 파일별 변경을 볼 수 있어요.'),
      );
    }

    // git stash / git stash pop
    if (sub === 'stash') {
      const action = (tokens[2] ?? 'push').toLowerCase();
      const working = workingTree(state);
      if (action === 'list') {
        const lines: TerminalLine[] = state.stashes.length === 0
          ? [{ text: '보관함이 비어 있어요.', tone: 'muted' }]
          : state.stashes.map((_stash, index) => ({
            text: `stash@{${state.stashes.length - 1 - index}}: 작업 보관 ${index + 1}`,
            tone: 'default' as const,
          }));
        return finalizeTransition(
          state, state, 'IDLE', '보관함 목록', `${state.stashes.length}개`, cmd, lines,
          makeBubble(`stash-list-${seqNext}`, 'buddy', 30, 54, `보관함에 ${state.stashes.length}개가 있어요`,
            'stash@{0}이 가장 최근 보관 항목이에요. git stash pop으로 가장 최근 항목을 꺼내요.'),
        );
      }
      if (state.conflict) {
        return commandNotice(state, cmd, '합치기를 먼저 마무리하세요', '충돌 중인 파일을 해결한 뒤 작업을 보관할 수 있어요.', 'amber');
      }
      if (action === 'pop' || action === 'apply') {
        const requested = tokens[3]?.match(/stash@\{(\d+)\}/)?.[1];
        const requestedIndex = requested === undefined ? state.stashes.length - 1 : Number(requested);
        const saved = requestedIndex >= 0 && requestedIndex < state.stashes.length
          ? state.stashes[requestedIndex] : undefined;
        if (!saved) return commandNotice(state, cmd, '보관한 변경이 없어요', 'git stash list로 보관 항목을 확인하고 git stash로 먼저 보관해 보세요.', 'amber');
        const paths = changedPaths(saved.base, saved.working);
        const overwritten = paths.filter((path) =>
          treeEntry(working, path) !== treeEntry(state.index, path),
        );
        const restored = mergeTrees(saved.base, working, saved.working);
        const index = tokens.includes('--index') ? mergeTrees(saved.base, state.index, saved.index)
          : { tree: state.index, conflicts: [] };
        if (overwritten.length > 0 || restored.conflicts.length > 0 || index.conflicts.length > 0) {
          return commandNotice(state, cmd, '보관한 변경과 현재 수정이 겹쳐요',
            '현재 수정 내용을 먼저 기록하거나 따로 보관하세요. 기존 보관 항목을 다시 적용할 수 있어요.', 'amber');
        }
        const stashes = action === 'pop'
          ? state.stashes.filter((_item, index_) => index_ !== requestedIndex)
          : state.stashes;
        const draft = updateWorkspace({ ...state, stashes, stashCount: stashes.length }, restored.tree, index.tree);
        return finalizeTransition(
          state, draft, 'STASH_POP', '임시 보관 복원', paths.join(', '), cmd,
          [{ text: `보관했던 변경을 작업 파일에 적용했어요. 남은 항목 ${stashes.length}개.`, tone: 'mint' }],
          makeBubble(`stash-pop-${seqNext}`, 'buddy', 34, 54, '중단했던 작업을 되찾았어요',
            '보관했던 줄이 작업 파일로 돌아왔어요. git diff로 작업 파일이 어떻게 달라졌는지 볼 수 있어요.'),
        );
      }

      if (!['push', 'save', '-u', '--include-untracked'].includes(action)) {
        return commandNotice(state, cmd, 'stash 명령을 확인하세요', '이 실습에서는 git stash, git stash pop, git stash list를 써요.', 'amber');
      }
      const includeUntracked = tokens.includes('-u') || tokens.includes('--include-untracked');
      const base = headTree(state);
      const untracked = Object.entries(working).filter(([path]) =>
        treeEntry(state.index, path) === undefined && treeEntry(base, path) === undefined,
      );
      const snapshot = { ...working };
      if (!includeUntracked) for (const [path] of untracked) delete snapshot[path];
      if (changedPaths(base, snapshot).length === 0 && state.staged.length === 0) {
        return commandNotice(state, cmd, '임시 보관할 변경이 없어요', '추적 중인 파일을 수정하거나 git stash -u로 새 파일도 포함할 수 있어요.');
      }

      const stashes = [...state.stashes, { base, index: state.index, working: snapshot }];
      const nextWorking = { ...Object.fromEntries(includeUntracked ? [] : untracked), ...base };
      const draft = updateWorkspace({ ...state, stashes, stashCount: stashes.length }, nextWorking, base);
      return finalizeTransition(
        state, draft, 'STASH', '작업 임시 보관하기', 'stash@{0}', cmd,
        [{ text: `수정 내용을 보관했어요. 보관 항목 ${stashes.length}개. stash@{0}이 가장 최근 항목이에요.`, tone: 'mint' },
          ...(untracked.length > 0 && !includeUntracked
            ? [{ text: `추적하지 않는 새 파일(${untracked.map(([path]) => path).join(', ')})은 보관함에 넣지 않고 작업 폴더에 그대로 뒀어요.`, tone: 'muted' as const }]
            : [])],
        makeBubble(`stash-${seqNext}`, 'buddy', 34, 54, '하던 작업을 잠시 보관했어요',
          '고치던 파일이 최근 커밋 상태로 돌아왔어요. 새 파일(추적하지 않는 파일)은 작업 폴더에 그대로 남아 있어요.'),
      );
    }

    // git restore --staged
    if (sub === 'restore') {
      if (!tokens.includes('--staged') && !tokens.includes('--cached')) {
        return commandNotice(state, cmd, '실습에서는 --staged 빼기를 연습해요',
          'git restore --staged <파일>로 장바구니에서 변경을 빼요. 작업 파일 되돌리기는 git reset으로 연습할 수 있어요.', 'amber');
      }
      const args = tokens.slice(2).filter((arg) => arg !== '--staged' && arg !== '--cached' && arg !== '--');
      if (args.length === 0) {
        return commandNotice(state, cmd, '파일 이름을 적어 주세요', 'git restore --staged 뒤에 파일 이름이나 현재 폴더를 뜻하는 점(.)을 적으세요.', 'amber');
      }
      const head = headTree(state);
      const matches = new Set<string>();
      for (const arg of args) {
        const target = arg.replace(/^\.\//, '').replace(/\/$/, '');
        const selected = Object.keys(state.index).filter((path) => target === '.' || path === target || path.startsWith(target + '/'));
        if (selected.length === 0 && target !== '.') {
          // 3장에서 stash를 먼저 해 이미 장바구니 밖(untracked)이 된 경우에도 막히지 않게 해요.
          if (state.stageId === 'ch2' && target === SECRET_NOTE_PATH && treeEntry(workingTree(state), target) !== undefined) {
            const draft: PixelSimState = {
              ...state,
              completedActions: withCompletedAction(state.completedActions, 'UNSTAGE'),
            };
            return finalizeTransition(
              state, draft, 'UNSTAGE', '장바구니에서 빼기', target, cmd,
              [{ text: `${target}은 이미 장바구니(스테이징 영역) 밖에 있어요. 작업 폴더에만 남아 있으니 이 단계는 마친 것으로 볼 수 있어요.`, tone: 'mint' }],
              makeBubble(`restore-already-${seqNext}`, 'buddy', 38, 54, '이미 장바구니 밖에 있어요',
                `${target}은 지금 작업 폴더에만 있고 다음 커밋에는 들어가지 않아요. 이 단계를 마친 것으로 볼게요.`),
            );
          }
          return commandNotice(state, cmd, '스테이징 영역을 확인해 주세요',
            `${arg} 파일은 장바구니(스테이징 영역)에 없어요.${state.stageId === 'ch2' ? ' 다시 담았다 빼려면 git add 후 실행하세요.' : ''}`, 'amber');
        }
        selected.forEach((path) => matches.add(path));
      }
      if (matches.size === 0) {
        return finalizeTransition(
          state, state, 'IDLE', '스테이징 영역 확인', undefined, cmd,
          [{ text: '장바구니(스테이징 영역)가 비어 있어요. 뺄 변경이 없어요.', tone: 'muted' }],
          makeBubble(`restore-empty-${seqNext}`, 'buddy', 34, 54, '장바구니를 확인했어요', '지금 장바구니에 담긴 변경이 없어요.'),
        );
      }
      const index = { ...state.index };
      for (const path of matches) writeTreeEntry(index, path, treeEntry(head, path));
      if (changedPaths(state.index, index).length === 0) {
        return finalizeTransition(
          state, state, 'IDLE', '스테이징 영역 확인', undefined, cmd,
          [{ text: '장바구니(스테이징 영역)에 담긴 변경이 없어요. 뺄 것이 없어요.', tone: 'muted' }],
          makeBubble(`restore-empty-${seqNext}`, 'buddy', 34, 54, '장바구니를 확인했어요', '지금 장바구니에 담긴 변경이 없어요.'),
        );
      }
      const draft = updateWorkspace(state, workingTree(state), index);
      const names = [...matches].join(', ');
      const secretAdvice = matches.has(SECRET_NOTE_PATH)
        ? ' 비밀 메모는 실제로는 파일을 지우거나 .gitignore에 추가해 관리해요.'
        : '';
      return finalizeTransition(
        state, draft, 'UNSTAGE', '장바구니에서 빼기', names, cmd,
        [
          { text: `스테이징에서 뺌: ${names}`, tone: 'amber' },
          { text: '작업 폴더의 파일 내용은 그대로예요. 다음 커밋에도 들어가지 않아요.', tone: 'muted' },
        ],
        makeBubble(`unstage-${seqNext}`, 'buddy', 38, 54, '장바구니에서 뺐어요',
          `${names} — 이제 다음 커밋에 들어가지 않아요. 파일은 작업 폴더에 그대로 남아요.${secretAdvice}`),
      );
    }

    // git reset
    if (sub === 'reset') {
      const args = readResetArgs(tokens.slice(2));
      if (!args) {
        return commandNotice(state, cmd, 'reset 사용법 확인', '예를 들어 git reset --hard HEAD~1처럼 모드와 대상 커밋을 적으세요.', 'amber');
      }
      const target = resolveRevision(state, args.revision);
      if (!target) {
        return commandNotice(state, cmd, '대상 커밋을 찾을 수 없어요', `${args.revision}의 커밋을 확인하세요. git log에서 커밋 ID를 볼 수 있어요.`, 'amber');
      }

      const working = workingTree(state);
      if (args.paths.length > 0) {
        const index = { ...state.index };
        for (const raw of args.paths) {
          const path = raw.replace(/^\.\//, '');
          if (treeEntry(index, path) === undefined && treeEntry(target.tree, path) === undefined) {
            return commandNotice(state, cmd, '스테이징할 파일 경로를 확인해 주세요', `실습 기록에 ${path} 파일이 없어요.`, 'amber');
          }
          writeTreeEntry(index, path, treeEntry(target.tree, path));
        }
        const draft = updateWorkspace(state, working, index);
        return finalizeTransition(
          state, draft, 'RESET', '스테이징 영역 복원', target.hash, cmd,
          [{ text: `${args.paths.join(', ')}의 스테이징 버전을 ${target.hash} 기준으로 바꿨어요.`, tone: 'sky' }],
          makeBubble(`reset-path-${seqNext}`, 'buddy', 46, 52, '스테이징 사본을 바꿨어요',
            '작업 파일은 계속 편집할 수 있어요. git diff로 작업 파일과 스테이징 영역을 비교해 보세요.'),
        );
      }

      if (args.mode === '--soft' && state.conflict) {
        return commandNotice(state, cmd, '합치기를 먼저 마무리하세요', '합치기 중에는 git reset --soft를 실행할 수 없어요.', 'amber');
      }

      const oldHead = headCommit(state);
      const branches = { ...state.branches, [state.headBranch]: target.id };
      const referenced = [...Object.values(branches), ...Object.values(state.remoteBranches)];
      const reachable = new Set<string>(referenced.flatMap((id) => [...reachableCommits(state, id)]));
      const commits = state.commits.map((commit) => ({ ...commit, ghost: !reachable.has(commit.id) }));
      const nextWorking = args.mode === '--hard' ? restoreWorktree(state, target.tree) : working;
      const index = args.mode === '--soft' ? state.index : target.tree;
      const draft = updateWorkspace({
        ...state, branches, commits, origHead: oldHead?.id, conflict: null,
      }, nextWorking, index);
      const message = args.mode === '--hard'
        ? '커밋하지 않은 추적 파일의 변경을 덮어쓰고, 작업 파일과 스테이징 영역을 대상 커밋의 버전으로 복원했어요.'
        : args.mode === '--soft'
          ? 'HEAD가 가리키는 커밋을 바꿨어요. 작업 파일과 스테이징 영역은 유지돼요.'
          : '스테이징 영역을 대상 커밋과 맞췄어요. 작업 파일에는 기존 수정 내용이 남아 있어요.';
      const sharedOldHead = Boolean(oldHead && Object.values(state.remoteBranches).some((remoteId) =>
        reachableCommits(state, remoteId).has(oldHead.id)));
      const sharedWarning = args.mode === '--soft' && sharedOldHead
        ? ' 이미 팀에 공유한 기록을 되감았어요. 이 상태로 push하면 거절되니, git pull origin main으로 원격 기록을 먼저 확인하세요.'
        : '';
      return finalizeTransition(
        state, draft, 'RESET', `복원 ${args.mode}`, target.hash, cmd,
        [
          { text: `HEAD → ${target.hash} ${target.message}`, tone: 'sky' },
          { text: message, tone: args.mode === '--hard' ? 'amber' : 'default' },
          ...(args.mode === '--soft' ? [{ text: '실습 진행 기록(완료 배지)은 그대로예요. 진행은 되감기지 않아요.', tone: 'muted' as const }] : []),
          ...(oldHead ? [{ text: `되감기 전 기록: ${oldHead.hash} ${oldHead.message}`, tone: 'muted' as const }] : []),
          ...(sharedWarning ? [{ text: sharedWarning.trim(), tone: 'amber' as const }] : []),
        ],
        makeBubble(
          `reset-${seqNext}`,
          'buddy',
          46,
          52,
          `${target.hash}로 이동했어요`,
          message + sharedWarning,
          sharedWarning ? 'git pull origin main으로 원격 기록을 먼저 가져와 보세요.' : undefined,
          sharedWarning
            ? [{ label: '원격 기록 가져오기', command: 'git pull origin main', tone: 'primary' }]
            : undefined,
        ),
      );
    }

    // git revert
    if (sub === 'revert') {
      const args = tokens.slice(2);
      const pending = state.conflict?.revert;
      if (args[0] === '--abort' || args[0] === '--skip') {
        if (!pending) return commandNotice(state, cmd, '진행 중인 취소가 없어요', 'git revert HEAD로 취소할 커밋을 고를 수 있어요.');
        const draft = updateWorkspace({ ...state, conflict: null }, pending.working, pending.index);
        return finalizeTransition(
          state, draft, 'IDLE', '커밋 취소 중단', undefined, cmd,
          [{ text: '취소를 시작하기 전의 작업 파일과 스테이징 영역으로 돌아왔어요.', tone: 'mint' }],
          makeBubble(`revert-abort-${seqNext}`, 'buddy', 48, 52, '취소 작업을 중단했어요', '취소를 시작하기 전의 버전을 열었어요.'),
        );
      }
      if (args[0] === '--continue') {
        const target = pending && commitById(state, state.conflict?.theirsCommit);
        if (!target) return commandNotice(state, cmd, '진행 중인 취소가 없어요', '취소할 커밋을 먼저 골라 주세요.');
        if (state.conflict?.resolvedChoice === 'none') {
          return commandNotice(state, cmd, '남길 줄을 먼저 골라 주세요', '충돌을 해결해 스테이징한 뒤 git revert --continue를 실행하세요.', 'amber');
        }
        return recordRevert(state, state, target, cmd);
      }

      const mainlineFlag = args.findIndex((arg) => arg === '-m' || arg === '--mainline');
      const mainline = mainlineFlag === -1 ? undefined : Number(args.splice(mainlineFlag, 2)[1]);
      const noCommit = args.includes('-n') || args.includes('--no-commit');
      const revisions = args.filter((arg) => !['--edit', '--no-edit', '-e', '-n', '--no-commit'].includes(arg));
      const [revision] = revisions;
      const target = revisions.length === 1 ? resolveRevision(state, revision) : undefined;
      if (!target || !headCommit(state)) {
        return commandNotice(state, cmd, '취소할 커밋을 확인하세요', 'git revert HEAD 또는 git revert 뒤에 취소할 커밋 ID 하나를 적으세요.', 'amber');
      }
      if (target.parents.length === 0) {
        return commandNotice(state, cmd, '첫 기록은 취소할 수 없어요',
          '이 문서의 첫 커밋이라 되돌리면 내용이 모두 사라져요. 첫 기록 이후의 변경만 취소할 수 있어요.', 'amber');
      }
      if (state.conflict || (!noCommit && state.staged.length > 0)) {
        return commandNotice(state, cmd, '먼저 진행 중인 변경을 정리하세요', '스테이징한 변경을 기록하거나 임시 보관한 다음 다시 시도하세요.', 'amber');
      }
      if (target.parents.length > 1 && mainline === undefined) {
        return commandNotice(state, cmd, '병합 커밋의 기준이 필요해요', '합치기를 취소할 때는 기준이 되는 부모를 -m 1처럼 지정하세요.', 'amber');
      }
      if (mainline !== undefined && (!Number.isInteger(mainline) || mainline < 1 || mainline > Math.max(1, target.parents.length))) {
        return commandNotice(state, cmd, '부모 커밋 번호를 확인하세요', '존재하는 부모 커밋의 번호를 입력하세요.', 'amber');
      }

      const parentTree = commitById(state, target.parents[(mainline ?? 1) - 1])?.tree ?? {};
      const reversed = mergeTrees(target.tree, state.index, parentTree);
      const working = workingTree(state);
      const checkout = checkoutTree(state, reversed.tree, state.index);
      const blocked = [...checkout.blocked, ...reversed.conflicts.filter((file) => treeEntry(working, file) !== treeEntry(state.index, file))];
      if (blocked.length > 0) {
        return commandNotice(state, cmd, '작업 파일에 커밋하지 않은 변경이 있어요',
          `${blocked.join(', ')}의 수정 내용을 먼저 기록하거나 임시 보관하세요.`, 'amber');
      }
      if (reversed.conflicts.length > 1) {
        return commandNotice(state, cmd, '여러 파일에서 취소 변경이 겹쳤어요',
          `${reversed.conflicts.join(', ')}의 변경을 확인하세요. 한 파일씩 충돌 해결을 연습할 수 있어요.`, 'coral');
      }
      if (reversed.conflicts.length === 1) {
        const file = reversed.conflicts[0];
        const ours = treeEntry(state.index, file);
        const theirs = treeEntry(parentTree, file);
        const oursCode = ours ?? '';
        const theirsCode = theirs ?? '';
        const conflict = {
          file, oursLabel: 'HEAD', theirsLabel: `${target.hash}의 이전 버전`, theirsCommit: target.id,
          oursCode, theirsCode, bothCode: [oursCode.trimEnd(), theirsCode.trimEnd()].filter(Boolean).join('\n'),
          oursDeleted: ours === undefined, theirsDeleted: theirs === undefined,
          resolvedChoice: 'none' as const,
          revert: { index: state.index, working },
        };
        const conflictText = `<<<<<<< HEAD\n${oursCode.trimEnd()}\n=======\n${theirsCode.trimEnd()}\n>>>>>>> ${conflict.theirsLabel}\n`;
        const draft = updateWorkspace({ ...state, conflict }, { ...checkout.working, [file]: conflictText }, checkout.index);
        return finalizeTransition(
          state, draft, 'CONFLICT', '커밋 취소 충돌', file, cmd,
          [{ text: `CONFLICT (content): ${file}. 해결한 뒤 git revert --continue를 실행하세요.`, tone: 'coral' }],
          makeBubble(`revert-conflict-${seqNext}`, 'buddy', 48, 52, '취소하려는 줄에 충돌이 있어요',
            '현재 버전과 취소하려는 변경이 같은 부분에 있어요. 남길 버전을 골라 주세요.', undefined, [
              { label: '현재 버전 유지', command: 'resolve ours', tone: 'primary' },
              { label: '이전 버전 사용', command: 'resolve theirs', tone: 'mint' },
              { label: '취소 작업 중단', command: 'git revert --abort', tone: 'amber' },
            ]),
        );
      }

      const changed = changedPaths(state.index, reversed.tree);
      if (changed.length === 0) {
        return commandNotice(state, cmd, '취소할 변경이 없어요', '현재 파일에 되돌릴 변경이 남아 있지 않아요.');
      }
      const draft = updateWorkspace(state, checkout.working, reversed.tree);
      const message = `“${target.message}”에서 생긴 변경을 취소했어요. 바뀐 파일은 ${changed.join(', ')}예요.`;
      if (noCommit) {
        return finalizeTransition(
          state, draft, 'IDLE', '취소 변경 스테이징', target.hash, cmd,
          [{ text: `${message} git commit으로 기록할 수 있어요.`, tone: 'sky' }],
          makeBubble(`revert-no-commit-${seqNext}`, 'buddy', 48, 52, '취소 변경을 담아 뒀어요', message),
        );
      }
      return recordRevert(state, draft, target, cmd);
    }

    // git branch
    if (sub === 'branch') {
      const newName = tokens[2];
      const deleteFlag = newName === '-d' || newName === '-D' || newName === '--delete';
      if (deleteFlag) {
        const name = tokens[3];
        if (!name) return commandNotice(state, cmd, '삭제할 브랜치 이름을 적어 주세요', 'git branch -d 브랜치이름처럼 적어요.', 'amber');
        if (name === 'main') return commandNotice(state, cmd, 'main은 삭제할 수 없어요', '기본 브랜치는 삭제하지 않아요.', 'amber');
        const tip = treeEntry(state.branches, name);
        if (!tip) return commandNotice(state, cmd, '없는 브랜치예요', 'git branch로 브랜치 목록을 확인하세요.', 'amber');
        const mainTip = treeEntry(state.branches, 'main');
        const merged = Boolean(mainTip && reachableCommits(state, mainTip).has(tip));
        if (!merged) {
          return commandNotice(state, cmd, '아직 합치지 않은 브랜치예요',
            'main에 합친 브랜치만 -d로 지울 수 있어요. (강제 삭제는 -D지만 이 실습에서는 권장하지 않아요.)', 'amber');
        }
        const branches = { ...state.branches };
        delete branches[name];
        const remoteBranches = { ...state.remoteBranches };
        delete remoteBranches[name];
        return finalizeTransition(
          state, { ...state, branches, remoteBranches }, 'IDLE', `브랜치 ${name} 삭제`, name, cmd,
          [{ text: `Deleted branch ${name} (was ${tip.slice(0, 7)}). (다 쓴 브랜치를 정리했어요)`, tone: 'mint' }],
          makeBubble(`branch-delete-${seqNext}`, 'buddy', 42, 52, `${name} 브랜치를 정리했어요`,
            '합친 브랜치는 지워도 커밋 기록은 main에 그대로 남아 있어요.'),
        );
      }
      if (!newName || newName.startsWith('-')) {
        const lines: TerminalLine[] = Object.keys(state.branches).map((b) => ({
          text: b === state.headBranch ? `* ${b} (현재 위치)` : `  ${b}`,
          tone: b === state.headBranch ? 'mint' : 'default',
        }));
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '브랜치 목록',
          `${Object.keys(state.branches).length}개`,
          cmd,
          lines,
          makeBubble(
            `branch-list-${seqNext}`,
            'buddy',
            40,
            54,
            '현재 작업 갈래(브랜치) 목록이에요! 🌿',
            `별표(*)가 붙은 ${state.headBranch} 브랜치에 서 있어요. main은 같은 커밋을 가리키며 그대로 남아 있어요.`,
            nextStepHintText(state),
          ),
        );
      }

      if (treeEntry(state.branches, newName)) {
        return commandNotice(state, cmd, '이미 있는 브랜치예요', `git switch ${newName}로 이동할 수 있어요.`, 'amber');
      }
      const start = resolveRevision(state, tokens[3] ?? 'HEAD');
      if (!start) {
        return commandNotice(state, cmd, '시작 커밋을 찾을 수 없어요', 'git log에서 시작 커밋의 ID를 확인하세요.', 'amber');
      }
      const draft: PixelSimState = { ...state, branches: { ...state.branches, [newName]: start.id } };

      // 브랜치 생성만으로는 이동하지 않아요. 장의 '브랜치 만들기' 단계는 이동까지 해야 완료돼요.
      return finalizeTransition(
        state,
        draft,
        'IDLE',
        `브랜치 ${newName} 생성`,
        newName,
        cmd,
        [{ text: `새 브랜치 '${newName}'를 만들었어요. 아직 ${state.headBranch}에 서 있어요 (이동하려면 git switch ${newName}).`, tone: 'mint' }],
        makeBubble(
          `branch-new-${seqNext}`,
          'buddy',
          42,
          52,
          `새 길 ${newName}을 만들었어요! 🌿`,
          `${newName} 브랜치는 만들어졌지만 아직 ${state.headBranch}에 서 있어요. 이동해야 새 기록이 이 브랜치에 쌓여요.`,
          `git switch ${newName}로 이동해 보세요.`,
          [{ label: `${newName}로 이동`, command: `git switch ${newName}`, tone: 'primary' }],
        ),
      );
    }

    // git switch / git checkout
    if (sub === 'switch' || sub === 'checkout') {
      const isCreate = tokens[2] === '-c' || tokens[2] === '-b';
      const name = isCreate ? tokens[3] : tokens[2];
      const targetBranch = name === '-' && !isCreate ? state.previousBranch : name;
      if (!targetBranch || targetBranch.startsWith('-') || tokens.length > (isCreate ? 5 : 3)) {
        return commandNotice(state, cmd, '이동할 브랜치를 확인하세요', 'git switch 뒤에 브랜치 이름을 적으세요. 새 브랜치는 git switch -c로 열 수 있어요.', 'amber');
      }
      if (state.conflict) {
        return commandNotice(state, cmd, '현재 합치기를 먼저 마무리하세요', '충돌 해결을 기록한 뒤 브랜치를 바꿀 수 있어요.', 'amber');
      }
      const existing = treeEntry(state.branches, targetBranch);
      if (isCreate && existing) {
        return commandNotice(state, cmd, '이미 있는 브랜치예요', `git switch ${targetBranch}로 이동할 수 있어요.`, 'amber');
      }
      const target = isCreate
        ? resolveRevision(state, tokens[4] ?? 'HEAD')
        : commitById(state, existing);
      if (!target) {
        return commandNotice(state, cmd, '브랜치나 시작 커밋을 찾을 수 없어요', 'git branch에서 이동할 브랜치를 고르세요.', 'amber');
      }

      const checkout = checkoutTree(state, target.tree);
      if (checkout.blocked.length > 0) {
        return commandNotice(state, cmd, '브랜치를 바꾸면 작업 내용이 덮어쓰여요',
          `${checkout.blocked.join(', ')}의 변경을 먼저 커밋하거나 임시 보관하세요.`, 'amber');
      }
      // 마무리 단계는 병합을 마친 뒤 main으로 돌아올 때만 인정해요.
      const returningToMain = !isCreate && targetBranch === 'main' && state.completedActions.includes('PR_MERGE');
      const leavingMerge = !isCreate && targetBranch === 'main' && Boolean(headCommit(state)?.isMerge);
      const localChangesFollow = trackedChanges(state).length > 0;
      const draft = updateWorkspace({
        ...state,
        branches: isCreate ? { ...state.branches, [targetBranch]: target.id } : state.branches,
        headBranch: targetBranch,
        previousBranch: state.headBranch === targetBranch ? state.previousBranch : state.headBranch,
        completedActions: returningToMain ? withCompletedAction(state.completedActions, 'RETURN_MAIN') : state.completedActions,
      }, checkout.working, checkout.index);
      const followNote = isCreate && localChangesFollow ? ' 고쳐 둔 작업 파일 변경은 그대로 따라와요.' : '';
      const mergeLeftNote = leavingMerge
        ? ` 합친 기록은 ${state.headBranch} 브랜치에 남아 있어요. main에는 아직 반영되지 않았어요.`
        : '';
      const mainReassure = returningToMain
        ? ' 내 변경은 작업 브랜치와 GitHub의 main에 안전하게 남아 있어요. 다음 단계에서 git pull로 내 컴퓨터의 main에 가져와요.'
        : '';
      const message = isCreate
        ? `새 브랜치 ${targetBranch}${objectParticle(targetBranch)} 만들고 이동했어요.${followNote}`
        : `${targetBranch} 브랜치의 커밋 ${target.hash.slice(0, 7)}에 맞게 작업 파일이 열렸어요.${mergeLeftNote}${mainReassure}`;
      return finalizeTransition(
        state, draft, isCreate ? 'BRANCH' : 'SWITCH', '브랜치 전환', targetBranch, cmd,
        [
          { text: isCreate ? `Switched to a new branch '${targetBranch}' (새 브랜치 '${targetBranch}'로 이동)` : `Switched to branch '${targetBranch}' ('${targetBranch}' 브랜치로 이동)`, tone: 'mint' },
          { text: message, tone: 'sky' },
          ...(mainReassure ? [{ text: 'main으로 이동해도 파일이 예전 버전처럼 보이는 건 정상이에요. 다음 pull에서 합친 내용을 가져와요.', tone: 'muted' as const }] : []),
        ],
        makeBubble(`switch-${seqNext}`, 'buddy', 42, 54, `${targetBranch} 브랜치를 열었어요`, message),
      );
    }

    // git merge
    if (sub === 'merge') {
      const targetName = tokens[2];
      const target = targetName ? resolveRevision(state, targetName) : undefined;
      const local = headCommit(state);
      if (!target || !local) {
        return commandNotice(state, cmd, '합칠 브랜치를 찾을 수 없어요', 'git branch로 브랜치 이름을 확인하세요.', 'amber');
      }
      if (state.stageId === 'ch3' && state.headBranch === 'main') {
        return finalizeTransition(
          state, state, 'IDLE', '브랜치 먼저 만들기', undefined, cmd,
          [{ text: '이 실습은 새 브랜치를 만든 뒤 그 위에서 합쳐요. 먼저 git switch -c feat/dark를 실행하세요.', tone: 'amber' }],
          makeBubble(
            `merge-need-branch-${seqNext}`, 'buddy', 40, 52, '먼저 새 브랜치를 만들어 주세요',
            '이 실습에서는 새 브랜치 위에서 합치기를 연습해요. main은 그대로 두고 안전하게 실험해 봐요.',
            'git switch -c feat/dark로 새 브랜치를 만들어 보세요.',
            [{ label: '새 브랜치 만들기', command: 'git switch -c feat/dark', tone: 'primary' }],
          ),
        );
      }
      if (state.conflict || state.staged.length > 0) {
        return commandNotice(state, cmd, '현재 변경을 먼저 정리하세요', '스테이징한 변경을 커밋하거나 진행 중인 합치기를 마무리하세요.', 'amber');
      }
      if (reachableCommits(state, local.id).has(target.id)) {
        return commandNotice(state, cmd, '이미 합쳐진 변경이에요', '대상 커밋이 현재 브랜치의 이력에 들어 있어요.');
      }

      const common = mergeBase(state, local.id, target.id);
      const merged = mergeTrees(common?.tree ?? {}, local.tree, target.tree);
      const checkout = checkoutTree(state, merged.tree);
      const working = workingTree(state);
      const blocked = merged.conflicts.some((path) => treeEntry(working, path) !== treeEntry(state.index, path));
      if (checkout.blocked.length > 0 || blocked || merged.conflicts.length > 1) {
        return commandNotice(state, cmd, '합치기 전에 변경을 확인하세요', '겹치는 작업이 있어 자동으로 합치지 못했어요. git diff로 현재 변경을 확인하세요.', 'amber');
      }
      if (merged.conflicts.length === 1) {
        const file = merged.conflicts[0];
        const ours = treeEntry(local.tree, file);
        const theirs = treeEntry(target.tree, file);
        const oursCode = ours ?? '';
        const theirsCode = theirs ?? '';
        const bothCode = [oursCode, file === 'theme.js' ? theirsCode.replace('export const theme =', 'export const alternateTheme =') : theirsCode]
          .filter(Boolean).join('\n');
        const conflict = {
          file, oursLabel: state.headBranch, theirsLabel: targetName, theirsCommit: target.id,
          oursCode, theirsCode, bothCode, oursDeleted: ours === undefined, theirsDeleted: theirs === undefined,
          resolvedChoice: 'none' as const,
        };
        const conflictText = `<<<<<<< HEAD\n${oursCode}\n=======\n${theirsCode}\n>>>>>>> ${targetName}\n`;
        const draft = updateWorkspace({ ...state, conflict }, { ...checkout.working, [file]: conflictText }, checkout.index);
        return finalizeTransition(
          state, draft, 'CONFLICT', '병합 충돌 발생', file, cmd,
          [
            { text: `CONFLICT (content): ${file} (같은 줄 충돌 발생)`, tone: 'coral' },
            { text: '화면의 충돌 안내에서 남길 버전을 선택해 주세요.', tone: 'amber' },
          ],
          mergeConflictBubble(file, seqNext),
        );
      }

      const fastForward = common?.id === local.id;
      const commit: PixelCommit = fastForward ? target : {
        id: `c${state.commits.length + 1}`, hash: makeHash(seqNext, `merge-${targetName}`),
        message: `Merge branch '${targetName}' into ${state.headBranch}`, branch: state.headBranch,
        parents: [local.id, target.id], tree: merged.tree, isMerge: true,
      };
      const draft = updateWorkspace({
        ...state,
        commits: fastForward ? state.commits : [...state.commits, commit],
        branches: { ...state.branches, [state.headBranch]: commit.id },
      }, checkout.working, checkout.index);
      const message = fastForward
        ? `현재 브랜치를 ${target.hash}까지 옮기고 작업 파일을 갱신했어요.`
        : `${targetName}의 변경을 병합 커밋 ${commit.hash}에 기록했어요.`;
      return finalizeTransition(
        state, draft, 'MERGE_OK', '합치기 완료', targetName, cmd,
        [{ text: message, tone: 'mint' }],
        makeBubble(`merge-ok-${seqNext}`, 'buddy', 46, 52, '두 브랜치를 합쳤어요', message),
      );
    }

    // git rebase
    if (sub === 'rebase') {
      const name = tokens[2] ?? 'main';
      const base = resolveRevision(state, name);
      const local = headCommit(state);
      if (!base || !local) {
        return commandNotice(state, cmd, '리베이스 기준을 찾을 수 없어요', 'git rebase 뒤에 기준 브랜치를 적으세요.', 'amber');
      }
      const localHistory = reachableCommits(state, local.id);
      if (localHistory.has(base.id)) {
        return commandNotice(state, cmd, '이미 기준 커밋이 이력에 있어요', `${name} 위로 옮길 새 커밋이 없어요.`);
      }
      if (state.conflict || trackedChanges(state).length > 0) {
        return commandNotice(state, cmd, '작업을 먼저 정리하세요', '변경을 커밋하거나 임시 보관한 뒤 리베이스할 수 있어요.', 'amber');
      }
      const baseHistory = reachableCommits(state, base.id);
      const replay = state.commits.filter((commit) => localHistory.has(commit.id) && !baseHistory.has(commit.id));
      if (replay.some((commit) => commit.parents.length > 1)) {
        return commandNotice(state, cmd, '리베이스할 이력을 확인하세요', '이 실습에서 리베이스할 커밋은 한 줄로 이어진 이력이어야 해요.', 'amber');
      }

      const commits = [...state.commits];
      let head = base;
      for (const commit of replay) {
        const originalBase = commitById(state, commit.parents[0])?.tree ?? {};
        const merged = mergeTrees(originalBase, head.tree, commit.tree);
        if (merged.conflicts.length > 0) {
          return commandNotice(state, cmd, '리베이스 중 변경이 겹쳐요', `${merged.conflicts.join(', ')}의 변경을 먼저 확인하세요.`, 'amber');
        }
        if (changedPaths(head.tree, merged.tree).length === 0) continue;
        head = {
          id: `c${commits.length + 1}`, hash: makeHash(seqNext, `rebase-${commit.hash}`),
          message: commit.message, branch: state.headBranch, parents: [head.id], tree: merged.tree,
        };
        commits.push(head);
      }
      const checkout = checkoutTree(state, head.tree);
      if (checkout.blocked.length > 0) {
        return commandNotice(state, cmd, '작업 파일을 먼저 옮겨 주세요', `${checkout.blocked.join(', ')}이 리베이스 결과로 덮어쓰일 수 있어요.`, 'amber');
      }
      const draft = updateWorkspace({
        ...state, commits, origHead: local.id, branches: { ...state.branches, [state.headBranch]: head.id },
      }, checkout.working, checkout.index);
      const message = `${name}에서 시작하도록 현재 작업을 새 이력에 기록했어요.`;
      return finalizeTransition(
        state, draft, 'REBASE', '리베이스 완료', head.hash, cmd,
        [{ text: message, tone: 'mint' }],
        makeBubble(`rebase-${seqNext}`, 'buddy', 48, 52, '커밋을 새 기준 위에 옮겼어요', message),
      );
    }

    // git worktree add / list / remove
    if (sub === 'worktree') {
      const action = (tokens[2] ?? '').toLowerCase();
      if (action === 'list') {
        const lines: TerminalLine[] = state.ai.worktreeActive
          ? [
            { text: `./            ${state.branches.main ? 'main' : 'main'} (사람 작업 폴더)`, tone: 'default' },
            { text: `./${state.ai.worktreeDir ?? 'wt-ai'}    ${state.ai.worktreeBranch} (AI 작업 폴더)`, tone: 'lavender' },
          ]
          : [{ text: `./            ${state.headBranch} (사람 작업 폴더만 있어요)`, tone: 'default' }];
        return finalizeTransition(
          state, state, 'IDLE', '작업 폴더 목록', `${lines.length}개`, cmd, lines,
          makeBubble(`worktree-list-${seqNext}`, 'ai', 66, 52, '열려 있는 작업 폴더 목록이에요',
            'worktree 목록은 폴더와 브랜치를 함께 보여 줘요. 목록 조회는 아무것도 바꾸지 않아요.'),
        );
      }
      if (action === 'remove') {
        return commandNotice(state, cmd, '작업 폴더는 직접 정리하지 않아요',
          '이 실습에서는 만든 worktree를 그대로 사용해요. 목록은 git worktree list로 확인할 수 있어요.', 'muted');
      }
      if (action !== 'add') {
        return commandNotice(state, cmd, 'worktree 사용법을 확인하세요',
          '이 실습에서는 git worktree add -b ai/fix wt-ai 형태로 새 작업 폴더를 열어요.', 'amber');
      }

      const branchIdx = tokens.indexOf('-b');
      const branchName = branchIdx !== -1 && tokens[branchIdx + 1] && !tokens[branchIdx + 1].startsWith('-')
        ? tokens[branchIdx + 1] : 'ai/fix';
      const explicitDir = tokens.slice(3).filter((token) => !token.startsWith('-') && token !== branchName).at(-1);
      const dirName = explicitDir ?? 'wt-ai';

      if (branchName === 'main') {
        return commandNotice(state, cmd, 'main 브랜치는 worktree 전용으로 쓸 수 없어요',
          '이미 있는 main 브랜치는 새 작업 폴더의 브랜치로 덮어쓸 수 없어요. ai/fix처럼 새 이름을 써 주세요.', 'amber');
      }
      if (treeEntry(state.branches, branchName)) {
        return commandNotice(state, cmd, '이미 있는 브랜치예요',
          `${branchName} 브랜치가 이미 있어요. -b에는 새 브랜치 이름을 쓰거나, 기존 브랜치를 쓰려면 -b를 빼세요.`, 'amber');
      }
      if (state.ai.worktreeActive && state.ai.worktreeBranch === branchName) {
        return commandNotice(state, cmd, '이미 작업 폴더가 있어요',
          `${dirName} 작업 폴더와 ${branchName} 브랜치가 이미 준비돼 있어요. ai code로 다음 단계를 진행하세요.`, 'mint');
      }

      const baseCommit = state.branches[state.headBranch] ?? state.branches.main ?? 'c1';
      const draft: PixelSimState = {
        ...state,
        branches: { ...state.branches, [branchName]: baseCommit },
        ai: {
          ...state.ai,
          worktreeActive: true,
          worktreeBranch: branchName,
          worktreeDir: dirName,
        },
      };
      const defaultNote = explicitDir === undefined
        ? ' (실습에서는 폴더 이름을 wt-ai로 가정했어요.)'
        : '';

      return finalizeTransition(
        state,
        draft,
        'AI_WORKTREE',
        `작업 폴더 ${dirName} 생성`,
        branchName,
        cmd,
        [
          { text: `Preparing worktree (new branch '${branchName}') (새 작업 폴더와 브랜치 준비 중)${defaultNote}`, tone: 'sky' },
          { text: `🏗️ 새 작업 폴더 './${dirName}'에서 ${branchName} 브랜치를 사용해요.`, tone: 'mint' },
        ],
        makeBubble(
          `worktree-${seqNext}`,
          'ai',
          66,
          52,
          `AI 작업 폴더(${dirName})를 열었어요`,
          `${dirName} 폴더에서 ${branchName} 브랜치의 파일을 편집할 수 있어요. 폴더 이름(${dirName})과 브랜치 이름(${branchName})은 서로 달라요. 두 작업 폴더는 같은 저장소의 커밋 기록을 공유해요.`,
          'ai code를 입력해서 AI가 코드를 수정하도록 시켜 보세요.',
          [{ label: '덧셈 오류 고치기', command: 'ai code', tone: 'mint' }],
        ),
      );
    }
  }

  // ── GitHub CLI (gh) commands ─────────────────────────────────────────────
  if (tokens[0]?.toLowerCase() === 'gh') {
    const sub = (tokens[1] ?? '').toLowerCase();
    const sub2 = (tokens[2] ?? '').toLowerCase();

    // gh auth status / login
    if (sub === 'auth') {
      if (sub2 === 'status') {
        if (state.stageId === 'ch7' && !state.ghes.connected) {
          return finalizeTransition(
            state,
            state,
            'IDLE',
            '사내 로그인 전',
            state.ghes.host,
            cmd,
            [
              { text: state.ghes.host, tone: 'sky' },
              { text: `  ✗ Not logged in to ${state.ghes.host} — 사내 GitHub 로그인이 필요해요.`, tone: 'amber' },
              { text: `  → gh auth login --hostname ${state.ghes.host} 로 로그인하세요.`, tone: 'muted' },
            ],
            makeBubble(
              `gh-auth-missing-${seqNext}`,
              'guard',
              54,
              48,
              '아직 사내 GitHub에 로그인하지 않았어요',
              'VPN이 연결돼 있어도 사내 GHES 계정 인증은 따로 필요해요. --hostname으로 사내 서버를 지정해 로그인하세요.',
              `gh auth login --hostname ${state.ghes.host}를 실행해 보세요.`,
              [{ label: '사내 서버 로그인', command: `gh auth login --hostname ${state.ghes.host}`, tone: 'primary' }],
            ),
          );
        }
        const draft: PixelSimState = {
          ...state,
          completedActions: withCompletedAction(state.completedActions, 'AUTH_STATUS'),
        };
        const lines: TerminalLine[] = [
          { text: `${state.ghHost}`, tone: 'sky' },
          { text: `  ✓ Logged in to ${state.ghHost} account ${state.ghUser} (로그인 완료)`, tone: 'mint' },
          { text: `  ✓ Git operations protocol: ${state.token.sshReady ? 'ssh' : 'https'} (연결 방식)`, tone: 'default' },
          ...scopeLines(state.token.scopes, state.token.expires).map((text): TerminalLine => ({ text, tone: 'muted' })),
        ];
        const nextStep = getNextPendingStep(draft);

        return finalizeTransition(
          state,
          draft,
          'GH_CMD',
          'gh 인증 상태 확인',
          state.ghUser,
          cmd,
          lines,
          makeBubble(
            `gh-auth-status-${seqNext}`,
            'cloud',
            66,
            48,
            `인증 초록불! @${state.ghUser} 🔑`,
            `${state.ghHost}에 정상 로그인되어 있어요. 이제 브라우저 없이도 PR과 이슈를 다룰 수 있어요!`,
            nextStepHintText(draft),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
              : undefined,
          ),
        );
      }

      if (sub2 === 'login') {
        const hasWithToken = tokens.includes('--with-token');
        const hostRaw = extractQuotedFlag(cmd, ['--hostname', '-h']);
        const host = hostRaw?.trim().toLowerCase();

        if (state.stageId === 'ch7') {
          if (!host) {
            return finalizeTransition(
              state, state, 'IDLE', '사내 호스트가 필요해요', undefined, cmd,
              [
                { text: 'error: 사내 GHES에는 --hostname으로 접속할 서버 주소가 필요해요. (--with-token만으로는 사내 로그인이 되지 않아요)', tone: 'amber' },
                { text: `→ gh auth login --hostname ${state.ghes.host}`, tone: 'muted' },
              ],
              makeBubble(
                `ghes-login-need-host-${seqNext}`, 'guard', 54, 48, '사내 서버 주소를 함께 적어 주세요',
                '사내 GitHub는 github.com이 아니라 회사가 운영하는 별도 서버예요. --hostname으로 주소를 지정해야 로그인할 수 있어요.',
                `gh auth login --hostname ${state.ghes.host}를 실행해 보세요.`,
                [{ label: '올바른 명령 실행', command: `gh auth login --hostname ${state.ghes.host}`, tone: 'primary' }],
              ),
            );
          }
          if (host === 'github.com' || host.endsWith('.github.com')) {
            return finalizeTransition(
              state, state, 'IDLE', '외부 호스트는 차단돼요', undefined, cmd,
              [
                { text: `error: ${host}은(는) 회사 방화벽이 막는 외부 주소예요.`, tone: 'coral' },
                { text: `→ 사내 호스트 ${state.ghes.host}로 다시 로그인하세요.`, tone: 'amber' },
              ],
              makeBubble(
                `ghes-login-external-${seqNext}`, 'guard', 54, 48, '외부 github.com에는 로그인할 수 없어요',
                '사내 방화벽이 외부 github.com 전송을 막아요. 회사가 운영하는 사내 GHES 주소를 사용해야 해요.',
                `gh auth login --hostname ${state.ghes.host}를 실행해 보세요.`,
                [{ label: '올바른 명령 실행', command: `gh auth login --hostname ${state.ghes.host}`, tone: 'primary' }],
              ),
            );
          }
          if (host !== state.ghes.host.toLowerCase()) {
            return finalizeTransition(
              state, state, 'IDLE', '호스트 주소를 확인하세요', undefined, cmd,
              [
                { text: `error: ${host} 호스트를 찾을 수 없어요. 이 예제의 사내 GitHub 주소는 ${state.ghes.host}예요.`, tone: 'amber' },
                { text: `→ gh auth login --hostname ${state.ghes.host}`, tone: 'muted' },
              ],
              makeBubble(
                `ghes-login-mismatch-${seqNext}`, 'guard', 54, 48, '사내 호스트 주소를 확인해 주세요',
                `오타가 있거나 다른 서버를 가리키고 있어요. 예제 회사의 사내 GitHub는 ${state.ghes.host}예요.`,
                `gh auth login --hostname ${state.ghes.host}를 실행해 보세요.`,
                [{ label: '올바른 명령 실행', command: `gh auth login --hostname ${state.ghes.host}`, tone: 'primary' }],
              ),
            );
          }

          const nextGhes: GhesWorldState = {
            ...state.ghes,
            host,
            connected: true,
            mode: 'ghes',
            lastFlow: 'vpn-ok',
            auditLogs: [
              ...state.ghes.auditLogs.slice(-5),
              `[ALLOW] VPN + SAML 로그인 성공 → ${host}`,
            ],
          };
          const draft: PixelSimState = {
            ...state,
            ghHost: host,
            ghes: nextGhes,
          };
          const afterCompleted = withCompletedAction(draft.completedActions, 'GHES_LOGIN');
          const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

          return finalizeTransition(
            state,
            draft,
            'GHES_LOGIN',
            '사내망 GHES 로그인',
            host,
            cmd,
            [
              { text: `예제 회사 VPN 연결 상태에서 ${host} 인증 중`, tone: 'sky' },
              { text: `✓ Logged in as ${state.ghUser} on ${host} (사내 서버 로그인 완료)`, tone: 'mint' },
            ],
            makeBubble(
              `ghes-login-${seqNext}`,
              'guard',
              54,
              48,
              '사내 GitHub에 로그인했어요',
              `--hostname으로 로그인할 서버를 ${host}로 지정했어요. VPN 연결은 이 실습의 시작 조건이에요.`,
              nextStepHintText({ ...draft, completedActions: afterCompleted }),
              nextStep
                ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
                : undefined,
            ),
          );
        }

        if (!hasWithToken) {
          return commandNotice(state, cmd, '실제 gh는 대화형으로 로그인해요',
            '실습에서는 gh auth login --with-token으로 토큰을 표준 입력에서 읽는 방식을 재현해요.', 'muted');
        }

        // Standard --with-token login (Ch6)
        const draft: PixelSimState = { ...state };
        return finalizeTransition(
          state,
          draft,
          'GH_CMD',
          '토큰 안전 로그인',
          '--with-token',
          cmd,
          [
            { text: '🔐 연습 계정의 인증 과정을 재현했어요.', tone: 'sky' },
            { text: `✓ Logged in to ${state.ghHost} as ${state.ghUser} (${state.token.mode})`, tone: 'mint' },
          ],
          makeBubble(
            `gh-login-token-${seqNext}`,
            'guard',
            56,
            48,
            '표준 입력으로 토큰을 안전하게 넘겨요',
            '--with-token은 토큰을 표준 입력으로 받아 화면·셸 기록에 남기지 않아요. 여기서는 연습 계정으로 인증 결과만 확인해요.',
            nextStepHintText(draft),
          ),
        );
      }
    }

    // gh repo view
    if (sub === 'repo' && sub2 === 'view') {
      const repoName = state.stageId === 'ch7' ? 'corp/payroll-core' : 'gitdots/app';
      return finalizeTransition(
        state,
        state,
        'GH_CMD',
        '저장소 정보 보기',
        repoName,
        cmd,
        [
          { text: `📦 ${repoName} — ${state.stageId === 'ch7' ? '사내 핵심 서비스 저장소' : '도트로 배우는 Git & GitHub 실습 앱'}`, tone: 'sky' },
          {
            text: `  • 기본 브랜치: main | 열린 PR: ${state.prs.filter((p) => p.status !== 'merged').length}개 | 열린 이슈: ${state.issues.filter((i) => i.status === 'open').length}개`,
            tone: 'default',
          },
        ],
        makeBubble(
          `gh-repo-${seqNext}`,
          'cloud',
          68,
          48,
          '저장소 요약 카드 도착! 📦',
          'gh repo view 한 줄이면 브라우저를 열지 않고도 저장소 설명과 현황을 바로 읽을 수 있어요!',
          nextStepHintText(state),
        ),
      );
    }

    // gh pr create / list / merge
    if (sub === 'pr') {
      if (sub2 === 'create') {
        const headBranch = state.headBranch;
        const baseBranch = 'main';
        // 기본 브랜치에서는 PR을 열 수 없어요. (main → main 빈 PR 방지)
        if (headBranch === baseBranch) {
          const createBranch = state.stageId === 'ch4' ? MEETING_PR_BRANCH : 'feat/my-change';
          return finalizeTransition(
            state, state, 'IDLE', '기본 브랜치에서는 PR을 열 수 없어요', undefined, cmd,
            [{ text: '⚠️ main에서 main으로는 PR을 열 수 없어요. 새 브랜치에서 변경을 기록한 뒤 PR을 열어요.', tone: 'amber' }],
            makeBubble(
              `pr-need-branch-${seqNext}`, 'cloud', 68, 48, '먼저 작업 브랜치를 만들어 주세요',
              'PR은 서로 다른 두 브랜치를 비교하는 제안이에요. 기본 브랜치(main) 자신과는 합칠 수 없어요.',
              `git switch -c ${createBranch}로 새 브랜치를 만들어 보세요.`,
              [{ label: '새 브랜치 만들기', command: `git switch -c ${createBranch}`, tone: 'primary' }],
            ),
          );
        }
        // 아직 GitHub에 올리지 않은 브랜치는 PR을 열 수 없어요.
        if (!treeEntry(state.remoteBranches, headBranch)) {
          return finalizeTransition(
            state, state, 'IDLE', '브랜치를 먼저 GitHub에 올려 주세요', undefined, cmd,
            [{ text: `⚠️ ${headBranch} 브랜치가 아직 GitHub에 없어요. push한 뒤 PR을 열 수 있어요.`, tone: 'amber' }],
            makeBubble(
              `pr-need-push-${seqNext}`, 'cloud', 68, 48, 'GitHub에 브랜치가 아직 없어요',
              'PR은 GitHub에 올라간 브랜치를 비교해요. 먼저 git push로 브랜치를 공유해 주세요.',
              `git push -u origin ${headBranch}를 실행해 보세요.`,
              [{ label: '브랜치 올리기', command: `git push -u origin ${headBranch}`, tone: 'primary' }],
            ),
          );
        }
        // main과 다른 커밋이 하나도 없으면 빈 PR이 돼요.
        const headTip = treeEntry(state.branches, headBranch);
        const baseTip = treeEntry(state.remoteBranches, baseBranch) ?? treeEntry(state.branches, baseBranch);
        const baseOfHead = headTip && baseTip ? mergeBase(state, baseTip, headTip) : undefined;
        if (!headTip || !baseTip || baseOfHead?.id === headTip) {
          return finalizeTransition(
            state, state, 'IDLE', '합칠 변경이 없어요', undefined, cmd,
            [{ text: `⚠️ ${headBranch} 브랜치에 main과 다른 새 커밋이 없어요. 변경을 기록한 뒤 PR을 열어 주세요.`, tone: 'amber' }],
            makeBubble(
              `pr-no-commit-${seqNext}`, 'cloud', 68, 48, '합칠 변경이 아직 없어요',
              'PR에는 main과 다른 새 커밋이 필요해요. 변경을 기록하고 push한 뒤 다시 시도해 주세요.',
              `git add → git commit -m "..." → git push 순서로 기록해 보세요.`,
            ),
          );
        }

        const title = extractQuotedFlag(cmd, ['--title', '-t']) ?? (state.stageId === 'ch4' ? MEETING_PR_TITLE : '새 기능 PR');
        // 같은 브랜치에서 이미 열린 PR이 있으면 중복으로 만들지 않아요.
        const existingPr = state.prs.find((pr) => pr.headBranch === headBranch && pr.baseBranch === baseBranch && pr.status !== 'merged');
        if (existingPr) {
          return finalizeTransition(
            state, state, 'IDLE', '이미 열린 PR이 있어요', undefined, cmd,
            [{ text: `PR #${existingPr.number}이 이미 ${headBranch} → ${baseBranch}로 열려 있어요. gh pr view로 확인하세요.`, tone: 'amber' }],
            makeBubble(
              `pr-existing-${seqNext}`, 'cloud', 68, 48, `이미 PR #${existingPr.number}이 열려 있어요`,
              '같은 브랜치의 PR을 또 만들면 검토가 중복돼요. 기존 PR을 확인하고 이어서 진행해요.',
              `gh pr view ${existingPr.number}로 확인해 보세요.`,
              [{ label: '기존 PR 확인', command: `gh pr view ${existingPr.number}`, tone: 'primary' }],
            ),
          );
        }
        const body = extractQuotedFlag(cmd, ['--body', '-b']) ?? undefined;
        const isDraft = tokens.includes('--draft') || tokens.includes('-d');
        const nextNum = state.prs.reduce((max, p) => Math.max(max, p.number), 0) + 1;
        const newPr: PixelPr = {
          number: nextNum,
          title,
          body,
          headBranch,
          baseBranch,
          status: isDraft ? 'draft' : 'open',
          ci: 'pass',
          approved: false,
        };
        const draft: PixelSimState = {
          ...state,
          prs: [...state.prs, newPr],
        };
        const lines: TerminalLine[] = [
          { text: `📋 Creating pull request for ${headBranch} into ${baseBranch}... (PR 작성 중)`, tone: 'sky' },
          { text: `✓ https://${state.ghHost}/gitdots/app/pull/${nextNum} — "${title}"`, tone: 'mint' },
          ...(body ? [{ text: `  본문: ${body}`, tone: 'default' as const }] : []),
          { text: '✅ 자동 검사(CI) 통과! (GitHub에 올라간 변경을 검사해요)', tone: 'mint' },
          ...(state.stageId === 'ch5' ? [{ text: '이 실습에서는 자동 검사가 바로 통과한 것으로 보여 줘요. gh run watch로 과정을 지켜볼 수 있어요.', tone: 'muted' as const }] : []),
        ];
        const previewState: PixelSimState = {
          ...draft,
          completedActions: withCompletedAction(draft.completedActions, 'PR_CREATE'),
        };
        const nextStep = getNextPendingStep(previewState);

        return finalizeTransition(
          state,
          draft,
          'PR_CREATE',
          `PR #${nextNum} 생성`,
          title,
          cmd,
          lines,
          makeBubble(
            `gh-pr-create-${seqNext}`,
            'cloud',
            68,
            48,
            `PR #${nextNum} 리뷰 요청서 도착! 📋`,
            `"${title}" PR이 열리고 자동 검사(문제 없는지 자동으로 확인하는 절차)도 통과했어요! 팀원에게 검토를 요청했으니, 팀원의 의견과 승인을 확인한 뒤 합쳐요.`,
            nextStepHintText(previewState),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
              : undefined,
          ),
        );
      }

      if (sub2 === 'view') {
        const requestedNumber = tokens.slice(3).map(Number).find((value) => Number.isSafeInteger(value) && value > 0);
        const targetPr = requestedNumber !== undefined
          ? state.prs.find((p) => p.number === requestedNumber)
          : [...state.prs].reverse().find((p) => p.status !== 'merged');
        if (!targetPr) {
          return commandNotice(state, cmd, '확인할 PR이 없어요',
            requestedNumber !== undefined
              ? `PR #${requestedNumber}을 찾을 수 없어요. gh pr list로 번호를 확인하세요.`
              : 'gh pr create로 검토를 요청한 뒤 팀원의 의견을 확인할 수 있어요.', 'amber');
        }
        const showComments = tokens.includes('--comments') || tokens.includes('-c');
        const isAiPr = state.stageId === 'ch8' && state.ai.prNumber === targetPr.number;
        const alreadyApproved = targetPr.approved;
        const canAutoApprove = targetPr.status === 'open' && !isAiPr;
        const comment = reviewCommentFor(state, targetPr);
        const speaker = reviewSpeaker(state);
        const draft: PixelSimState = {
          ...state,
          prs: canAutoApprove
            ? state.prs.map((p) => (p.number === targetPr.number ? { ...p, approved: true } : p))
            : state.prs,
          completedActions: withCompletedAction(state.completedActions, 'PR_REVIEW'),
        };
        const lines: TerminalLine[] = [
          { text: `📋 PR #${targetPr.number} ${targetPr.title} (${targetPr.headBranch} → ${targetPr.baseBranch})`, tone: 'sky' },
          ...(targetPr.body ? [{ text: `  본문: ${targetPr.body}`, tone: 'default' as const }] : []),
          { text: `  상태: ${targetPr.status === 'draft' ? '초안' : targetPr.status === 'merged' ? '병합됨' : '열림'} · 자동 검사: ${targetPr.ci === 'pass' ? '통과' : '대기'}`, tone: 'default' },
          ...(showComments
            ? [{ text: `  💬 ${speaker}: ${comment}`, tone: 'mint' as const }]
            : [{ text: '  (리뷰 의견까지 보려면 --comments를 붙여요)', tone: 'muted' as const }]),
          ...(targetPr.status === 'draft'
            ? [{ text: '  ⏳ 초안 PR이라 아직 승인·병합할 수 없어요. 먼저 검토 준비로 전환하세요.', tone: 'amber' as const }]
            : isAiPr
              ? [{ text: `  👤 사람 리뷰어(@${state.ghUser})가 ai approve로 직접 확인해야 해요.`, tone: 'amber' as const }]
              : [{ text: alreadyApproved ? '  ✅ 팀원 승인이 이미 있어요. 이제 합칠 수 있어요!' : '  ✅ 팀원이 변경을 검토하고 승인했어요!', tone: 'mint' as const }]),
        ];
        const nextStep = getNextPendingStep(draft);

        return finalizeTransition(
          state,
          draft,
          'GH_CMD',
          `PR #${targetPr.number} 검토 확인`,
          `${speaker} 승인`,
          cmd,
          lines,
          makeBubble(
            `gh-pr-view-${seqNext}`,
            'cloud',
            68,
            48,
            targetPr.status === 'draft' ? '초안 PR이라 바로 합칠 수 없어요' : isAiPr ? '사람의 직접 승인이 필요해요' : '팀원 검토가 도착했어요 ✅',
            targetPr.status === 'draft'
              ? '초안 PR은 검토 준비로 전환해야 승인·병합할 수 있어요.'
              : isAiPr
                ? 'AI가 연 PR은 사람이 변경을 직접 확인하고 ai approve로 승인해야 해요.'
                : canAutoApprove
                  ? `팀원 ${speaker}가 바뀐 줄을 확인하고 “${comment}” 의견을 남기며 승인했어요. 승인을 확인한 변경만 합치는 것이 안전해요.`
                  : `${speaker}의 검토 의견을 확인했어요.`,
            nextStepHintText(draft),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
              : undefined,
          ),
        );
      }

      if (sub2 === 'list') {
        const statusLabel: Record<PixelPr['status'], string> = { open: '열림', draft: '초안', merged: '병합됨' };
        const ciLabel: Record<PixelPr['ci'], string> = { pending: '대기', running: '진행 중', pass: '통과' };
        const openCount = state.prs.filter((p) => p.status !== 'merged').length;
        const lines: TerminalLine[] =
          state.prs.length === 0
            ? [{ text: '열린 PR이 없어요.', tone: 'muted' }]
            : state.prs.map((p) => ({
                text: `#${p.number} [${statusLabel[p.status]}] ${p.title} (${p.headBranch} → ${p.baseBranch}) CI:${ciLabel[p.ci]}`,
                tone: p.status === 'merged' ? 'lavender' : 'mint',
              }));
        return finalizeTransition(
          state,
          state,
          'GH_CMD',
          'PR 목록 조회',
          `${state.prs.length}건`,
          cmd,
          lines,
          makeBubble(
            `gh-pr-list-${seqNext}`,
            'cloud',
            68,
            48,
            `현재 PR 목록 (열림 ${openCount}건 / 전체 ${state.prs.length}건) 📑`,
            '열린 PR과 병합된 PR을 함께 보여 줘요. CI 상태도 터미널에서 바로 확인할 수 있어요.',
            nextStepHintText(state),
          ),
        );
      }

      if (sub2 === 'merge') {
        const requestedNumber = tokens.slice(3).map(Number).find((value) => Number.isSafeInteger(value) && value > 0);
        const targetPr = requestedNumber !== undefined
          ? state.prs.find((p) => p.number === requestedNumber)
          : [...state.prs].reverse().find((p) => p.status !== 'merged');
        if (!targetPr) {
          const createCommand = STAGE_MAP[state.stageId].steps.find((step) => step.command.startsWith('gh pr create'))?.command ?? 'gh pr create';
          return finalizeTransition(
            state,
            state,
            'IDLE',
            '합칠 PR 없음',
            undefined,
            cmd,
            [{ text: requestedNumber !== undefined ? `PR #${requestedNumber}을 찾을 수 없어요.` : '합칠 열린 PR이 없어요. 먼저 gh pr create로 PR을 열어 주세요.', tone: 'amber' }],
            makeBubble(
              `gh-pr-merge-empty-${seqNext}`,
              'cloud',
              68,
              48,
              '아직 열려 있는 PR이 없어요! 📋',
              '먼저 gh pr create로 검토를 요청한 뒤 합쳐 볼까요?',
              `${createCommand} 명령을 실행해 보세요.`,
              [
                {
                  label: '검토 요청하기',
                  command: createCommand,
                  tone: 'primary',
                },
              ],
            ),
          );
        }

        if (targetPr.status === 'merged') {
          return commandNotice(state, cmd, '이미 병합된 PR이에요',
            `PR #${targetPr.number}은 이미 GitHub의 main에 합쳐졌어요. gh pr list로 다른 PR을 확인하세요.`, 'mint');
        }
        if (targetPr.status === 'draft') {
          const aiDraft = state.stageId === 'ch8' && state.ai.prNumber === targetPr.number;
          return finalizeTransition(
            state, state, 'IDLE', '초안 PR은 바로 합칠 수 없어요', undefined, cmd,
            [{ text: '초안(draft) PR은 검토 준비로 전환해야 승인·병합할 수 있어요.', tone: 'amber' }],
            makeBubble(
              `gh-pr-merge-draft-${seqNext}`, 'cloud', 68, 48, '초안 PR은 아직 합칠 수 없어요',
              '초안은 작성 중인 제안이라 실수로 합쳐지지 않도록 잠겨 있어요. 검토 준비 상태로 바꾼 뒤 승인받아요.',
              aiDraft ? 'ai ready로 검토 준비 상태로 전환해 보세요.' : 'PR을 검토 준비(Ready for review)로 전환한 뒤 다시 시도하세요.',
              aiDraft ? [{ label: '검토 준비로 전환', command: 'ai ready', tone: 'primary' }] : undefined,
            ),
          );
        }

        if (!targetPr.approved) {
          return finalizeTransition(
            state,
            state,
            'IDLE',
            '승인 확인 필요',
            undefined,
            cmd,
            [{ text: 'error: Review required — 팀원 승인을 확인한 뒤 합칠 수 있어요.', tone: 'amber' }],
            makeBubble(
              `gh-pr-merge-unapproved-${seqNext}`,
              'cloud',
              68,
              48,
              '팀원 승인을 먼저 확인하세요',
              '이 PR은 아직 팀원 승인이 없어요. gh pr view로 팀원의 검토 의견과 승인을 확인한 뒤 합쳐 주세요.',
              'gh pr view --comments 명령을 실행해 보세요.',
              [{ label: '팀원 승인 확인하기', command: 'gh pr view --comments', tone: 'primary' }],
            ),
          );
        }

        // GitHub에 올라가지 않은 브랜치는 로컬 사본으로 대신 병합하지 않아요.
        const remotePrHead = treeEntry(state.remoteBranches, targetPr.headBranch);
        if (!remotePrHead) {
          return finalizeTransition(
            state, state, 'IDLE', '브랜치를 먼저 GitHub에 올려 주세요', undefined, cmd,
            [{ text: `⚠️ ${targetPr.headBranch} 브랜치가 GitHub에 없어요. PR을 합치려면 먼저 push해야 해요.`, tone: 'amber' }],
            makeBubble(
              `gh-pr-merge-no-remote-${seqNext}`, 'cloud', 68, 48, 'GitHub에 브랜치가 없어요',
              'PR은 GitHub에 있는 브랜치를 합쳐요. 로컬 브랜치만으로는 합칠 수 없어요.',
              `git push -u origin ${targetPr.headBranch}를 실행해 보세요.`,
              [{ label: '브랜치 올리기', command: `git push -u origin ${targetPr.headBranch}`, tone: 'primary' }],
            ),
          );
        }

        const mainHead = state.remoteBranches.main ?? state.branches.main ?? 'c1';
        const prHead = remotePrHead;
        const result = mergeTrees(
          mergeBase(state, mainHead, prHead)?.tree ?? {},
          commitById(state, mainHead)?.tree ?? {},
          commitById(state, prHead)?.tree ?? {},
        );
        if (result.conflicts.length > 0) {
          return commandNotice(state, cmd, 'PR에 충돌이 있어요', `${result.conflicts.join(', ')}의 변경을 확인하세요.`, 'amber');
        }
        if (changedPaths(commitById(state, mainHead)?.tree ?? {}, result.tree).length === 0) {
          return commandNotice(state, cmd, '합칠 변경이 없어요',
            `PR #${targetPr.number}에 main과 다른 변경이 없어요. gh pr list로 다른 PR을 확인하세요.`, 'amber');
        }
        const mergeId = `c${state.commits.length + 1}`;
        const mergeCommit: PixelCommit = {
          id: mergeId,
          hash: makeHash(seqNext, `gh-merge-${targetPr.number}`),
          message: `Merge PR #${targetPr.number}: ${targetPr.title}`,
          branch: 'main',
          parents: [mainHead, prHead],
          tree: result.tree,
          isMerge: true,
        };

        const nextPrs: PixelPr[] = state.prs.map((p) =>
          p.number === targetPr.number
            ? { ...p, status: 'merged', approved: true, ci: 'pass' }
            : p,
        );
        const aiPr = state.stageId === 'ch8' && state.ai.prNumber === targetPr.number;

        const draft: PixelSimState = {
          ...state,
          commits: [...state.commits, mergeCommit],
          remoteBranches: { ...state.remoteBranches, main: mergeId },
          prs: nextPrs,
          ...(aiPr
            ? { ai: { ...state.ai, humanApproved: true, merged: true } }
            : {}),
        };
        const mergeFollowUp = state.stageId === 'ch4'
          ? '아직 내 컴퓨터의 main은 옛날 상태라, 이제 main으로 돌아가 git pull로 합친 내용을 가져와요.'
          : state.stageId === 'ch5'
            ? '이 PR은 6장의 실습 대상이 아니라 탐색용이에요. 이 장의 남은 단계는 노란 버튼을 따라 계속 진행해요.'
            : state.stageId === 'ch8'
              ? 'GitHub의 main에 합쳐졌어요. 내 컴퓨터의 main은 git pull로 따로 가져와요.'
              : 'GitHub의 main에 합쳐졌어요.';

        return finalizeTransition(
          state,
          draft,
          'PR_MERGE',
          `PR #${targetPr.number} 합치기`,
          mergeCommit.hash,
          cmd,
          [
            { text: `✓ Merged pull request #${targetPr.number} (${targetPr.title}) — PR #${targetPr.number} 병합 완료`, tone: 'mint' },
            { text: `🎉 GitHub의 main 브랜치에 깔끔하게 반영되었어요! (${mergeCommit.hash})`, tone: 'lavender' },
          ],
          makeBubble(
            `gh-pr-merge-${seqNext}`,
            'cloud',
            68,
            48,
            `PR #${targetPr.number} 합치기 완료! 🎊`,
            `"${targetPr.title}" 변경이 GitHub의 main에 합쳐졌어요! ${mergeFollowUp}`,
            nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'PR_MERGE') }),
          ),
        );
      }
    }

    // gh issue create / list
    if (sub === 'issue') {
      if (sub2 === 'create') {
        const title = extractQuotedFlag(cmd, ['--title', '-t']) ?? '버그 수정';
        // 실제 GitHub처럼 이슈와 PR이 같은 번호를 이어서 써요.
        const nextNum = nextSharedNumber(state);
        const newIssue: PixelIssue = { number: nextNum, title, status: 'open' };
        const draft: PixelSimState = {
          ...state,
          issues: [...state.issues, newIssue],
          completedActions: withCompletedAction(state.completedActions, 'ISSUE_CREATE'),
        };
        const lines: TerminalLine[] = [
          { text: `📌 Creating issue in gitdots/app... (이슈 등록 중)`, tone: 'sky' },
          { text: `✓ https://${state.ghHost}/gitdots/app/issues/${nextNum} — "${title}"`, tone: 'mint' },
        ];
        const nextStep = getNextPendingStep(draft);

        return finalizeTransition(
          state,
          draft,
          'GH_CMD',
          `이슈 #${nextNum} 등록`,
          title,
          cmd,
          lines,
          makeBubble(
            `gh-issue-${seqNext}`,
            'cloud',
            68,
            48,
            `이슈 #${nextNum} 카드가 붙었어요! 📌`,
            `"${title}" 할 일이 팀 이슈 보드에 바로 등록됐어요. 버그 제보나 기능 제안도 한 줄이면 끝!`,
            nextStepHintText(draft),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
              : undefined,
          ),
        );
      }

      if (sub2 === 'list') {
        const lines: TerminalLine[] =
          state.issues.length === 0
            ? [{ text: '열린 이슈가 없어요.', tone: 'muted' }]
            : state.issues.map((i) => ({
                text: `#${i.number} [${i.status.toUpperCase()}] ${i.title}`,
                tone: 'sky',
              }));
        return finalizeTransition(
          state,
          state,
          'GH_CMD',
          '이슈 목록 조회',
          `${state.issues.length}건`,
          cmd,
          lines,
          makeBubble(
            `gh-issue-list-${seqNext}`,
            'cloud',
            68,
            48,
            `팀 이슈 보드 (${state.issues.length}건) 📌`,
            '해야 할 작업과 버그 목록을 터미널에서 바로 확인했어요!',
            nextStepHintText(state),
          ),
        );
      }
    }

    // gh run watch / list
    if (sub === 'run') {
      if (sub2 === 'list') {
        const openPr = [...state.prs].reverse().find((p) => p.status === 'open');
        return finalizeTransition(
          state, state, 'GH_CMD', '자동 검사 목록', '1건', cmd,
          [
            { text: 'CI Build & Test  (feat/darkmode)  ✓ 통과', tone: 'mint' },
            ...(openPr ? [{ text: `PR #${openPr.number} 검사  ✓ ${openPr.ci === 'pass' ? '통과' : '진행 중'}`, tone: 'default' as const }] : []),
          ],
          makeBubble(`gh-run-list-${seqNext}`, 'cloud', 68, 48, '최근 자동 검사 목록이에요',
            '이 실습에서는 gh run watch로 검사 과정을 지켜봐요.', nextStepHintText(state)),
        );
      }
      if (sub2 !== 'watch') {
        return commandNotice(state, cmd, '이 실습에서는 gh run watch를 써요',
          'gh run list로 목록을 보거나, gh run watch로 검사를 지켜볼 수 있어요.', 'muted');
      }
      const targetBranch = state.headBranch;
      const targetCommit = commitById(state, state.branches[targetBranch]);
      const draft: PixelSimState = {
        ...state,
        completedActions: withCompletedAction(state.completedActions, 'RUN_WATCH'),
      };
      return finalizeTransition(
        state,
        draft,
        'GH_CMD',
        '자동 검사 지켜보기',
        'PASS',
        cmd,
        [
          { text: `🔄 ${targetBranch}(${targetCommit?.hash ?? 'HEAD'})의 변경을 검사해요 — workflow "CI Build & Test"`, tone: 'sky' },
          { text: '  · Checkout code — 대기 → 실행 → ✓ (1s) 코드 가져오기', tone: 'default' },
          { text: '  · Install & Typecheck — 대기 → 실행 → ✓ (3s) 설치·형식 검사', tone: 'mint' },
          { text: '  · Run Unit Tests — 대기 → 실행 → ✓ (2s) 단위 테스트 통과', tone: 'mint' },
        ],
        makeBubble(
          `gh-run-${seqNext}`,
          'cloud',
          68,
          48,
          '자동 검사(CI) 모두 통과! ✅',
          `feat/darkmode 브랜치의 코드 변경(다크 모드 CSS)을 GitHub Actions가 빌드·테스트했어요. 검사 대상과 단계별 진행을 터미널에서 확인할 수 있어요.`,
          nextStepHintText(draft),
        ),
      );
    }

    // gh api
    if (sub === 'api') {
      const hostRaw = extractQuotedFlag(cmd, ['--hostname']);
      const hostname = (hostRaw ?? state.ghHost).trim().toLowerCase();
      const endpoint = tokens.slice(2).find((token) => !token.startsWith('-') && token !== hostRaw)?.replace(/^\//, '') ?? '';
      // Also accept the full REST path used by older versions of the lesson.
      const legacyGhesPath = /^api\/v3\/user\/?$/.test(endpoint);
      const apiPath = endpoint;
      const ghesUserCall = apiPath === 'user' || legacyGhesPath;

      if (state.stageId === 'ch7' && ghesUserCall && hostname !== state.ghes.host.toLowerCase()) {
        return finalizeTransition(
          state, state, 'IDLE', '서버 주소가 달라요', undefined, cmd,
          [
            { text: `⚠️ 로그인한 서버(${state.ghes.host})와 요청 주소(${hostname})가 달라요.`, tone: 'amber' },
            { text: `→ gh auth login --hostname ${state.ghes.host}로 다시 로그인한 뒤 gh api user --hostname ${state.ghes.host}를 실행하세요.`, tone: 'muted' },
          ],
          makeBubble(
            `ghes-api-mismatch-${seqNext}`, 'guard', 54, 48, '로그인한 서버와 요청 주소가 달라요',
            '사내 GitHub는 로그인한 호스트와 같은 주소로 API를 호출해야 해요. 주소를 맞춰 다시 로그인해 주세요.',
            `gh auth login --hostname ${state.ghes.host}로 다시 로그인해 보세요.`,
            [{ label: '사내 서버 다시 로그인', command: `gh auth login --hostname ${state.ghes.host}`, tone: 'primary' }],
          ),
        );
      }

      if (hostname === state.ghes.host.toLowerCase() && ghesUserCall) {
        if (state.stageId === 'ch7' && !state.ghes.connected) {
          const nextGhes: GhesWorldState = {
            ...state.ghes,
            lastFlow: 'unauth',
            auditLogs: [
              ...state.ghes.auditLogs.slice(-5),
              '[DENY] 미인증 /api/v3 호출 — VPN은 연결됐지만 사내 GitHub 로그인 전',
            ],
          };
          const draft: PixelSimState = { ...state, ghes: nextGhes };
          return finalizeTransition(
            state,
            draft,
            'GHES_UNAUTH',
            '사내 인증 필요',
            '401',
            cmd,
            [
              { text: `HTTP 401 Unauthorized (인증 실패 · 인증 필요) — ${state.ghes.host} 로그인이 필요해요!`, tone: 'coral' },
              { text: '방화벽 차단(403)이 아니라, VPN은 연결됐지만 사내 계정 인증(SSO/SAML)을 마치지 않은 상태예요.', tone: 'amber' },
            ],
            makeBubble(
              `ghes-api-unauth-${seqNext}`,
              'guard',
              54,
              48,
              '먼저 사내망 로그인을 해 주세요! 🔒',
              '사내 GHES API는 VPN + SAML(회사 통합 로그인, SSO)을 마친 직원만 호출할 수 있어요. 방화벽이 막은 것이 아니라 인증이 필요한 상태예요.',
              `gh auth login --hostname ${state.ghes.host}로 먼저 로그인해 보세요.`,
              [
                {
                  label: '🔓 사내망 로그인',
                  command: `gh auth login --hostname ${state.ghes.host}`,
                  tone: 'primary',
                },
              ],
            ),
          );
        }

        const apiUrl = `https://${state.ghes.host}/api/v3/user`;
        const nextGhes: GhesWorldState = {
          ...state.ghes,
          mode: 'ghes',
          lastFlow: 'api-v3',
          auditLogs: [
            ...state.ghes.auditLogs.slice(-5),
            `[API] GET ${apiUrl} → 200 OK`,
          ],
        };
        const draft: PixelSimState = { ...state, ghes: nextGhes };
        const afterCompleted = withCompletedAction(draft.completedActions, 'GHES_API');
        const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

        return finalizeTransition(
          state,
          draft,
          'GHES_API',
          '사내 서버에서 계정 정보 확인',
          '200 OK',
          cmd,
          [
            { text: `GET ${apiUrl}`, tone: 'sky' },
            { text: `{ "login": "${state.ghUser}", "enterprise": "GitDots Corp", "plan": "GHES" }`, tone: 'mint' },
          ],
          makeBubble(
            `ghes-api-${seqNext}`,
            'cloud',
            68,
            48,
            '사내 전용 /api/v3 응답 도착! 📡',
            `사내 GitHub는 API 주소 앞에 /api/v3가 붙어요. gh api user가 이 서버 주소와 user 경로를 합쳐 계정 정보를 요청했어요. 응답의 login 값으로 현재 계정(${state.ghUser})을 확인했어요. 전체 응답은 아래 터미널에서 볼 수 있어요.`,
            nextStepHintText({ ...draft, completedActions: afterCompleted }),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
              : undefined,
          ),
        );
      }

      if (hostname !== 'github.com' || apiPath !== 'repos/gitdots/app') {
        const example = state.stageId === 'ch7' ? `gh api user --hostname ${state.ghes.host}` : 'gh api repos/gitdots/app';
        return finalizeTransition(
          state, state, 'IDLE', '예제 경로 확인', undefined, cmd,
          [{ text: `연습할 수 있는 API 명령은 ${example}예요.`, tone: 'muted' }],
          makeBubble(`api-example-${seqNext}`, 'cloud', 68, 48, '실습용 주소를 확인해 주세요',
            '이 장에 준비된 예제 데이터를 조회해 보세요.', example),
        );
      }

      const lines: TerminalLine[] = [
        { text: `GET https://api.github.com/${apiPath}`, tone: 'sky' },
        {
          text: `{ "full_name": "gitdots/app", "default_branch": "main", "open_issues_count": ${state.issues.filter((i) => i.status === 'open').length + state.prs.filter((p) => p.status !== 'merged').length} }`,
          tone: 'mint',
        },
        { text: '  (실습용 단순화 응답이에요. 실제 GitHub API의 open_issues_count는 이슈와 PR을 합쳐 세요.)', tone: 'muted' },
      ];
      const draft: PixelSimState = {
        ...state,
        completedActions: withCompletedAction(state.completedActions, 'REPO_API'),
      };

      return finalizeTransition(
        state,
        draft,
        'GH_CMD',
        'GitHub API 호출',
        endpoint,
        cmd,
        lines,
        makeBubble(
          `gh-api-${seqNext}`,
          'cloud',
          68,
          48,
          'GitHub API JSON 응답 도착! 📡',
          '저장소 정보를 받았어요! 저장소 이름(full_name)은 gitdots/app, 기본 브랜치(default_branch)는 main이에요. open_issues_count는 이슈와 PR을 합친 수예요. 전체 데이터(JSON)는 아래 터미널을 열어 볼 수 있어요.',
          nextStepHintText(draft),
        ),
      );
    }
  }

  // ── Friendly fallback for unknown commands ───────────────────────────────
  const nextStep = getNextPendingStep(state);
  // 문서 모드가 아니어도 git 오타는 가장 가까운 명령을 찾아 한 번에 고칠 수 있게 해요.
  if (tokens[0]?.toLowerCase() === 'git' && tokens[1]) {
    const sub = tokens[1].toLowerCase();
    const candidates = new Set<string>();
    for (const item of GENERAL_CATALOG) {
      const [program, candidate] = item.cmd.split(' ');
      if (program === 'git' && candidate) candidates.add(candidate);
    }
    for (const step of STAGE_MAP[state.stageId].steps) {
      const [program, candidate] = step.command.split(' ');
      if (program === 'git' && candidate) candidates.add(candidate);
    }
    candidates.delete(sub);
    const suggestion = closestCommand(sub, candidates);
    if (suggestion) {
      return finalizeTransition(
        state, state, 'IDLE', '명령어 오타 안내', undefined, cmd,
        [{ text: `어라, 'git ${sub}'는 아직 모르는 말이에요. git ${suggestion}를 찾으셨나요?`, tone: 'amber' }],
        makeBubble(
          `typo-${seqNext}`, 'buddy', 38, 54, '어라, 모르는 명령어예요! 🤔',
          `git ${sub}는 아직 모르는 말이에요. git ${suggestion}를 찾으셨나요? 위쪽의 노란 버튼을 누르거나 help를 입력해 보세요.`,
          undefined,
          [{ label: `git ${suggestion}`, command: `git ${suggestion}`, tone: 'primary' }],
        ),
      );
    }
  }
  const fallbackActions: BubbleAction[] = [];
  if (nextStep) {
    fallbackActions.push({
      label: `✨ 추천: ${nextStep.command}`,
      command: nextStep.command,
      tone: 'mint',
    });
  }
  fallbackActions.push({ label: '📖 도움말 (help)', command: 'help', tone: 'primary' });

  return finalizeTransition(
    state,
    state,
    'IDLE',
    '알 수 없는 명령',
    cmd,
    cmd,
    [
      { text: `어라, '${cmd}' 명령어는 아직 모르는 말이에요!`, tone: 'coral' },
      {
        text: nextStep
          ? '위쪽의 노란 추천 버튼을 누르거나 help를 입력해 사용 가능한 명령어를 확인해 보세요.'
          : '이 장은 모두 마쳤어요. help를 입력하거나 명령어 사전에서 사용 가능한 명령어를 확인해 보세요.',
        tone: 'muted',
      },
    ],
    makeBubble(
      `unknown-${seqNext}`,
      'buddy',
      38,
      54,
      '어라, 모르는 명령어예요! 🤔',
      nextStep
        ? '위쪽의 노란 추천 버튼을 누르거나 help를 입력해 사용 가능한 명령을 확인해 보세요.'
        : '이 장은 모두 마쳤어요. help를 입력하거나 명령어 사전에서 사용 가능한 명령을 확인해 보세요.',
      nextStepHintText(state),
      fallbackActions,
    ),
  );
}

const GENERAL_CATALOG: { cmd: string; hint: string }[] = [
  { cmd: 'git status', hint: '작업 파일과 스테이징 상태 보기' },
  { cmd: 'edit 회의록.md', hint: '회의록에 예시 문장 추가하기' },
  { cmd: 'git add .', hint: '변경을 다음 커밋에 담기' },
  { cmd: 'git commit -m "모임 시간 수정, 참석 안내 추가"', hint: '무엇을 바꿨는지 적어 커밋 남기기' },
  { cmd: 'git push', hint: '팀의 GitHub 저장소에 공유하기' },
  { cmd: 'git log', hint: '커밋 타임라인 기록 보기' },
  { cmd: 'git show HEAD:회의록.md', hint: '최근 커밋에 기록된 파일 내용 보기' },
  { cmd: 'git diff', hint: '수정 전후 차이 비교하기' },
  { cmd: 'git diff HEAD', hint: '최근 커밋과 작업 파일 비교하기' },
  { cmd: 'git diff main ai/fix', hint: 'AI 브랜치의 코드 변경 비교하기' },
  { cmd: 'git stash', hint: '작업 중인 변경 임시 보관하기' },
  { cmd: 'git stash list', hint: '임시 보관 항목 목록 보기' },
  { cmd: 'git stash pop', hint: '임시 보관한 작업 복원하기' },
  { cmd: 'git revert HEAD', hint: '기록을 남기며 안전하게 취소' },
  { cmd: 'git reset --soft HEAD~1', hint: '커밋만 한 칸 되감기' },
  { cmd: 'git branch', hint: '브랜치 목록 보기' },
  { cmd: 'git branch -d docs/meeting', hint: '합친 브랜치 정리하기' },
  { cmd: 'git switch -c feat/dark', hint: '새 브랜치 만들고 이동하기' },
  { cmd: 'git switch main', hint: 'main 브랜치로 이동하기' },
  { cmd: 'git merge feat/ui', hint: 'feat/ui 합치기 (충돌 체험)' },
  { cmd: 'resolve both', hint: '충돌 해결: 둘 다 합치기' },
  { cmd: 'resolve ours', hint: '충돌 해결: 내 코드 유지' },
  { cmd: 'resolve theirs', hint: '충돌 해결: 상대 코드 채택' },
  { cmd: 'git commit', hint: '합친 결과를 커밋하기' },
  { cmd: 'git fetch', hint: '원격 GitHub 최신 소식 확인하기' },
  { cmd: 'git pull', hint: '원격 최신 커밋 받아 합치기' },
  { cmd: 'git pull origin main', hint: 'GitHub main의 최신 커밋 가져오기' },
  { cmd: 'git restore --staged', hint: '장바구니(스테이징)에서 변경 빼기' },
  { cmd: 'gh auth status', hint: 'gh CLI 로그인 상태 확인하기' },
  { cmd: 'gh auth login --hostname github.corp.internal', hint: '사내 GHES 서버 로그인' },
  { cmd: 'gh repo view', hint: '저장소 요약 보기' },
  { cmd: 'gh pr create', hint: '변경을 검토해 달라는 PR 열기' },
  { cmd: 'gh pr list', hint: 'PR 목록 보기' },
  { cmd: 'gh pr view', hint: 'PR의 팀원 검토·승인 확인하기' },
  { cmd: 'gh pr merge', hint: '승인을 확인한 PR을 main에 합치기' },
  { cmd: 'gh issue create --title "다크 모드에서 글자가 안 보여요"', hint: '버그 증상을 제목으로 적어 이슈 등록하기' },
  { cmd: 'gh issue list', hint: '이슈 목록 보기' },
  { cmd: 'gh run watch', hint: '자동 검사(CI) 실시간 지켜보기' },
  { cmd: 'gh api repos/gitdots/app', hint: 'GitHub REST API 조회하기' },
  { cmd: 'gh api user --hostname github.corp.internal', hint: '사내 GitHub 계정 정보 조회' },
  { cmd: 'token classic', hint: '예제 classic 토큰의 권한 확인' },
  { cmd: 'token fine', hint: 'Fine-Grained 최소 권한 토큰' },
  { cmd: 'token sso', hint: '회사 계정으로 조직 인증하기' },
  { cmd: 'token ssh', hint: 'SSH 암호화 키 인증 설정' },
  { cmd: 'token leak-test', hint: '비밀 정보 유출 차단 확인하기' },
  { cmd: 'gh auth login --with-token', hint: '표준 입력으로 안전 토큰 로그인' },
  { cmd: 'ghes test-public', hint: '사내 방화벽 외부 차단 확인하기' },
  { cmd: 'ghes runner', hint: '사내 실행기로 자동 빌드하기' },
  { cmd: 'ghes cloud', hint: 'Cloud vs GHES 비교 보기' },
  { cmd: 'git worktree add -b ai/fix wt-ai', hint: 'AI 브랜치의 별도 작업 폴더 만들기' },
  { cmd: 'git worktree list', hint: '작업 폴더 목록 보기' },
  { cmd: 'ai code', hint: 'AI가 버그 수정 코드 작성' },
  { cmd: 'ai push-main', hint: '브랜치 보호 규칙으로 직접 공유 차단 확인하기' },
  { cmd: 'ai pr', hint: 'AI 초안 PR의 자동 검사 결과 보기' },
  { cmd: 'ai ready', hint: '초안 PR을 검토 준비로 전환하기' },
  { cmd: 'ai approve', hint: '사람이 검토하고 승인한 변경 합치기' },
  { cmd: 'help', hint: '현재 스테이지 도움말 보기' },
  { cmd: 'clear', hint: '터미널 화면 비우기' },
  { cmd: 'reset', hint: '현재 스테이지 처음부터 다시' },
];

// 지금 장에서 실제로 배우는 명령만 자동완성에 올려, 후속 장 명령이 무여과 제안되지 않게 해요.
const SAFE_VIEW_COMMANDS = new Set(['git status', 'git log', 'git diff', 'git show', 'help', 'clear', 'reset']);

function allowedCatalogFor(state: PixelSimState): Set<string> {
  const scenario = STAGE_MAP[state.stageId];
  const allowed = new Set<string>([
    ...scenario.steps.map((step) => step.command),
    ...scenario.chips.map((chip) => chip.command),
    ...scenario.cheatSheet.map((item) => item.cmd),
    ...SAFE_VIEW_COMMANDS,
  ]);
  return allowed;
}

export function getCommandAutocomplete(
  partial: string,
  state: PixelSimState,
): { cmd: string; hint: string }[] {
  const q = partial.trim().toLowerCase();
  const scenario = STAGE_MAP[state.stageId];

  const prioritized: { cmd: string; hint: string }[] = [];
  const seen = new Set<string>();

  const pushUnique = (cmd: string, hint: string) => {
    const key = cmd.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      prioritized.push({ cmd, hint });
    }
  };

  // Context-urgent suggestions first
  if (state.conflict && state.conflict.resolvedChoice === 'none') {
    if (!state.conflict.revert) pushUnique('resolve both', '충돌 해결: 둘 다 합치기');
    pushUnique('resolve ours', '충돌 해결: 내 코드 유지');
    pushUnique('resolve theirs', '충돌 해결: 상대 코드 채택');
  } else if (state.conflict && state.conflict.resolvedChoice !== 'none') {
    pushUnique('git commit', '충돌을 해결한 결과를 커밋으로 남기기');
  }

  if (state.stageId === 'ch8' && state.ai.prNumber !== null && !state.ai.merged) {
    const aiPr = state.prs.find((p) => p.number === state.ai.prNumber);
    if (aiPr?.status === 'draft') {
      pushUnique('ai ready', '초안 PR을 검토 준비로 전환');
    } else {
      pushUnique('ai approve', '사람이 검토하고 승인한 변경 합치기');
    }
  }

  // Stage steps & chips next
  for (const step of scenario.steps) {
    pushUnique(step.command, step.goal);
  }
  for (const chip of scenario.chips) {
    pushUnique(chip.command, chip.label);
  }
  const allowed = allowedCatalogFor(state);
  for (const item of GENERAL_CATALOG) {
    if (!allowed.has(item.cmd)) continue;
    if (state.document) {
      const [program, sub] = item.cmd.split(' ');
      if (sub && (program !== 'git' || !DOCUMENT_GIT_COMMANDS.has(sub))) continue;
    }
    pushUnique(item.cmd, item.hint);
  }

  if (!q) {
    return prioritized.slice(0, 6);
  }

  const startsWithMatches = prioritized.filter((item) =>
    item.cmd.toLowerCase().startsWith(q),
  );
  const containsMatches = prioritized.filter(
    (item) =>
      !item.cmd.toLowerCase().startsWith(q) &&
      (item.cmd.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q)),
  );

  return [...startsWithMatches, ...containsMatches].slice(0, 6);
}
