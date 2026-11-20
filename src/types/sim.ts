export type StageId =
  | 'ch1'
  | 'docs'
  | 'ch2'
  | 'ch3'
  | 'ch4'
  | 'ch5'
  | 'ch6'
  | 'ch7'
  | 'ch8';

export const ALL_STAGE_IDS: readonly StageId[] = [
  'docs',
  'ch1',
  'ch2',
  'ch3',
  'ch4',
  'ch5',
  'ch6',
  'ch7',
  'ch8',
] as const;

export type BubbleSpeaker = 'buddy' | 'cloud' | 'guard' | 'ai' | 'system';

export interface BubbleAction {
  label: string;
  command: string;
  tone?: 'primary' | 'mint' | 'coral' | 'amber';
}

export interface SpeechBubble {
  id: string;
  speaker: BubbleSpeaker;
  speakerName: string;
  /** Normalized stage coordinates 15..85 (% of canvas width / height) */
  anchorX: number;
  anchorY: number;
  title: string;
  message: string;
  nextHint?: string;
  actions?: BubbleAction[];
}

export type PixelFileStatus = 'untracked' | 'modified' | 'staged' | 'committed' | 'conflict';

export interface PixelFile {
  name: string;
  status: PixelFileStatus;
  content: string;
}

export type FileTree = Readonly<Record<string, string>>;

export interface PixelCommit {
  id: string;
  hash: string;
  message: string;
  branch: string;
  parents: string[];
  tree: FileTree;
  isMerge?: boolean;
  isRevert?: boolean;
  ghost?: boolean;
}

export interface PixelPr {
  number: number;
  title: string;
  headBranch: string;
  baseBranch: string;
  status: 'open' | 'draft' | 'merged';
  ci: 'pending' | 'running' | 'pass';
  approved: boolean;
}

export interface PixelIssue {
  number: number;
  title: string;
  status: 'open' | 'closed';
}

export interface PixelConflict {
  file: string;
  oursLabel: string;
  theirsLabel: string;
  theirsCommit: string;
  oursCode: string;
  theirsCode: string;
  bothCode: string;
  oursDeleted?: boolean;
  theirsDeleted?: boolean;
  resolvedChoice: 'none' | 'ours' | 'theirs' | 'both' | 'manual';
  revert?: {
    index: FileTree;
    working: FileTree;
  };
}

export interface TokenWorldState {
  mode: 'classic' | 'fine-grained';
  scopes: string[];
  ssoAuthorized: boolean;
  sshReady: boolean;
  riskScore: number; // 0..100
  pushBlockedDemo: boolean;
}

export interface GhesWorldState {
  host: string;
  connected: boolean;
  mode: 'cloud' | 'ghes';
  lastFlow: 'idle' | 'blocked' | 'vpn-ok' | 'api-v3' | 'runner';
  auditLogs: string[];
}

export interface AiWorldState {
  worktreeActive: boolean;
  worktreeBranch: string;
  codeWritten: boolean;
  tokenSafe: boolean;
  mainPushBlocked: boolean;
  prNumber: number | null;
  humanApproved: boolean;
  merged: boolean;
}

export type PixelAnimKind =
  | 'IDLE'
  | 'EDIT'
  | 'ADD'
  | 'COMMIT'
  | 'PUSH'
  | 'PULL'
  | 'FETCH'
  | 'STASH'
  | 'STASH_POP'
  | 'RESET'
  | 'REVERT'
  | 'BRANCH'
  | 'SWITCH'
  | 'MERGE_OK'
  | 'CONFLICT'
  | 'RESOLVE'
  | 'REBASE'
  | 'PR_CREATE'
  | 'PR_MERGE'
  | 'GH_CMD'
  | 'TOKEN_CLASSIC'
  | 'TOKEN_FINE'
  | 'TOKEN_SSO'
  | 'TOKEN_SSH'
  | 'TOKEN_BLOCK'
  | 'GHES_LOGIN'
  | 'GHES_BLOCK'
  | 'GHES_API'
  | 'GHES_RUNNER'
  | 'AI_WORKTREE'
  | 'AI_CODE'
  | 'AI_BLOCK_MAIN'
  | 'AI_PR'
  | 'AI_APPROVE';

export interface PixelAnimEvent {
  kind: PixelAnimKind;
  seq: number;
  label: string;
  detail?: string;
}

export type TerminalLineTone = 'default' | 'mint' | 'amber' | 'coral' | 'sky' | 'muted' | 'lavender';

export interface TerminalLine {
  text: string;
  tone: TerminalLineTone;
}

export interface TerminalLogEntry {
  id: string;
  command: string;
  branch: string;
  lines: TerminalLine[];
}

export interface CommandChip {
  command: string;
  label: string;
  stepIndex?: number;
}

export interface StageStep {
  id: string;
  label: string;
  goal: string;
  command: string;
  doneAction: LessonAction | LessonAction[];
}

export type LessonAction =
  | PixelAnimKind
  | 'MERGE_COMMIT'
  | 'AUTH_STATUS'
  | 'ISSUE_CREATE'
  | 'REPO_API'
  | 'FIREWALL_TEST'
  | 'DOCUMENT_WORKING_DIFF'
  | 'DOCUMENT_STAGED_DIFF'
  | 'DOCUMENT_COMMIT_DIFF';

export type DocumentComparison = 'working' | 'staged' | 'commits';

export interface DocumentPracticeState {
  comparison: DocumentComparison;
}

export interface PixelStash {
  base: FileTree;
  index: FileTree;
  working: FileTree;
}

export interface StageScenario {
  id: StageId;
  number: number;
  track: 'basic' | 'advanced';
  shortTitle: string;
  title: string;
  tagline: string;
  takeaway: string;
  terms: { name: string; meaning: string }[];
  accent: string;
  steps: StageStep[];
  chips: CommandChip[];
  cheatSheet: { cmd: string; desc: string }[];
}

export interface PixelSimState {
  stageId: StageId;
  files: PixelFile[];
  index: FileTree;
  document?: DocumentPracticeState;
  staged: string[];
  commits: PixelCommit[];
  branches: Record<string, string>; // branch -> commitId
  headBranch: string;
  previousBranch?: string;
  origHead?: string;
  remoteBranches: Record<string, string>;
  stashes: PixelStash[];
  stashCount: number;
  prs: PixelPr[];
  issues: PixelIssue[];
  conflict: PixelConflict | null;
  ghHost: string;
  ghUser: string;
  token: TokenWorldState;
  ghes: GhesWorldState;
  ai: AiWorldState;
  lastAnim: PixelAnimEvent;
  completedActions: LessonAction[];
  bubbles: SpeechBubble[];
  terminal: TerminalLogEntry[];
}
