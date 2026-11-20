import type {
  AiWorldState,
  BubbleAction,
  BubbleSpeaker,
  DocumentComparison,
  GhesWorldState,
  LessonAction,
  PixelAnimKind,
  PixelCommit,
  PixelFile,
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
  getDocumentWorkingText,
  ORIGINAL_DOCUMENT,
  withDocumentVersions,
} from './documentDiff';

const SPEAKER_NAMES: Record<BubbleSpeaker, string> = {
  buddy: '도트 버디',
  cloud: '깃허브 구름',
  guard: '보안 수문장',
  ai: '에이전트 봇',
  system: '도트 안내',
};

const DOCUMENT_GIT_COMMANDS = new Set(['status', 'diff', 'add', 'commit', 'log', 'push']);

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

function defaultTokenState(): TokenWorldState {
  return {
    mode: 'classic',
    scopes: ['repo', 'admin:org', 'delete_repo'],
    ssoAuthorized: false,
    sshReady: false,
    riskScore: 85,
    pushBlockedDemo: false,
  };
}

function defaultGhesState(): GhesWorldState {
  return {
    host: 'github.corp.internal',
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
    const doubleQuoted = new RegExp(`${escaped}\\s+"([^"]+)"`);
    const matchDouble = cmd.match(doubleQuoted);
    if (matchDouble?.[1]) return matchDouble[1];

    const singleQuoted = new RegExp(`${escaped}\\s+'([^']+)'`);
    const matchSingle = cmd.match(singleQuoted);
    if (matchSingle?.[1]) return matchSingle[1];

    const bare = new RegExp(`${escaped}\\s+([^\\s]+)`);
    const matchBare = cmd.match(bare);
    if (matchBare?.[1]) return matchBare[1];
  }
  return null;
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
    return `다음 목표: ${next.command} (${next.goal})`;
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

export function createStageState(id: StageId): PixelSimState {

  switch (id) {
    case 'ch1':
      return {
        stageId: 'ch1',
        files: [
          { name: 'app.js', status: 'modified', content: 'console.log("안녕 GitDots!");' },
          { name: 'style.css', status: 'untracked', content: 'body { background: #131722; }' },
          { name: 'README.md', status: 'committed', content: '# GitDots 프로젝트' },
        ],
        staged: [],
        commits: [
          {
            id: 'c1',
            hash: 'a1b2c3d',
            message: '프로젝트 시작',
            branch: 'main',
            parents: [],
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
        lastAnim: { kind: 'IDLE', seq: 0, label: '작업실 준비 완료' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch1',
            'buddy',
            32,
            54,
            '두 파일이 바뀌었어요',
            '작업 공간에는 고친 app.js와 새로 만든 style.css가 있어요. 그림에서 바구니는 다음 커밋에 포함할 변경을 고르는 곳이에요.',
            '아래 추천 버튼을 누르거나 git add . 를 입력해 보세요!',
            [{ label: '🧺 장바구니 담기 (git add .)', command: 'git add .', tone: 'mint' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '수정된 파일(app.js)과 새 파일(style.css)이 작업실에 기다리고 있어요.', tone: 'muted' },
          ]),
        ],
      };

    case 'docs':
      return {
        stageId: 'docs',
        files: [{ name: DOCUMENT_PATH, status: 'committed', content: ORIGINAL_DOCUMENT }],
        document: { index: ORIGINAL_DOCUMENT, comparison: 'working' },
        staged: [],
        commits: [{
          id: 'c1',
          hash: '4a9cda1',
          message: '스터디 안내 초안',
          branch: 'main',
          parents: [],
          documentContent: ORIGINAL_DOCUMENT,
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
            '편집기에서 README.md를 고친 뒤 어떤 줄이 바뀌었는지 확인하세요.'),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '첫 커밋에 스터디 안내가 들어 있어요. README.md를 고쳐 보세요.', tone: 'muted' },
          ]),
        ],
      };

    case 'ch2':
      return {
        stageId: 'ch2',
        files: [
          { name: 'app.js', status: 'modified', content: '// 작업 중인 임시 코드...' },
          { name: 'README.md', status: 'committed', content: '# GitDots 필수 명령어' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '1a2b3c4', message: '초기 세팅', branch: 'main', parents: [] },
          { id: 'c2', hash: '4d5e6f7', message: '로그인 버튼 추가', branch: 'main', parents: ['c1'] },
          { id: 'c3', hash: '7e8f9a0', message: '실수로 넣은 테스트 코드', branch: 'main', parents: ['c2'] },
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
        lastAnim: { kind: 'IDLE', seq: 0, label: '서랍 준비 완료' },
        completedActions: [],
        bubbles: [
          makeBubble(
            'init-ch2',
            'buddy',
            34,
            54,
            '작업 중에 급한 수정이 생겼어요',
            '마지막 커밋에 테스트 코드를 실수로 넣었어요. 고치던 app.js는 stash에 임시 보관해 두세요.',
            'git stash 를 입력해서 작업 중인 코드를 서랍에 보관해 보세요!',
            [{ label: '📦 서랍에 보관 (git stash)', command: 'git stash', tone: 'amber' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: 'app.js에 수정 중인 코드가 있어요. stash와 revert를 연습해 봐요.', tone: 'muted' },
          ]),
        ],
      };

    case 'ch3':
      return {
        stageId: 'ch3',
        files: [
          { name: 'theme.js', status: 'committed', content: 'export const theme = "light";' },
          { name: 'app.js', status: 'committed', content: 'import { theme } from "./theme";' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: '10aa20b', message: '기본 테마 설정', branch: 'main', parents: [] },
          { id: 'c2', hash: '30cc40d', message: '메인 배경색 수정', branch: 'main', parents: ['c1'] },
          { id: 'c3', hash: '50ee60f', message: 'UI 버튼 색상 변경', branch: 'feature/ui', parents: ['c1'] },
        ],
        branches: { main: 'c2', 'feature/ui': 'c3' },
        headBranch: 'main',
        remoteBranches: { main: 'c2', 'feature/ui': 'c3' },
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
            'main과 feature/ui가 같은 줄에 서로 다른 색을 골랐어요. main에서 새 브랜치를 만들어 병합을 연습해요.',
            'git switch -c feat/dark 로 새 브랜치를 만들어 보세요!',
            [{ label: '🌿 새 브랜치 (git switch -c feat/dark)', command: 'git switch -c feat/dark', tone: 'primary' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '브랜치: main (현재), feature/ui', tone: 'muted' },
          ]),
        ],
      };

    case 'ch4':
      return {
        stageId: 'ch4',
        files: [
          { name: 'feature.js', status: 'committed', content: 'export const sparkle = true;' },
          { name: 'README.md', status: 'committed', content: '# GitDots Team Repo' },
        ],
        staged: [],
        commits: [
          { id: 'c1', hash: 'a01b02c', message: '팀 저장소 초기 세팅', branch: 'main', parents: [] },
          { id: 'c2', hash: 'd03e04f', message: '팀원: 헤더 디자인 개선', branch: 'origin/main', parents: ['c1'] },
          { id: 'c3', hash: 'f05a06b', message: '새 기능 구현 완료', branch: 'feat/sparkle', parents: ['c1'] },
        ],
        branches: { main: 'c1', 'feat/sparkle': 'c3' },
        headBranch: 'feat/sparkle',
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
            'cloud',
            68,
            48,
            'GitHub 구름에 팀원 소식이 왔어요! ☁️',
            '원격 저장소가 한 칸 앞서 있어요. 먼저 git fetch 로 소식을 확인한 뒤 내 브랜치를 올려 PR을 열어 볼까요?',
            'git fetch 를 입력해서 원격 최신 소식을 확인해 보세요!',
            [{ label: '🔭 원격 소식 확인 (git fetch)', command: 'git fetch', tone: 'primary' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'feat/sparkle', [
            { text: '내 브랜치(feat/sparkle)에 새 기능 커밋이 준비되어 있어요.', tone: 'muted' },
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
          { id: 'c1', hash: 'b11c22d', message: '초기 앱 구조', branch: 'main', parents: [] },
          { id: 'c2', hash: 'e33f44a', message: '다크모드 스타일 추가', branch: 'feat/darkmode', parents: ['c1'] },
        ],
        branches: { main: 'c1', 'feat/darkmode': 'c2' },
        headBranch: 'feat/darkmode',
        remoteBranches: { main: 'c1', 'feat/darkmode': 'c2' },
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
            '먼저 gh auth status 로 로그인 상태를 확인해 볼까요?',
            [{ label: '🔑 로그인 확인 (gh auth status)', command: 'gh auth status', tone: 'primary' }],
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
          { id: 'c1', hash: '9a8b7c6', message: '보안 설정 초기화', branch: 'main', parents: [] },
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
            'token classic 으로 예제 토큰의 권한을 확인해 보세요!',
            [{ label: '🗝️ Classic 토큰 보기', command: 'token classic', tone: 'coral' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '예제 classic 토큰에는 repo, admin:org, delete_repo 범위가 설정돼 있어요.', tone: 'amber' },
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
        ghHost: 'github.corp.internal',
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
            'ghes test-public 으로 외부 차단부터 확인해 보세요!',
            [{ label: '🧱 외부 차단 테스트', command: 'ghes test-public', tone: 'coral' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: '대상 호스트: github.corp.internal (사내 폐쇄망)', tone: 'muted' },
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
            'buggy.ts의 덧셈 버그를 고쳐드릴게요! 다만 main 폴더를 바로 건드리면 위험하니 저만의 작업실(worktree)부터 만들어 주세요.',
            'git worktree add -b ai/fix wt-ai 로 AI 작업실을 만들어 보세요!',
            [{ label: '🏗️ AI 작업실 생성', command: 'git worktree add -b ai/fix wt-ai', tone: 'mint' }],
          ),
        ],
        terminal: [
          makeLogEntry(0, 'welcome', 'main', [
            { text: 'Branch Protection 활성: main 직접 푸시 금지 + 사람 승인 필수', tone: 'muted' },
          ]),
        ],
      };
  }
}

function documentNotice(state: PixelSimState, command: string, title: string, message: string): PixelSimState {
  return finalizeTransition(
    state, state, 'IDLE', title, undefined, command,
    [{ text: message, tone: 'muted' }],
    makeBubble(`document-notice-${state.lastAnim.seq + 1}`, 'buddy', 32, 54, title, message),
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
    return documentNotice(state, command, '문서 길이를 확인해 주세요', `편집기에서는 ${DOCUMENT_LIMIT}자까지 저장할 수 있어요.`);
  }
  if (working === getDocumentWorkingText(state)) {
    return documentNotice(state, command, '같은 문서 내용', '이미 저장한 작업 문서와 내용이 같아요.');
  }

  const draft = withDocumentVersions(state, working, state.document.index);
  return finalizeTransition(
    state, draft, 'EDIT', '작업 문서 저장', DOCUMENT_PATH, command,
    [
      { text: 'README.md를 작업 파일에 저장했어요.', tone: 'mint' },
      { text: 'git diff -- README.md로 바뀐 줄을 확인할 수 있어요.', tone: 'muted' },
    ],
    makeBubble(`document-save-${state.lastAnim.seq + 1}`, 'buddy', 32, 54, '작업 파일에 저장했어요',
      '현재 문서와 스테이징 영역을 비교해 바뀐 줄을 확인해 보세요.'),
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
    return documentNotice(state, cmd, '비교할 대상을 골라 주세요',
      '이 장에서 쓸 수 있는 git diff 명령은 비교 패널과 명령어 사전에 있어요.');
  }

  const view = DOCUMENT_COMPARISONS[mode];
  const comparison = getDocumentComparison(state, mode);
  const changes = comparison ? diffDocumentLines(comparison.before, comparison.after) : [];
  const lines: TerminalLine[] = [{ text: `${view.before} → ${view.after}`, tone: 'sky' }];
  const message = !comparison
    ? '문서를 커밋하면 이전 기록과 비교할 수 있어요.'
    : changes.length === 0
      ? view.empty
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

  const draft: PixelSimState = {
    ...state,
    document: { ...state.document, comparison: mode },
    completedActions: comparison
      ? withCompletedAction(state.completedActions, view.action)
      : state.completedActions,
  };
  return finalizeTransition(
    state, draft, 'IDLE', `${view.label} 비교`, DOCUMENT_PATH, cmd, lines,
    makeBubble(`document-diff-${state.lastAnim.seq + 1}`, 'buddy', 34, 52, `${view.label} 비교`, message),
  );
}

export function executePixelCommand(state: PixelSimState, rawCmd: string): PixelSimState {
  const cmd = rawCmd.trim();
  if (!cmd) return state;

  const lower = cmd.toLowerCase();
  const tokens = cmd.split(/\s+/);
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
          `${scenario.shortTitle} 스테이지를 다시 시작할 준비가 됐어요.`,
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
      { text: '  • reset / clear — 스테이지 초기화 / 터미널 비우기', tone: 'muted' },
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
    if (lower === 'edit' || lower === 'edit readme.md') {
      return savePracticeDocument(state, EXAMPLE_DOCUMENT, cmd);
    }
    const sub = tokens[1]?.toLowerCase();
    if (tokens[0].toLowerCase() !== 'git' || !sub || !DOCUMENT_GIT_COMMANDS.has(sub)) {
      return documentNotice(state, cmd, '문서 실습 명령어', 'README.md 편집과 비교에 쓰는 명령은 명령어 사전에서 확인할 수 있어요.');
    }
  }

  // ── Edit command ─────────────────────────────────────────────────────────
  if (lower === 'edit' || lower.startsWith('edit ')) {
    const targetName = tokens[1] ?? state.files[0]?.name ?? 'app.js';
    const exists = state.files.some((f) => f.name === targetName);
    const nextFiles: PixelFile[] = exists
      ? state.files.map((f) =>
          f.name === targetName
            ? { ...f, status: 'modified', content: `${f.content}\n// 수정됨 (#${seqNext})` }
            : f,
        )
      : [
          ...state.files,
          { name: targetName, status: 'untracked', content: `// 새 파일 ${targetName}` },
        ];
    const nextStaged = state.staged.filter((name) => name !== targetName);
    const draft: PixelSimState = {
      ...state,
      files: nextFiles,
      staged: nextStaged,
    };
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
            ? `✏️ ${targetName} 파일을 작업실(Working Dir)에서 수정했어요.`
            : `✨ 새 파일 ${targetName} 을 작업실에 만들었어요.`,
          tone: 'amber',
        },
        { text: '이제 git add . 로 장바구니(Staging)에 담아 보세요.', tone: 'muted' },
      ],
      makeBubble(
        `edit-${seqNext}`,
        'buddy',
        30,
        54,
        `${targetName} 파일을 뚝딱 고쳤어요! ✏️`,
        '작업실 파일이 바뀌었어요. 아직 저장(커밋)되기 전이라 장바구니에 먼저 담아야 해요!',
        'git add . 를 입력해 바뀐 파일을 장바구니에 담아 보세요!',
        [{ label: '🧺 장바구니 담기 (git add .)', command: 'git add .', tone: 'mint' }],
      ),
    );
  }

  // ── Conflict resolution commands: resolve ours | theirs | both ───────────
  if (lower.startsWith('resolve')) {
    const choiceRaw = (tokens[1] ?? 'both').toLowerCase();
    const choice: 'ours' | 'theirs' | 'both' =
      choiceRaw === 'ours' || choiceRaw === 'theirs' || choiceRaw === 'both'
        ? choiceRaw
        : 'both';

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
            ? '먼저 git merge feature/ui 를 실행하면 충돌 상황을 직접 체험할 수 있어요!'
            : '모든 파일이 평화로운 상태예요.',
          nextStepHintText(state),
          state.stageId === 'ch3'
            ? [{ label: '🔀 머지해서 충돌 만나기', command: 'git merge feature/ui', tone: 'amber' }]
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
    const nextFiles: PixelFile[] = state.files.map((f) =>
      f.name === conflictFile ? { ...f, status: 'staged', content: resolvedContent } : f,
    );
    const nextStaged = state.staged.includes(conflictFile)
      ? state.staged
      : [...state.staged, conflictFile];

    const draft: PixelSimState = {
      ...state,
      files: nextFiles,
      staged: nextStaged,
      conflict: {
        ...state.conflict,
        resolvedChoice: choice,
      },
    };

    return finalizeTransition(
      state,
      draft,
      'RESOLVE',
      `충돌 해결 (${choice})`,
      choiceLabel,
      cmd,
      [
        { text: `🧩 ${conflictFile} 충돌 해결: ${choiceLabel}`, tone: 'mint' },
        { text: `✓ 해결된 ${conflictFile} 이 장바구니(Staging)에 담겼어요.`, tone: 'sky' },
        { text: '이제 git commit 으로 머지를 마무리하세요!', tone: 'muted' },
      ],
      makeBubble(
        `resolve-${seqNext}`,
        'buddy',
        46,
        52,
        `충돌 해결 완료! (${choiceLabel}) 🧩`,
        `${conflictFile} 파일의 충돌 표시를 깔끔하게 정리하고 장바구니에 담았어요!`,
        '이제 git commit 을 입력해서 머지 커밋을 완성해 보세요!',
        [{ label: '✅ 머지 커밋 완료 (git commit)', command: 'git commit', tone: 'mint' }],
      ),
    );
  }

  // ── Token security commands (Ch6) ────────────────────────────────────────
  if (lower.startsWith('token ')) {
    const sub = (tokens[1] ?? '').toLowerCase();

    if (sub === 'classic') {
      const nextToken: TokenWorldState = {
        ...state.token,
        mode: 'classic',
        scopes: ['repo', 'admin:org', 'delete_repo', 'workflow'],
        riskScore: 88,
        pushBlockedDemo: false,
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
          '이 예제 토큰에는 delete_repo 범위를 선택했어요. 실제로 할 수 있는 일은 계정의 권한과 토큰에 부여한 범위에 따라 달라져요.',
          'token fine 으로 Fine-Grained 최소 권한 토큰으로 교체해 보세요!',
          [{ label: '✨ Fine-Grained로 바꾸기', command: 'token fine', tone: 'mint' }],
        ),
      );
    }

    if (sub === 'fine' || sub === 'fine-grained') {
      const nextToken: TokenWorldState = {
        ...state.token,
        mode: 'fine-grained',
        scopes: ['contents:write (gitdots/app)', 'expires:30d'],
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
            ? [{ label: '🏢 SAML SSO 승인받기', command: 'token sso', tone: 'primary' }]
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
        'SAML SSO 승인',
        'SSO OK',
        cmd,
        [
          { text: '🏢 조직의 SAML 통합 로그인으로 신원을 확인했어요.', tone: 'mint' },
          { text: `예제 조직에서 회사 계정의 신원을 확인했어요.`, tone: 'sky' },
        ],
        makeBubble(
          `token-sso-${seqNext}`,
          'guard',
          56,
          48,
          '회사 계정으로 신원을 확인했어요',
          'SAML SSO를 쓰는 조직에서는 회사 계정과 GitHub 계정을 연결해요. Fine-grained 토큰의 조직 인증은 토큰을 만들 때 이뤄져요.',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'TOKEN_SSO') }),
          !state.token.sshReady
            ? [{ label: '🔐 SSH 키 설정하기', command: 'token ssh', tone: 'mint' }]
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
          { text: '🔐 ssh-ed25519 키 쌍 생성 & GitHub 공개키 등록 완료!', tone: 'mint' },
          { text: 'Hi dot-dev! You have successfully authenticated via SSH.', tone: 'sky' },
        ],
        makeBubble(
          `token-ssh-${seqNext}`,
          'guard',
          56,
          48,
          'SSH 암호화 열쇠 짝꿍 완성! 🔐',
          '비밀키는 내 컴퓨터에만 두고 공개키만 GitHub에 등록해서 비밀번호 없이도 안전하게 연결해요!',
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
        'Push Protection 차단',
        'SECRET_BLOCKED',
        cmd,
        [
          { text: 'remote: error: GH013: Repository rule violations found!', tone: 'coral' },
          { text: 'remote: - GITHUB PUSH PROTECTION: GitHub Personal Access Token 감지됨', tone: 'coral' },
          { text: '🛡️ 비밀키가 외부에 올라가기 직전에 자동으로 막았어요!', tone: 'mint' },
        ],
        makeBubble(
          `token-leak-${seqNext}`,
          'guard',
          56,
          48,
          '푸시에서 토큰이 감지됐어요',
          '이 저장소는 푸시 보호를 켜 두었어요. GitHub가 예제에 포함된 토큰 패턴을 감지해 푸시를 차단했어요.',
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
          { text: 'curl https://github.com/corp/secret → 403 BLOCKED BY CORP FIREWALL', tone: 'coral' },
          { text: '🧱 사내 보안 정책에 따라 외부 github.com으로의 코드 전송이 차단됐어요.', tone: 'amber' },
        ],
        makeBubble(
          `ghes-block-${seqNext}`,
          'guard',
          52,
          48,
          '외부 전송 철벽 차단! 🧱',
          '회사 대외비 코드는 바깥 github.com으로 못 나가요. 대신 사내 전용 GHES 서버에 VPN으로 접속해야 해요!',
          'gh auth login --hostname github.corp.internal 로 사내 서버에 로그인해 보세요!',
          [
            {
              label: '🔓 사내망 GHES 로그인',
              command: 'gh auth login --hostname github.corp.internal',
              tone: 'primary',
            },
          ],
        ),
      );
    }

    if (sub === 'runner') {
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
        'Private Runner 실행',
        'corp-runner-01',
        cmd,
        [
          { text: '⚙️ Job assigned to [self-hosted, linux, corp-private-01]', tone: 'sky' },
          { text: '✓ Build & Security Scan passed inside corporate intranet (0 bytes external)', tone: 'mint' },
        ],
        makeBubble(
          `ghes-runner-${seqNext}`,
          'cloud',
          68,
          48,
          '사내 Private Runner 빌드 성공! ⚙️',
          '코드가 회사 밖으로 한 발짝도 나가지 않고 사내 전용 서버 안에서 자동 테스트까지 끝냈어요!',
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
          { text: '  • CI  : GitHub Runner     vs  사내 Private Runner', tone: 'default' },
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
          '작업실 먼저 필요',
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
            '잠깐! AI 작업실부터 만들어 주세요 🏗️',
            '사람이 쓰는 main 작업실을 바로 건드리면 충돌이 날 수 있어요. 독립된 worktree 공간을 먼저 열어 주세요!',
            'git worktree add -b ai/fix wt-ai 를 실행해 보세요!',
            [
              {
                label: '🏗️ AI 작업실 생성',
                command: 'git worktree add -b ai/fix wt-ai',
                tone: 'mint',
              },
            ],
          ),
        );
      }

      const aiBranch = state.ai.worktreeBranch;
      const parentId = state.branches[aiBranch] ?? state.branches[state.headBranch] ?? 'c1';
      const newCommitId = `c${state.commits.length + 1}`;
      const newCommit: PixelCommit = {
        id: newCommitId,
        hash: makeHash(seqNext, 'ai-code'),
        message: 'fix: sum 연산자 버그 수정 (by AI)',
        branch: aiBranch,
        parents: [parentId],
      };

      const nextFiles: PixelFile[] = state.files.map((f) =>
        f.name === 'buggy.ts'
          ? { ...f, status: 'committed', content: 'export const sum = (a: number, b: number) => a + b;' }
          : f,
      );

      const draft: PixelSimState = {
        ...state,
        files: nextFiles,
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
          { text: `🤖 [wt-ai @ ${aiBranch}] buggy.ts 수정: a - b → a + b`, tone: 'mint' },
          { text: `✓ unit test: sum(2, 3) === 5 PASS`, tone: 'mint' },
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
          [{ label: '🛑 main 푸시 테스트 (ai push-main)', command: 'ai push-main', tone: 'coral' }],
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
          { text: 'remote: error: GH006: Protected branch update failed for refs/heads/main.', tone: 'coral' },
          { text: '🛡️ Branch Protection: AI라도 사람 승인 없이는 main에 직접 푸시할 수 없어요!', tone: 'amber' },
        ],
        makeBubble(
          `ai-block-${seqNext}`,
          'guard',
          52,
          48,
          '스톱! main 직접 푸시 차단! 🛑',
          'Branch Protection 가드레일 덕분에 AI 에이전트도 main을 멋대로 바꿀 수 없어요. 안전하게 PR로 올려야 해요!',
          'ai pr 을 입력해 Draft PR과 자동 CI 검증을 돌려 보세요!',
          [{ label: '📋 Draft PR 올리기 (ai pr)', command: 'ai pr', tone: 'primary' }],
        ),
      );
    }

    if (sub === 'pr') {
      const nextNum =
        state.prs.reduce((max, p) => Math.max(max, p.number), 0) + 1;
      const aiBranch = state.ai.worktreeBranch;
      const newPr: PixelPr = {
        number: nextNum,
        title: '[AI] 덧셈 연산자 버그 수정',
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
        `Draft PR #${nextNum} + CI 통과`,
        `#${nextNum}`,
        cmd,
        [
          { text: `📋 Draft PR #${nextNum} 생성: "${newPr.title}" (${aiBranch} → main)`, tone: 'sky' },
          { text: '✅ GitHub Actions CI: Lint · Unit Test · Secret Scan 모두 통과!', tone: 'mint' },
          { text: '👤 사람 리뷰어의 최종 승인을 기다리고 있어요...', tone: 'amber' },
        ],
        makeBubble(
          `ai-pr-${seqNext}`,
          'ai',
          66,
          52,
          `Draft PR #${nextNum} + CI 초록불! 📋`,
          '자동 테스트를 모두 통과했어요! 이제 사람이 변경 내역을 최종 확인하고 승인해 주시면 main에 합칠게요.',
          '말풍선 버튼을 누르거나 ai approve 를 입력해 승인해 주세요!',
          [{ label: '✅ 사람 승인 & 머지 (ai approve)', command: 'ai approve', tone: 'mint' }],
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
          [{ text: '승인할 AI PR이 아직 없어요. 먼저 ai pr 로 Draft PR을 올려 주세요!', tone: 'amber' }],
          makeBubble(
            `ai-need-pr-${seqNext}`,
            'ai',
            66,
            52,
            '먼저 Draft PR을 올려야 해요! 📋',
            '아직 리뷰할 PR이 없어요. ai pr 명령어로 PR과 자동 테스트를 먼저 실행해 볼까요?',
            'ai pr 을 입력해 Draft PR을 만들어 보세요!',
            [{ label: '📋 Draft PR 올리기 (ai pr)', command: 'ai pr', tone: 'primary' }],
          ),
        );
      }

      const prNum = state.ai.prNumber;
      const aiBranch = state.ai.worktreeBranch;
      const mainHead = state.branches.main ?? 'c1';
      const aiHead = state.branches[aiBranch] ?? mainHead;
      const mergeId = `c${state.commits.length + 1}`;
      const mergeCommit: PixelCommit = {
        id: mergeId,
        hash: makeHash(seqNext, `merge-pr-${prNum}`),
        message: `Merge PR #${prNum}: [AI] 덧셈 연산자 버그 수정`,
        branch: 'main',
        parents: aiHead !== mainHead ? [mainHead, aiHead] : [mainHead],
        isMerge: true,
      };

      const nextPrs: PixelPr[] = state.prs.map((p) =>
        p.number === prNum ? { ...p, status: 'merged', approved: true, ci: 'pass' } : p,
      );

      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, mergeCommit],
        branches: { ...state.branches, main: mergeId },
        remoteBranches: { ...state.remoteBranches, main: mergeId },
        prs: nextPrs,
        ai: { ...state.ai, humanApproved: true, merged: true },
      };

      return finalizeTransition(
        state,
        draft,
        'AI_APPROVE',
        `사람 승인 & PR #${prNum} 머지`,
        'HITL_MERGED',
        cmd,
        [
          { text: `👤 Reviewed & Approved by @${state.ghUser} (Human-in-the-Loop)`, tone: 'mint' },
          { text: `🎉 PR #${prNum} 이 안전하게 main 브랜치에 머지되었어요! (${mergeCommit.hash})`, tone: 'mint' },
        ],
        makeBubble(
          `ai-approve-${seqNext}`,
          'ai',
          64,
          50,
          '사람 승인 & 안전 머지 성공! 🏆',
          '사람이 덧셈 수정과 테스트 결과를 확인했어요. 승인한 변경을 main에 합쳤어요.',
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
      const stagedFiles = state.files.filter((f) => state.staged.includes(f.name));
      const modifiedFiles = state.files.filter((f) => f.status === 'modified');
      const untrackedFiles = state.files.filter((f) => f.status === 'untracked');
      const conflictFiles = state.files.filter((f) => f.status === 'conflict');

      const lines: TerminalLine[] = [
        { text: `On branch ${state.headBranch}`, tone: 'sky' },
      ];
      if (conflictFiles.length > 0) {
        lines.push({
          text: `⚡ 충돌 파일: ${conflictFiles.map((f) => f.name).join(', ')}`,
          tone: 'coral',
        });
      }
      if (stagedFiles.length > 0) {
        lines.push({
          text: `🧺 장바구니(Staged): ${stagedFiles.map((f) => f.name).join(', ')}`,
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
        lines.push({ text: '✨ 작업실이 깨끗해요 (nothing to commit, working tree clean)', tone: 'mint' });
      }

      const statusSummary =
        conflictFiles.length > 0
          ? `충돌 난 파일이 ${conflictFiles.length}개 있어요! 먼저 해결해 볼까요?`
          : stagedFiles.length > 0
            ? `장바구니에 ${stagedFiles.length}개 파일이 담겨 있어요. 이제 커밋할 차례예요!`
            : modifiedFiles.length + untrackedFiles.length > 0
              ? `아직 장바구니에 안 담긴 파일이 ${modifiedFiles.length + untrackedFiles.length}개 있어요!`
              : '작업실이 아주 깨끗해요!';

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
          '현재 작업실 상태 보고서 📋',
          statusSummary,
          nextStepHintText(state),
        ),
      );
    }

    // git add
    if (sub === 'add') {
      if (state.conflict && state.conflict.resolvedChoice === 'none') {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '충돌 해결 먼저',
          undefined,
          cmd,
          [{ text: '⚠️ 충돌 표시가 남아 있어요! 먼저 resolve both / ours / theirs 로 해결해 주세요.', tone: 'coral' }],
          makeBubble(
            `add-conflict-${seqNext}`,
            'buddy',
            46,
            52,
            '충돌을 먼저 골라 주세요! ⚡',
            `${state.conflict.file} 파일에 두 코드가 겹쳐 있어요. 아래 버튼 중 하나를 선택해 해결해 볼까요?`,
            '원하는 해결 버튼을 클릭해 보세요!',
            [
              { label: '내 코드 유지 (ours)', command: 'resolve ours', tone: 'primary' },
              { label: '상대 코드 채택 (theirs)', command: 'resolve theirs', tone: 'amber' },
              { label: '둘 다 합치기 (both)', command: 'resolve both', tone: 'mint' },
            ],
          ),
        );
      }

      const target = (tokens[tokens[2] === '--' ? 3 : 2] ?? '.').replace(/^\.\//, '');
      const stageAll = target === '.' || target === '-A' || target === '--all';
      if (state.document && !stageAll && target !== DOCUMENT_PATH) {
        return documentNotice(state, cmd, '실습 문서 확인', '이 연습 저장소에는 README.md가 있어요. git add README.md를 실행해 보세요.');
      }
      const newlyStaged: string[] = [];
      const nextFiles: PixelFile[] = state.files.map((f) => {
        const shouldStage =
          (stageAll && (f.status === 'modified' || f.status === 'untracked')) ||
          (!stageAll && f.name === target && f.status !== 'committed');
        if (shouldStage) {
          newlyStaged.push(f.name);
          return { ...f, status: 'staged' };
        }
        return f;
      });

      const nextStaged = Array.from(new Set([...state.staged, ...newlyStaged]));
      let draft: PixelSimState = {
        ...state,
        files: nextFiles,
        staged: nextStaged,
      };

      if (state.document) {
        const working = getDocumentWorkingText(state);
        draft = withDocumentVersions(draft, working, working);
        if (draft.staged.length === 0) {
          const message = '스테이징 영역의 문서가 최근 커밋과 같아요. 작업 문서에 변경을 만들고 다시 담아 보세요.';
          return finalizeTransition(
            state, draft, 'IDLE', '담을 문서 변경 없음', undefined, cmd,
            [{ text: message, tone: 'muted' }],
            makeBubble(`document-add-empty-${seqNext}`, 'buddy', 34, 54, '담을 문서 변경이 없어요', message),
          );
        }
      }

      if (newlyStaged.length === 0) {
        return finalizeTransition(
          state,
          draft,
          state.staged.length > 0 ? 'ADD' : 'IDLE',
          '장바구니 확인',
          undefined,
          cmd,
          [
            {
              text:
                state.staged.length > 0
                  ? `🧺 이미 ${state.staged.join(', ')} 이 장바구니에 담겨 있어요!`
                  : '장바구니에 새로 담을 변경 파일이 없어요. edit app.js 로 파일을 고쳐 볼까요?',
              tone: 'muted',
            },
          ],
          makeBubble(
            `add-empty-${seqNext}`,
            'buddy',
            34,
            54,
            state.staged.length > 0 ? '이미 장바구니가 꽉 찼어요! 🧺' : '바뀐 파일이 아직 없어요 🙂',
            state.staged.length > 0
              ? '이제 git commit 으로 내 저장소에 세이브 박스를 만들 차례예요!'
              : 'edit app.js 로 파일을 살짝 수정한 뒤 다시 담아 볼까요?',
            nextStepHintText(draft),
          ),
        );
      }

      return finalizeTransition(
        state,
        draft,
        'ADD',
        '장바구니 담기',
        newlyStaged.join(', '),
        cmd,
        [
          { text: `🧺 장바구니(Staging)에 담음: ${newlyStaged.join(', ')}`, tone: 'mint' },
          { text: '이제 커밋하면 이 파일들이 하나의 스냅샷으로 저장돼요!', tone: 'muted' },
        ],
        makeBubble(
          `add-${seqNext}`,
          'buddy',
          38,
          54,
          '다음 커밋에 담을 변경을 골랐어요',
          `${newlyStaged.join(', ')}의 현재 변경이 스테이징 영역에 담겼어요. 원래 파일은 작업 공간에서 계속 편집할 수 있어요.`,
          '다음은 git commit -m "첫 세이브" 로 세이브해 봐요!',
          [{ label: '📦 첫 세이브 (git commit)', command: 'git commit -m "첫 세이브"', tone: 'mint' }],
        ),
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
          [{ text: 'error: Committing is not possible because you have unmerged files.', tone: 'coral' }],
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

      const isAutoStage = /\s(?:-[a-z]*a[a-z]*|--all)(?=\s|$)/.test(cmd.replace(/"[^"]*"|'[^']*'/g, ''));
      let workingFiles = state.files;
      let workingStaged = state.staged;
      const workingDocument = getDocumentWorkingText(state);
      const documentContent = state.document
        ? isAutoStage ? workingDocument : state.document.index
        : undefined;

      if (isAutoStage && state.document) {
        const snapshot = withDocumentVersions(state, workingDocument, workingDocument);
        workingFiles = snapshot.files;
        workingStaged = snapshot.staged;
      } else if (isAutoStage) {
        const autoAdded: string[] = [];
        workingFiles = state.files.map((f) => {
          if (f.status === 'modified') {
            autoAdded.push(f.name);
            return { ...f, status: 'staged' };
          }
          return f;
        });
        workingStaged = Array.from(new Set([...state.staged, ...autoAdded]));
      }

      const isMergeCommit = Boolean(state.conflict && state.conflict.resolvedChoice !== 'none');

      if (workingStaged.length === 0 && !isMergeCommit) {
        if (state.document) {
          return documentNotice(state, cmd, '커밋할 문서 변경이 없어요', '변경한 문서를 저장하고 git add README.md로 먼저 담아 주세요.');
        }
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '커밋할 파일 없음',
          undefined,
          cmd,
          [
            { text: '장바구니(Staging)가 비어 있어요! 먼저 git add . 로 파일을 담아 주세요.', tone: 'amber' },
          ],
          makeBubble(
            `commit-empty-${seqNext}`,
            'buddy',
            36,
            54,
            '장바구니가 비어 있어요! 🧺',
            '커밋은 장바구니에 담긴 파일만 저장해요. 먼저 git add . 로 파일을 담아 볼까요?',
            'git add . 를 실행해 보세요!',
            [{ label: '🧺 장바구니 담기 (git add .)', command: 'git add .', tone: 'mint' }],
          ),
        );
      }

      const parsedMsg =
        extractQuotedFlag(cmd, ['-m', '-am', '--message']) ??
        (isMergeCommit
          ? `Merge ${state.conflict?.theirsLabel ?? 'feature/ui'} into ${state.headBranch}`
          : '변경사항 저장');

      const headCommitId = state.branches[state.headBranch];
      const parents: string[] = headCommitId ? [headCommitId] : [];
      if (isMergeCommit && state.conflict) {
        const theirsHead = state.branches[state.conflict.theirsLabel];
        if (theirsHead && !parents.includes(theirsHead)) {
          parents.push(theirsHead);
        }
      }

      const newCommitId = `c${state.commits.length + 1}`;
      const newCommit: PixelCommit = {
        id: newCommitId,
        hash: makeHash(seqNext, parsedMsg),
        message: parsedMsg,
        branch: state.headBranch,
        parents,
        ...(documentContent !== undefined ? { documentContent } : {}),
        ...(isMergeCommit ? { isMerge: true } : {}),
      };

      const nextFiles: PixelFile[] = workingFiles.map((f) =>
        f.status === 'staged' ? { ...f, status: 'committed' } : f,
      );

      let draft: PixelSimState = {
        ...state,
        files: nextFiles,
        staged: [],
        commits: [...state.commits, newCommit],
        branches: { ...state.branches, [state.headBranch]: newCommitId },
        conflict: null,
      };
      if (documentContent !== undefined) {
        draft = withDocumentVersions(draft, workingDocument, documentContent);
      }

      if (isMergeCommit) {
        draft.completedActions = withCompletedAction(draft.completedActions, 'MERGE_COMMIT');
      }
      const afterCompleted = withCompletedAction(draft.completedActions, 'COMMIT');
      const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

      return finalizeTransition(
        state,
        draft,
        'COMMIT',
        isMergeCommit ? '머지 커밋 완료' : '세이브(커밋) 완료',
        newCommit.hash,
        cmd,
        [
          { text: `[${state.headBranch} ${newCommit.hash}] ${parsedMsg}`, tone: 'mint' },
          {
            text: isMergeCommit
              ? '🎉 충돌 해결이 깔끔하게 머지 커밋으로 기록됐어요!'
              : `📦 ${workingStaged.length}개 파일이 내 저장소(Local Repo)에 스냅샷으로 저장됐어요.`,
            tone: 'sky',
          },
        ],
        makeBubble(
          `commit-${seqNext}`,
          'buddy',
          48,
          52,
          isMergeCommit ? '충돌 해결 & 머지 커밋 완료! 🎉' : '내 컴퓨터에 커밋을 기록했어요',
          isMergeCommit
            ? '두 갈래 브랜치가 하나의 안전한 커밋으로 합쳐졌어요!'
            : `커밋 메시지는 “${parsedMsg}”, 이 기록의 짧은 ID는 ${newCommit.hash}예요. GitHub에는 push할 때 올라가요.`,
          nextStepHintText({ ...draft, completedActions: afterCompleted }),
          nextStep
            ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
            : undefined,
        ),
      );
    }

    // git push
    if (sub === 'push') {
      const localHead = state.branches[state.headBranch];
      if (!localHead) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '푸시할 커밋 없음',
          undefined,
          cmd,
          [{ text: '아직 올릴 커밋이 없어요.', tone: 'muted' }],
          makeBubble(
            `push-none-${seqNext}`,
            'cloud',
            68,
            48,
            '올릴 세이브가 아직 없어요 ☁️',
            '먼저 커밋을 하나 만든 뒤 푸시해 볼까요?',
            nextStepHintText(state),
          ),
        );
      }

      if (state.remoteBranches[state.headBranch] === localHead) {
        return finalizeTransition(
          state, state, 'IDLE', '이미 동기화됨', undefined, cmd,
          [{ text: 'Everything up-to-date', tone: 'muted' }],
          makeBubble(`push-current-${seqNext}`, 'cloud', 68, 48, '새로 보낼 커밋이 없어요',
            '내 브랜치와 원격 브랜치가 같은 커밋을 가리켜요. 변경을 커밋한 뒤 다시 푸시해 보세요.', nextStepHintText(state)),
        );
      }

      const draft: PixelSimState = {
        ...state,
        remoteBranches: {
          ...state.remoteBranches,
          [state.headBranch]: localHead,
        },
      };

      const afterCompleted = withCompletedAction(draft.completedActions, 'PUSH');
      const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

      return finalizeTransition(
        state,
        draft,
        'PUSH',
        'GitHub 구름으로 푸시',
        `origin/${state.headBranch}`,
        cmd,
        [
          { text: `🚀 Uploading commits to ${state.ghHost}...`, tone: 'sky' },
          { text: `✓ [new/updated] ${state.headBranch} -> origin/${state.headBranch}`, tone: 'mint' },
        ],
        makeBubble(
          `push-${seqNext}`,
          'cloud',
          68,
          48,
          'GitHub 구름에 도착했어요! 🚀',
          `GitHub의 ${state.headBranch} 브랜치가 내 컴퓨터와 같은 커밋을 가리켜요. 팀원도 이 변경을 받아 갈 수 있어요.`,
          nextStepHintText({ ...draft, completedActions: afterCompleted }),
          nextStep
            ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
            : undefined,
        ),
      );
    }

    // git fetch
    if (sub === 'fetch') {
      const remoteMain = state.remoteBranches.main;
      const localMain = state.branches.main;
      const hasNewRemote = Boolean(remoteMain && remoteMain !== localMain);

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
          { text: `From https://${state.ghHost}/gitdots/app`, tone: 'sky' },
          {
            text: hasNewRemote
              ? ' * [updated] origin/main — 팀원의 새 커밋 1건이 있어요!'
              : ' ✓ 원격 저장소와 최신 정보를 동기화했어요.',
            tone: 'mint',
          },
        ],
        makeBubble(
          `fetch-${seqNext}`,
          'cloud',
          68,
          48,
          '원격 소식만 살짝 확인했어요! 🔭',
          'git fetch 는 내 작업 폴더를 건드리지 않고, GitHub에 어떤 새 커밋이 올라왔는지만 안전하게 살펴봐요!',
          nextStepHintText({ ...draft, completedActions: afterCompleted }),
          nextStep
            ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
            : undefined,
        ),
      );
    }

    // git pull
    if (sub === 'pull') {
      const remoteHead = state.remoteBranches[state.headBranch] ?? state.remoteBranches.main;
      const localHead = state.branches[state.headBranch];
      let nextCommits = state.commits;
      let nextBranches = { ...state.branches };

      if (remoteHead && remoteHead !== localHead) {
        if (state.headBranch === 'main') {
          nextBranches = { ...nextBranches, main: remoteHead };
        } else {
          const pullId = `c${state.commits.length + 1}`;
          const pullCommit: PixelCommit = {
            id: pullId,
            hash: makeHash(seqNext, 'git-pull'),
            message: `Pull origin/main into ${state.headBranch}`,
            branch: state.headBranch,
            parents: localHead ? [localHead, remoteHead] : [remoteHead],
            isMerge: true,
          };
          nextCommits = [...state.commits, pullCommit];
          nextBranches = { ...nextBranches, [state.headBranch]: pullId, main: remoteHead };
        }
      }

      const draft: PixelSimState = {
        ...state,
        commits: nextCommits,
        branches: nextBranches,
      };

      return finalizeTransition(
        state,
        draft,
        'PULL',
        '원격 코드 받아 합치기',
        `origin/${state.headBranch}`,
        cmd,
        [
          { text: `⬇️ Fetching & merging latest changes from origin...`, tone: 'sky' },
          { text: `✓ ${state.headBranch} 브랜치가 최신 상태로 업데이트됐어요!`, tone: 'mint' },
        ],
        makeBubble(
          `pull-${seqNext}`,
          'cloud',
          66,
          48,
          '팀원 코드를 쏙 받아 합쳤어요! ⬇️',
          'git pull 은 fetch(확인)와 merge(합치기)를 한 번에 처리해서 내 브랜치를 최신으로 맞춰 줘요!',
          nextStepHintText(draft),
        ),
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

      const recent = [...state.commits]
        .filter((c) => !c.ghost)
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
          '세이브 타임라인을 열었어요! 📜',
          `지금까지 쌓인 ${recent.length}개의 세이브(커밋) 기록이에요. 언제든 원하는 시점을 확인할 수 있어요!`,
          nextStepHintText(state),
        ),
      );
    }

    // git diff
    if (sub === 'diff') {
      if (state.document) return comparePracticeDocument(state, cmd, tokens.slice(2));
      const dirty = state.files.filter((f) => f.status === 'modified');
      const lines: TerminalLine[] =
        dirty.length === 0
          ? [{ text: '수정된 내용이 없어요 (diff empty).', tone: 'muted' }]
          : dirty.flatMap((f) => [
              { text: `diff --git a/${f.name} b/${f.name}`, tone: 'sky' as const },
              { text: `- // 이전 저장 내용`, tone: 'coral' as const },
              { text: `+ ${f.content.split('\n')[0]}`, tone: 'mint' as const },
            ]);

      return finalizeTransition(
        state,
        state,
        'IDLE',
        '변경점 비교',
        undefined,
        cmd,
        lines,
        makeBubble(
          `diff-${seqNext}`,
          'buddy',
          34,
          54,
          '바뀐 줄을 돋보기로 비교했어요! 🔍',
          dirty.length > 0
            ? '빨간 줄(-)은 사라진 내용, 초록 줄(+)은 새로 추가된 내용이에요!'
            : '추적 중인 파일에 아직 스테이징하지 않은 변경이 없어요.',
          nextStepHintText(state),
        ),
      );
    }

    // git stash / git stash pop
    if (sub === 'stash') {
      const action = (tokens[2] ?? 'push').toLowerCase();

      if (action === 'pop' || action === 'apply') {
        const saved = state.stashes.at(-1);
        if (!saved) {
          return finalizeTransition(
            state,
            state,
            'IDLE',
            '서랍 비어있음',
            undefined,
            cmd,
            [{ text: 'error: No stash entries found. (서랍이 비어 있어요!)', tone: 'amber' }],
            makeBubble(
              `stash-empty-${seqNext}`,
              'buddy',
              34,
              54,
              '서랍이 비어 있어요! 📦',
              '먼저 git stash 로 작업 중인 파일을 서랍에 넣어 둔 뒤에 꺼낼 수 있어요.',
              nextStepHintText(state),
              [{ label: '📦 서랍에 넣기 (git stash)', command: 'git stash', tone: 'amber' }],
            ),
          );
        }

        const targetFile = saved.map((file) => file.name).join(', ');
        const files = new Map(state.files.map((file) => [file.name, file]));
        const occupied = saved.find((file) => {
          const current = files.get(file.name);
          return current && current.status !== 'committed';
        });
        if (occupied) {
          return finalizeTransition(
            state, state, 'IDLE', '작업 중인 변경 확인', occupied.name, cmd,
            [{ text: `${occupied.name}에 보관 후 생긴 변경이 있어요.`, tone: 'amber' }],
            makeBubble(`stash-overlap-${seqNext}`, 'buddy', 34, 54, '같은 파일에 새 변경이 있어요',
              '지금 변경을 먼저 커밋하거나 따로 보관하고 다시 꺼내세요. 보관한 작업은 서랍에 있어요.'),
          );
        }
        for (const file of saved) {
          const status = file.status === 'staged' && !tokens.includes('--index') ? 'modified' : file.status;
          files.set(file.name, { ...file, status });
        }
        const nextFiles = [...files.values()];
        const stashes = action === 'pop' ? state.stashes.slice(0, -1) : state.stashes;
        const draft: PixelSimState = {
          ...state,
          files: nextFiles,
          staged: nextFiles.filter((file) => file.status === 'staged').map((file) => file.name),
          stashes,
          stashCount: stashes.length,
        };
        const afterCompleted = withCompletedAction(draft.completedActions, 'STASH_POP');
        const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

        return finalizeTransition(
          state,
          draft,
          'STASH_POP',
          '서랍에서 꺼내기',
          targetFile,
          cmd,
          [
            { text: `📤 서랍(stash@{0})에서 ${targetFile} 작업을 다시 꺼냈어요!`, tone: 'mint' },
            { text: `남은 보관 항목 ${stashes.length}개`, tone: 'muted' },
          ],
          makeBubble(
            `stash-pop-${seqNext}`,
            'buddy',
            34,
            54,
            '아까 하던 작업이 돌아왔어요! 📤',
            `서랍에 넣어둔 ${targetFile} 변경사항을 책상 위로 고스란히 꺼내 왔어요!`,
            nextStepHintText({ ...draft, completedActions: afterCompleted }),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'primary' }]
              : undefined,
          ),
        );
      }

      const includeUntracked = tokens.includes('-u') || tokens.includes('--include-untracked');
      const dirtyFiles = state.files.filter((f) =>
        f.status === 'modified' || f.status === 'staged' || (includeUntracked && f.status === 'untracked'),
      );
      if (dirtyFiles.length === 0) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '보관할 작업 없음',
          undefined,
          cmd,
          [{ text: 'No local changes to save (서랍에 넣을 변경사항이 없어요).', tone: 'muted' }],
          makeBubble(
            `stash-clean-${seqNext}`,
            'buddy',
            34,
            54,
            '책상이 이미 깨끗해요! ✨',
            '서랍에 숨길 변경 파일이 없어요. edit app.js 로 파일을 고친 뒤 stash해 볼까요?',
            nextStepHintText(state),
          ),
        );
      }

      const nextFiles: PixelFile[] = state.files
        .filter((file) => !(includeUntracked && file.status === 'untracked'))
        .map((file) => dirtyFiles.includes(file) ? { ...file, status: 'committed' } : file);
      const stashes = [...state.stashes, dirtyFiles];
      const draft: PixelSimState = {
        ...state,
        files: nextFiles,
        staged: [],
        stashes,
        stashCount: stashes.length,
      };

      return finalizeTransition(
        state,
        draft,
        'STASH',
        '서랍에 임시 보관',
        `stash@{0}`,
        cmd,
        [
          {
            text: `📦 Saved working directory on ${state.headBranch}: ${dirtyFiles.map((f) => f.name).join(', ')}`,
            tone: 'amber',
          },
          { text: `보관 항목 ${stashes.length}개`, tone: 'muted' },
        ],
        makeBubble(
          `stash-${seqNext}`,
          'buddy',
          34,
          54,
          '서랍에 안전하게 숨겼어요! 📦',
          '아직 커밋하지 않은 변경을 보관했어요. 이제 작업 폴더에서 급한 수정을 할 수 있어요.',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'STASH') }),
        ),
      );
    }

    // git reset
    if (sub === 'reset') {
      const headId = state.branches[state.headBranch];
      const headCommit = state.commits.find((c) => c.id === headId);
      const parentId = headCommit?.parents[0];

      if (!headCommit || !parentId) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '되감을 커밋 없음',
          undefined,
          cmd,
          [{ text: '첫 번째 커밋이라 더 이상 뒤로 되감을 수 없어요.', tone: 'amber' }],
          makeBubble(
            `reset-root-${seqNext}`,
            'buddy',
            44,
            52,
            '여기가 첫 출발점이에요! 🏁',
            '첫 커밋 이전으로는 되감을 수 없어요.',
            nextStepHintText(state),
          ),
        );
      }

      const isSoft = cmd.includes('--soft');
      const isHard = cmd.includes('--hard');
      const nextCommits: PixelCommit[] = state.commits.map((c) =>
        c.id === headCommit.id ? { ...c, ghost: true } : c,
      );
      const primaryName = state.files[0]?.name ?? 'app.js';
      const nextFiles: PixelFile[] = isHard
        ? state.files.map((f) => ({ ...f, status: 'committed' }))
        : state.files.map((f, idx) =>
            idx === 0 ? { ...f, status: isSoft ? 'staged' : 'modified' } : f,
          );
      const nextStaged = isSoft ? [primaryName] : [];

      const draft: PixelSimState = {
        ...state,
        commits: nextCommits,
        branches: { ...state.branches, [state.headBranch]: parentId },
        files: nextFiles,
        staged: nextStaged,
      };

      return finalizeTransition(
        state,
        draft,
        'RESET',
        isSoft ? 'Soft 되감기' : isHard ? 'Hard 되감기' : '커밋 되감기',
        headCommit.hash,
        cmd,
        [
          { text: `⏪ HEAD가 이전 커밋(${parentId})으로 한 칸 되감겼어요.`, tone: 'amber' },
          {
            text: isSoft
              ? `🧺 --soft 옵션이라 ${primaryName} 변경 내용은 장바구니에 고스란히 남아 있어요!`
              : isHard
                ? '⚠️ --hard 옵션으로 작업실 파일까지 이전 상태로 되돌렸어요.'
                : `✏️ ${primaryName} 변경 내용은 작업실에 남아 있어요.`,
            tone: 'sky',
          },
        ],
        makeBubble(
          `reset-${seqNext}`,
          'buddy',
          46,
          52,
          '커밋을 한 칸 되감았어요! ⏪',
          isSoft
            ? 'reset --soft 는 커밋만 취소하고 내 코드는 장바구니에 살려 둬요! 팀과 공유 전 내 PC에서만 써야 해요.'
            : '이전 세이브 지점으로 시계를 되돌렸어요!',
          nextStepHintText(draft),
        ),
      );
    }

    // git revert
    if (sub === 'revert') {
      const headId = state.branches[state.headBranch];
      const headCommit = state.commits.find((c) => c.id === headId);
      if (!headCommit) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '취소할 커밋 없음',
          undefined,
          cmd,
          [{ text: '되돌릴 커밋이 없어요.', tone: 'muted' }],
          makeBubble(
            `revert-none-${seqNext}`,
            'buddy',
            44,
            52,
            '취소할 커밋이 없어요 🙂',
            '먼저 커밋을 만든 뒤 revert 를 사용해 보세요!',
            nextStepHintText(state),
          ),
        );
      }

      const revertId = `c${state.commits.length + 1}`;
      const revertMsg = `Revert "${headCommit.message}"`;
      const revertCommit: PixelCommit = {
        id: revertId,
        hash: makeHash(seqNext, revertMsg),
        message: revertMsg,
        branch: state.headBranch,
        parents: [headCommit.id],
        isRevert: true,
      };

      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, revertCommit],
        branches: { ...state.branches, [state.headBranch]: revertId },
      };

      return finalizeTransition(
        state,
        draft,
        'REVERT',
        '안전 취소(Revert)',
        revertCommit.hash,
        cmd,
        [
          { text: `[${state.headBranch} ${revertCommit.hash}] ${revertMsg}`, tone: 'mint' },
          { text: '🛡️ 기존 기록을 지우지 않고 반대 커밋을 새로 쌓아 팀원도 안전해요!', tone: 'sky' },
        ],
        makeBubble(
          `revert-${seqNext}`,
          'buddy',
          48,
          52,
          '지난 변경을 취소하는 커밋을 만들었어요',
          `“${headCommit.message}”의 변경을 취소했어요. git log를 보면 원래 커밋과 취소 커밋을 모두 확인할 수 있어요.`,
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'REVERT') }),
        ),
      );
    }

    // git branch
    if (sub === 'branch') {
      const newName = tokens[2];
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
            '현재 평행우주 브랜치 목록이에요! 🌿',
            `별표(*)가 붙은 ${state.headBranch} 브랜치에 서 있어요.`,
            nextStepHintText(state),
          ),
        );
      }

      const headCommit = state.branches[state.headBranch] ?? 'c1';
      const draft: PixelSimState = {
        ...state,
        branches: { ...state.branches, [newName]: headCommit },
      };

      return finalizeTransition(
        state,
        draft,
        'BRANCH',
        `브랜치 ${newName} 생성`,
        newName,
        cmd,
        [{ text: `🌿 새 브랜치 '${newName}' 를 만들었어요 (이동하려면 git switch ${newName}).`, tone: 'mint' }],
        makeBubble(
          `branch-new-${seqNext}`,
          'buddy',
          42,
          52,
          `새 길 ${newName} 을 만들었어요! 🌿`,
          '원본 main을 망가뜨리지 않고 안전하게 새 기능을 실험할 수 있는 브랜치예요!',
          nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'BRANCH') }),
        ),
      );
    }

    // git switch / git checkout
    if (sub === 'switch' || sub === 'checkout') {
      const isCreate = tokens[2] === '-c' || tokens[2] === '-b';
      const targetBranch = isCreate ? tokens[3] : tokens[2];

      if (!targetBranch) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '브랜치 이름 필요',
          undefined,
          cmd,
          [{ text: '이동할 브랜치 이름을 적어 주세요! 예: git switch -c feat/dark', tone: 'amber' }],
          makeBubble(
            `switch-arg-${seqNext}`,
            'buddy',
            38,
            54,
            '어느 브랜치로 갈까요? 🤔',
            'git switch -c feat/dark 처럼 브랜치 이름을 함께 적어 주세요!',
            nextStepHintText(state),
          ),
        );
      }

      if (isCreate) {
        const headCommit = state.branches[state.headBranch] ?? 'c1';
        const nextBranches = state.branches[targetBranch]
          ? state.branches
          : { ...state.branches, [targetBranch]: headCommit };
        const draft: PixelSimState = {
          ...state,
          branches: nextBranches,
          headBranch: targetBranch,
        };
        const afterCompleted = withCompletedAction(draft.completedActions, 'BRANCH');
        const nextStep = getNextPendingStep({ ...draft, completedActions: afterCompleted });

        return finalizeTransition(
          state,
          draft,
          'BRANCH',
          `브랜치 ${targetBranch} 생성·이동`,
          targetBranch,
          cmd,
          [{ text: `🌿 Switched to a new branch '${targetBranch}'`, tone: 'mint' }],
          makeBubble(
            `switch-create-${seqNext}`,
            'buddy',
            44,
            52,
            `새 평행우주 ${targetBranch} 로 이동! 🌿`,
            '이제 여기서 마음껏 코드를 고쳐도 main 브랜치는 안전해요! 이번엔 feature/ui를 합쳐 볼까요?',
            nextStepHintText({ ...draft, completedActions: afterCompleted }),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'amber' }]
              : undefined,
          ),
        );
      }

      if (!state.branches[targetBranch]) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '없는 브랜치',
          targetBranch,
          cmd,
          [
            { text: `error: pathspec '${targetBranch}' did not match any branch.`, tone: 'coral' },
            { text: `사용 가능 브랜치: ${Object.keys(state.branches).join(', ')}`, tone: 'muted' },
          ],
          makeBubble(
            `switch-missing-${seqNext}`,
            'buddy',
            38,
            54,
            `'${targetBranch}' 브랜치가 아직 없어요! 🤔`,
            `새로 만들면서 이동하려면 git switch -c ${targetBranch} 를 입력해 보세요!`,
            nextStepHintText(state),
            [{ label: `🌿 새로 만들기 (-c ${targetBranch})`, command: `git switch -c ${targetBranch}`, tone: 'primary' }],
          ),
        );
      }

      const draft: PixelSimState = {
        ...state,
        headBranch: targetBranch,
      };
      return finalizeTransition(
        state,
        draft,
        'SWITCH',
        `${targetBranch} 로 이동`,
        targetBranch,
        cmd,
        [{ text: `🔀 Switched to branch '${targetBranch}'`, tone: 'sky' }],
        makeBubble(
          `switch-${seqNext}`,
          'buddy',
          42,
          54,
          `${targetBranch} 브랜치로 건너왔어요! 🔀`,
          `이제부터 만드는 커밋은 모두 ${targetBranch} 길 위에 차곡차곡 쌓여요.`,
          nextStepHintText(draft),
        ),
      );
    }

    // git merge
    if (sub === 'merge') {
      const targetBranch = tokens[2];
      if (!targetBranch || !state.branches[targetBranch]) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '머지 대상 확인',
          undefined,
          cmd,
          [
            { text: `합칠 브랜치를 찾을 수 없어요. 현재 브랜치: ${Object.keys(state.branches).join(', ')}`, tone: 'amber' },
          ],
          makeBubble(
            `merge-missing-${seqNext}`,
            'buddy',
            40,
            54,
            '어떤 브랜치를 합칠까요? 🤔',
            'git merge feature/ui 처럼 존재하는 브랜치 이름을 적어 주세요!',
            nextStepHintText(state),
          ),
        );
      }

      if (targetBranch === state.headBranch) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '같은 브랜치',
          undefined,
          cmd,
          [{ text: 'Already up to date. (자기 자신과는 이미 같아요!)', tone: 'muted' }],
          makeBubble(
            `merge-self-${seqNext}`,
            'buddy',
            40,
            54,
            '같은 브랜치끼리는 이미 같아요! 🙂',
            '다른 브랜치(예: feature/ui)를 합쳐 보세요!',
            nextStepHintText(state),
          ),
        );
      }

      const shouldConflict =
        targetBranch === 'feature/ui' ||
        (state.stageId === 'ch3' && !state.completedActions.includes('RESOLVE'));

      if (shouldConflict) {
        const conflictFile = 'theme.js';
        const nextFiles: PixelFile[] = state.files.some((f) => f.name === conflictFile)
          ? state.files.map((f) =>
              f.name === conflictFile
                ? {
                    ...f,
                    status: 'conflict',
                    content:
                      `<<<<<<< ${state.headBranch}\nexport const theme = "dark-midnight";\n=======\nexport const theme = "sunset-coral";\n>>>>>>> ${targetBranch}`,
                  }
                : f,
            )
          : [
              ...state.files,
              {
                name: conflictFile,
                status: 'conflict',
                content:
                  `<<<<<<< ${state.headBranch}\nexport const theme = "dark-midnight";\n=======\nexport const theme = "sunset-coral";\n>>>>>>> ${targetBranch}`,
              },
            ];

        const draft: PixelSimState = {
          ...state,
          files: nextFiles,
          conflict: {
            file: conflictFile,
            oursLabel: state.headBranch,
            theirsLabel: targetBranch,
            oursCode: 'export const theme = "dark-midnight"; // 내 브랜치',
            theirsCode: 'export const theme = "sunset-coral"; // 상대 브랜치',
            bothCode: 'export const theme = "dark-midnight";\nexport const alternateTheme = "sunset-coral";',
            resolvedChoice: 'none',
          },
        };

        return finalizeTransition(
          state,
          draft,
          'CONFLICT',
          '충돌(Conflict) 발생!',
          conflictFile,
          cmd,
          [
            { text: `Auto-merging ${conflictFile}`, tone: 'amber' },
            { text: `CONFLICT (content): Merge conflict in ${conflictFile}`, tone: 'coral' },
            { text: '⚡ 두 브랜치가 theme.js의 같은 줄을 다르게 고쳤어요! 아래 버튼으로 골라 주세요.', tone: 'amber' },
          ],
          makeBubble(
            `conflict-${seqNext}`,
            'buddy',
            48,
            52,
            'theme.js의 테마 색이 충돌했어요',
            `${state.headBranch}는 dark-midnight, ${targetBranch}는 sunset-coral을 골랐어요. 기본 테마로 쓸 색을 정하거나 두 색을 모두 남겨 보세요.`,
            '아래 3가지 해결 버튼 중 하나를 클릭해 보세요!',
            [
              { label: '내 코드 유지 (ours)', command: 'resolve ours', tone: 'primary' },
              { label: '상대 코드 채택 (theirs)', command: 'resolve theirs', tone: 'amber' },
              { label: '둘 다 합치기 (both)', command: 'resolve both', tone: 'mint' },
            ],
          ),
        );
      }

      // Clean merge
      const headId = state.branches[state.headBranch] ?? 'c1';
      const targetId = state.branches[targetBranch];
      const mergeId = `c${state.commits.length + 1}`;
      const mergeCommit: PixelCommit = {
        id: mergeId,
        hash: makeHash(seqNext, `merge-${targetBranch}`),
        message: `Merge branch '${targetBranch}' into ${state.headBranch}`,
        branch: state.headBranch,
        parents: [headId, targetId],
        isMerge: true,
      };
      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, mergeCommit],
        branches: { ...state.branches, [state.headBranch]: mergeId },
      };

      return finalizeTransition(
        state,
        draft,
        'MERGE_OK',
        '깔끔한 머지 성공',
        targetBranch,
        cmd,
        [
          { text: `Merge made by the 'ort' strategy.`, tone: 'mint' },
          { text: `[${state.headBranch} ${mergeCommit.hash}] ${mergeCommit.message}`, tone: 'sky' },
        ],
        makeBubble(
          `merge-ok-${seqNext}`,
          'buddy',
          46,
          52,
          '충돌 없이 깔끔하게 합쳤어요! 🤝',
          `${targetBranch}의 작업이 ${state.headBranch}로 부드럽게 합쳐졌어요!`,
          nextStepHintText(draft),
        ),
      );
    }

    // git rebase
    if (sub === 'rebase') {
      const baseBranch = tokens[2] ?? 'main';
      const baseId = state.branches[baseBranch];
      if (!baseId) {
        return finalizeTransition(
          state,
          state,
          'IDLE',
          '리베이스 대상 없음',
          undefined,
          cmd,
          [{ text: `fatal: invalid upstream '${baseBranch}'`, tone: 'coral' }],
          makeBubble(
            `rebase-err-${seqNext}`,
            'buddy',
            42,
            52,
            `'${baseBranch}' 브랜치를 못 찾았어요 🤔`,
            'git rebase main 처럼 기준이 될 브랜치 이름을 적어 주세요!',
            nextStepHintText(state),
          ),
        );
      }

      const rebasedId = `c${state.commits.length + 1}`;
      const currentHead = state.commits.find((c) => c.id === state.branches[state.headBranch]);
      const rebasedCommit: PixelCommit = {
        id: rebasedId,
        hash: makeHash(seqNext, `rebase-${baseBranch}`),
        message: `${currentHead?.message ?? '내 작업'} (rebased)`,
        branch: state.headBranch,
        parents: [baseId],
      };

      const draft: PixelSimState = {
        ...state,
        commits: [...state.commits, rebasedCommit],
        branches: { ...state.branches, [state.headBranch]: rebasedId },
      };

      return finalizeTransition(
        state,
        draft,
        'REBASE',
        `${baseBranch} 위로 리베이스`,
        rebasedCommit.hash,
        cmd,
        [
          { text: `Successfully rebased and updated refs/heads/${state.headBranch}.`, tone: 'mint' },
          { text: `📏 내 커밋이 ${baseBranch} 끝부분 위로 일직선 정렬됐어요!`, tone: 'sky' },
        ],
        makeBubble(
          `rebase-${seqNext}`,
          'buddy',
          48,
          52,
          '커밋을 한 줄로 깔끔하게 줄 세웠어요! 📏',
          `git rebase ${baseBranch} 는 내 작업을 ${baseBranch} 최신 끝으로 옮겨 달아 역사를 일직선으로 정돈해 줘요!`,
          nextStepHintText(draft),
        ),
      );
    }

    // git worktree add
    if (sub === 'worktree') {
      const branchIdx = tokens.indexOf('-b');
      const branchName = branchIdx !== -1 && tokens[branchIdx + 1] ? tokens[branchIdx + 1] : 'ai/fix';
      const dirName = tokens[branchIdx === 3 ? 5 : 3] ?? 'wt-ai';
      const baseCommit = state.branches[state.headBranch] ?? state.branches.main ?? 'c1';

      const draft: PixelSimState = {
        ...state,
        branches: { ...state.branches, [branchName]: baseCommit },
        ai: {
          ...state.ai,
          worktreeActive: true,
          worktreeBranch: branchName,
        },
      };

      return finalizeTransition(
        state,
        draft,
        'AI_WORKTREE',
        `작업실 ${dirName} 생성`,
        branchName,
        cmd,
        [
          { text: `Preparing worktree (new branch '${branchName}')`, tone: 'sky' },
          { text: `🏗️ 새 작업 폴더 './${dirName}'에서 ${branchName} 브랜치를 사용해요.`, tone: 'mint' },
        ],
        makeBubble(
          `worktree-${seqNext}`,
          'ai',
          66,
          52,
          `전용 작업실(${dirName}) 입주 완료! 🏗️`,
          `${dirName}에서 ${branchName} 브랜치의 파일을 편집할 수 있어요. 두 작업 폴더는 같은 저장소의 커밋 기록을 공유해요.`,
          'ai code 를 입력해서 AI가 코드를 수정하도록 시켜 보세요!',
          [{ label: '🪄 AI 코드 작성 (ai code)', command: 'ai code', tone: 'mint' }],
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
        const draft: PixelSimState = {
          ...state,
          completedActions: withCompletedAction(state.completedActions, 'AUTH_STATUS'),
        };
        const lines: TerminalLine[] = [
          { text: `${state.ghHost}`, tone: 'sky' },
          { text: `  ✓ Logged in to ${state.ghHost} account ${state.ghUser}`, tone: 'mint' },
          { text: `  ✓ Git operations protocol: ${state.token.sshReady ? 'ssh' : 'https'}`, tone: 'default' },
          { text: `  ✓ Token scopes: ${state.token.scopes.join(', ')}`, tone: 'muted' },
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
        const host = extractQuotedFlag(cmd, ['--hostname', '-h']);
        if (host) {
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
              { text: `✓ Logged in as ${state.ghUser} on ${host}`, tone: 'mint' },
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
            '표준 입력으로 인증하는 예제예요',
            '--with-token은 토큰을 표준 입력으로 받아요. 여기서는 연습 계정으로 인증 결과만 확인해요.',
            nextStepHintText(draft),
          ),
        );
      }
    }

    // gh repo view
    if (sub === 'repo' && sub2 === 'view') {
      return finalizeTransition(
        state,
        state,
        'GH_CMD',
        '저장소 정보 보기',
        'gitdots/app',
        cmd,
        [
          { text: '📦 gitdots/app — 도트로 배우는 Git & GitHub 실습 앱', tone: 'sky' },
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
        const title = extractQuotedFlag(cmd, ['--title', '-t']) ?? '새 기능 PR';
        const isDraft = cmd.includes('--draft') || cmd.includes('-d');
        const nextNum = state.prs.reduce((max, p) => Math.max(max, p.number), 0) + 1;
        const newPr: PixelPr = {
          number: nextNum,
          title,
          headBranch: state.headBranch,
          baseBranch: 'main',
          status: isDraft ? 'draft' : 'open',
          ci: 'pass',
          approved: false,
        };
        const draft: PixelSimState = {
          ...state,
          prs: [...state.prs, newPr],
        };
        const lines: TerminalLine[] = [
          { text: `📋 Creating pull request for ${state.headBranch} into main...`, tone: 'sky' },
          { text: `✓ https://${state.ghHost}/gitdots/app/pull/${nextNum} — "${title}"`, tone: 'mint' },
          { text: '✅ 자동 테스트(CI) 통과!', tone: 'mint' },
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
            `"${title}" PR이 열리고 자동 테스트도 통과했어요! 팀원들이 코드 변경점을 한눈에 리뷰할 수 있어요.`,
            nextStepHintText(previewState),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
              : undefined,
          ),
        );
      }

      if (sub2 === 'list') {
        const lines: TerminalLine[] =
          state.prs.length === 0
            ? [{ text: '열린 PR이 없어요.', tone: 'muted' }]
            : state.prs.map((p) => ({
                text: `#${p.number} [${p.status.toUpperCase()}] ${p.title} (${p.headBranch} → ${p.baseBranch}) CI:${p.ci}`,
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
            `현재 PR 목록 (${state.prs.length}건) 📑`,
            '진행 중인 코드 리뷰와 CI 통과 상태를 터미널에서 바로 확인할 수 있어요!',
            nextStepHintText(state),
          ),
        );
      }

      if (sub2 === 'merge') {
        const targetPr = [...state.prs].reverse().find((p) => p.status !== 'merged');
        if (!targetPr) {
          return finalizeTransition(
            state,
            state,
            'IDLE',
            '머지할 PR 없음',
            undefined,
            cmd,
            [{ text: '머지할 열린 PR이 없어요. 먼저 gh pr create 로 PR을 열어 주세요!', tone: 'amber' }],
            makeBubble(
              `gh-pr-merge-empty-${seqNext}`,
              'cloud',
              68,
              48,
              '아직 열려 있는 PR이 없어요! 📋',
              '먼저 gh pr create 로 코드 리뷰 요청서를 올린 뒤에 머지해 볼까요?',
              'gh pr create --title "새 기능" 을 실행해 보세요!',
              [
                {
                  label: '📋 PR 올리기',
                  command: 'gh pr create --title "새 기능"',
                  tone: 'primary',
                },
              ],
            ),
          );
        }

        const mainHead = state.branches.main ?? 'c1';
        const prHead = state.branches[targetPr.headBranch] ?? mainHead;
        const mergeId = `c${state.commits.length + 1}`;
        const mergeCommit: PixelCommit = {
          id: mergeId,
          hash: makeHash(seqNext, `gh-merge-${targetPr.number}`),
          message: `Merge PR #${targetPr.number}: ${targetPr.title}`,
          branch: 'main',
          parents: prHead !== mainHead ? [mainHead, prHead] : [mainHead],
          isMerge: true,
        };

        const nextPrs: PixelPr[] = state.prs.map((p) =>
          p.number === targetPr.number
            ? { ...p, status: 'merged', approved: true, ci: 'pass' }
            : p,
        );

        const draft: PixelSimState = {
          ...state,
          commits: [...state.commits, mergeCommit],
          branches: { ...state.branches, main: mergeId },
          remoteBranches: { ...state.remoteBranches, main: mergeId },
          prs: nextPrs,
        };

        return finalizeTransition(
          state,
          draft,
          'PR_MERGE',
          `PR #${targetPr.number} 머지`,
          mergeCommit.hash,
          cmd,
          [
            { text: `✓ Merged pull request #${targetPr.number} (${targetPr.title})`, tone: 'mint' },
            { text: `🎉 main 브랜치에 깔끔하게 반영되었어요! (${mergeCommit.hash})`, tone: 'lavender' },
          ],
          makeBubble(
            `gh-pr-merge-${seqNext}`,
            'cloud',
            68,
            48,
            `PR #${targetPr.number} 머지 완료! 🎊`,
            `"${targetPr.title}" 코드가 리뷰를 마치고 main 브랜치에 합쳐졌어요!`,
            nextStepHintText({ ...draft, completedActions: withCompletedAction(draft.completedActions, 'PR_MERGE') }),
          ),
        );
      }
    }

    // gh issue create / list
    if (sub === 'issue') {
      if (sub2 === 'create') {
        const title = extractQuotedFlag(cmd, ['--title', '-t']) ?? '버그 수정';
        const nextNum = state.issues.reduce((max, i) => Math.max(max, i.number), 0) + 1;
        const newIssue: PixelIssue = { number: nextNum, title, status: 'open' };
        const draft: PixelSimState = {
          ...state,
          issues: [...state.issues, newIssue],
          completedActions: withCompletedAction(state.completedActions, 'ISSUE_CREATE'),
        };
        const lines: TerminalLine[] = [
          { text: `📌 Creating issue in gitdots/app...`, tone: 'sky' },
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

    // gh run watch
    if (sub === 'run') {
      return finalizeTransition(
        state,
        state,
        'GH_CMD',
        'CI 실행 모니터링',
        'PASS',
        cmd,
        [
          { text: '🔄 Watching workflow "CI Build & Test"...', tone: 'sky' },
          { text: '  ✓ Checkout code (1s)', tone: 'mint' },
          { text: '  ✓ Install & Typecheck (3s)', tone: 'mint' },
          { text: '  ✓ Run Unit Tests (2s) — ALL PASSED!', tone: 'mint' },
        ],
        makeBubble(
          `gh-run-${seqNext}`,
          'cloud',
          68,
          48,
          '자동 테스트(CI) 전원 통과! ✅',
          'gh run watch 로 GitHub Actions 빌드 과정을 터미널에서 실시간으로 지켜봤어요!',
          nextStepHintText(state),
        ),
      );
    }

    // gh api
    if (sub === 'api') {
      const hostname = extractQuotedFlag(cmd, ['--hostname']) ?? state.ghHost;
      const endpoint = tokens[tokens[2] === '--hostname' ? 4 : 2] ?? '';
      // Also accept the full REST path used by older versions of the lesson.
      const legacyGhesPath = /^\/?api\/v3\/user\/?$/.test(endpoint);
      const apiPath = endpoint.replace(/^\//, '');
      if ((hostname === state.ghes.host && apiPath === 'user') || legacyGhesPath) {
        if (state.stageId === 'ch7' && !state.ghes.connected) {
          const nextGhes: GhesWorldState = {
            ...state.ghes,
            lastFlow: 'blocked',
            auditLogs: [
              ...state.ghes.auditLogs.slice(-5),
              '[DENY] 미인증 /api/v3 호출 — 사내 VPN 로그인 필요',
            ],
          };
          const draft: PixelSimState = { ...state, ghes: nextGhes };
          return finalizeTransition(
            state,
            draft,
            'GHES_BLOCK',
            '사내 인증 필요',
            '401',
            cmd,
            [
              { text: `HTTP 401 Unauthorized — ${state.ghes.host} 에 먼저 로그인해야 해요!`, tone: 'coral' },
            ],
            makeBubble(
              `ghes-api-unauth-${seqNext}`,
              'guard',
              54,
              48,
              '먼저 사내망 로그인을 해 주세요! 🔒',
              '사내 GHES API는 VPN + SAML 로그인을 마친 직원만 호출할 수 있어요.',
              'gh auth login --hostname github.corp.internal 로 먼저 로그인해 보세요!',
              [
                {
                  label: '🔓 사내망 로그인',
                  command: 'gh auth login --hostname github.corp.internal',
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
          'GHES /api/v3 호출',
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
            'gh가 사내 서버의 /api/v3/user에 요청했어요. 응답의 login 값이 현재 계정 이름이에요.',
            nextStepHintText({ ...draft, completedActions: afterCompleted }),
            nextStep
              ? [{ label: `▶ ${nextStep.command}`, command: nextStep.command, tone: 'mint' }]
              : undefined,
          ),
        );
      }

      if (hostname !== 'github.com' || apiPath !== 'repos/gitdots/app') {
        const example = state.stageId === 'ch7' ? 'gh api user --hostname github.corp.internal' : 'gh api repos/gitdots/app';
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
          text: `{ "full_name": "gitdots/app", "default_branch": "main", "open_issues": ${state.issues.length}, "prs": ${state.prs.length} }`,
          tone: 'mint',
        },
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
          '응답에서 full_name은 저장소 이름이고 default_branch는 기본 브랜치예요. 이 저장소의 기본 브랜치는 main이에요.',
          nextStepHintText(draft),
        ),
      );
    }
  }

  // ── Friendly fallback for unknown commands ───────────────────────────────
  const nextStep = getNextPendingStep(state);
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
      { text: '아래 추천 버튼을 누르거나 help 를 입력해 사용 가능한 명령어를 확인해 보세요.', tone: 'muted' },
    ],
    makeBubble(
      `unknown-${seqNext}`,
      'buddy',
      38,
      54,
      '어라, 모르는 명령어예요! 🤔',
      '어라, 모르는 명령어예요! 아래 추천 버튼을 누르거나 `help`를 입력해 볼까요?',
      nextStepHintText(state),
      fallbackActions,
    ),
  );
}

const GENERAL_CATALOG: { cmd: string; hint: string }[] = [
  { cmd: 'git status', hint: '작업실·장바구니 상태 보기' },
  { cmd: 'edit app.js', hint: 'app.js 파일 수정하기' },
  { cmd: 'git add .', hint: '수정 파일 장바구니(Staging) 담기' },
  { cmd: 'git commit -m "첫 세이브"', hint: '내 저장소에 세이브(커밋)하기' },
  { cmd: 'git push', hint: 'GitHub 구름으로 푸시하기' },
  { cmd: 'git log', hint: '커밋 타임라인 기록 보기' },
  { cmd: 'git diff', hint: '수정 전후 차이 비교하기' },
  { cmd: 'git stash', hint: '작업 중인 변경 서랍에 임시 보관' },
  { cmd: 'git stash pop', hint: '서랍에서 작업 다시 꺼내기' },
  { cmd: 'git revert HEAD', hint: '기록을 남기며 안전하게 취소' },
  { cmd: 'git reset --soft HEAD~1', hint: '커밋만 한 칸 되감기' },
  { cmd: 'git branch', hint: '브랜치 목록 보기' },
  { cmd: 'git switch -c feat/dark', hint: '새 브랜치 만들고 이동하기' },
  { cmd: 'git switch main', hint: 'main 브랜치로 이동하기' },
  { cmd: 'git merge feature/ui', hint: 'feature/ui 합치기 (충돌 체험)' },
  { cmd: 'resolve both', hint: '충돌 해결: 둘 다 합치기' },
  { cmd: 'resolve ours', hint: '충돌 해결: 내 코드 유지' },
  { cmd: 'resolve theirs', hint: '충돌 해결: 상대 코드 채택' },
  { cmd: 'git commit', hint: '머지 커밋 마무리하기' },
  { cmd: 'git rebase main', hint: 'main 위로 커밋 일직선 정렬' },
  { cmd: 'git fetch', hint: '원격 GitHub 최신 소식 확인' },
  { cmd: 'git pull', hint: '원격 최신 커밋 받아 합치기' },
  { cmd: 'gh auth status', hint: 'gh CLI 로그인 상태 확인' },
  { cmd: 'gh repo view', hint: '저장소 요약 보기' },
  { cmd: 'gh pr create --title "새 기능"', hint: 'Pull Request 생성하기' },
  { cmd: 'gh pr list', hint: '열린 PR 목록 보기' },
  { cmd: 'gh pr merge', hint: 'PR을 main에 머지하기' },
  { cmd: 'gh issue create --title "버그 수정"', hint: '새 이슈 카드 등록하기' },
  { cmd: 'gh run watch', hint: 'GitHub Actions CI 실시간 보기' },
  { cmd: 'gh api repos/gitdots/app', hint: 'GitHub REST API 조회하기' },
  { cmd: 'token classic', hint: '예제 classic 토큰의 권한 확인' },
  { cmd: 'token fine', hint: 'Fine-Grained 최소 권한 토큰' },
  { cmd: 'token sso', hint: '조직 SAML SSO 승인 도장' },
  { cmd: 'token ssh', hint: 'SSH 암호화 키 인증 설정' },
  { cmd: 'token leak-test', hint: 'Push Protection 유출 차단 체험' },
  { cmd: 'gh auth login --with-token', hint: '표준 입력으로 안전 토큰 로그인' },
  { cmd: 'ghes test-public', hint: '사내 방화벽 외부 차단 테스트' },
  { cmd: 'gh auth login --hostname github.corp.internal', hint: '사내 GHES 서버 로그인' },
  { cmd: 'gh api user --hostname github.corp.internal', hint: '사내 GitHub 계정 정보 조회' },
  { cmd: 'ghes runner', hint: '사내 Private Runner 빌드 실행' },
  { cmd: 'ghes cloud', hint: 'Cloud vs GHES 비교 보기' },
  { cmd: 'git worktree add -b ai/fix wt-ai', hint: 'AI 브랜치의 별도 작업 폴더 만들기' },
  { cmd: 'ai code', hint: 'AI가 버그 수정 코드 작성' },
  { cmd: 'ai push-main', hint: 'Branch Protection main 차단 체험' },
  { cmd: 'ai pr', hint: 'AI Draft PR + 자동 CI 통과' },
  { cmd: 'ai approve', hint: '사람 최종 승인 & 머지 (HITL)' },
  { cmd: 'help', hint: '현재 스테이지 도움말 보기' },
  { cmd: 'clear', hint: '터미널 화면 비우기' },
  { cmd: 'reset', hint: '현재 스테이지 처음부터 다시' },
];

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
    pushUnique('resolve both', '충돌 해결: 둘 다 합치기');
    pushUnique('resolve ours', '충돌 해결: 내 코드 유지');
    pushUnique('resolve theirs', '충돌 해결: 상대 코드 채택');
  } else if (state.conflict && state.conflict.resolvedChoice !== 'none') {
    pushUnique('git commit', '해결된 충돌을 머지 커밋으로 완료');
  }

  if (state.stageId === 'ch8' && state.ai.prNumber !== null && !state.ai.merged) {
    pushUnique('ai approve', '사람 최종 승인 & 머지 (HITL)');
  }

  // Stage steps & chips next
  for (const step of scenario.steps) {
    pushUnique(step.command, step.goal);
  }
  for (const chip of scenario.chips) {
    pushUnique(chip.command, chip.label);
  }
  for (const item of GENERAL_CATALOG) {
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
