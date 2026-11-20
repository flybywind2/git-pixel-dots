import { resumePracticeBubbles, STAGE_MAP } from '../engine';
import {
  ALL_STAGE_IDS, LESSON_ACTIONS,
  type AiWorldState, type BubbleAction, type DocumentPracticeState, type GhesWorldState,
  type PixelCommit, type PixelConflict, type PixelFile, type PixelIssue, type PixelPr,
  type PixelSimState, type PixelStash, type SpeechBubble, type StageId, type TokenWorldState,
} from '../types/sim';

// Bump the version when changing the saved snapshot shape or replacing a chapter's example.
const SESSION_KEY = 'gitdots.practice.v3';
const LEGACY_KEYS = ['gitdots.practice.v2', 'gitdots.practice.v1'] as const;
const DRAFT_SAVE_DELAY_MS = 250;
type LegacyVersion = 'v2' | 'v1';
// v2→v3에서는 4장 협업 예제와 5장 브랜치 이름(feat/ui)이 바뀌었어요. v1→v3은 이전 회의록 전환까지 포함해요.
const replacedExamples: Record<LegacyVersion, ReadonlySet<StageId>> = {
  v2: new Set<StageId>(['ch3', 'ch4']),
  v1: new Set<StageId>(['ch1', 'ch2', 'ch3', 'ch4']),
};

export interface PracticeSession {
  sim: PixelSimState;
  documentDraft: string | null;
}

export type PracticeSaveIssue = 'invalid' | 'example-updated';

type SavedProgress = Omit<PixelSimState, 'lastAnim' | 'terminal'>;
type Check<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isString: Check<string> = (value): value is string => typeof value === 'string';
const isBoolean: Check<boolean> = (value): value is boolean => typeof value === 'boolean';
const isNumber: Check<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
const isCount: Check<number> = (value): value is number => isNumber(value) && Number.isSafeInteger(value) && value >= 0;

function oneOf<const T extends string>(...values: readonly T[]): Check<T> {
  const allowed = new Set<string>(values);
  return (value): value is T => isString(value) && allowed.has(value);
}

function arrayOf<T>(check: Check<T>): Check<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(check);
}

function nullable<T>(check: Check<T>): Check<T | null> {
  return (value): value is T | null => value === null || check(value);
}

function optional<T>(check: Check<T>): Check<T | undefined> {
  return (value): value is T | undefined => value === undefined || check(value);
}

function hasFields<T extends object>(fields: { [K in keyof T]-?: Check<T[K]> }): Check<T> {
  const entries = Object.entries(fields) as [string, Check<unknown>][];
  return (value): value is T => isRecord(value) && entries.every(([key, check]) => check(value[key]));
}

const strings = arrayOf(isString);
const stringRecord: Check<Record<string, string>> = (value): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every(isString);
const isOptionalBoolean = optional(isBoolean);
const isOptionalString = optional(isString);

const savedProgress = hasFields<SavedProgress>({
  stageId: oneOf(...ALL_STAGE_IDS),
  files: arrayOf(hasFields<PixelFile>({
    name: isString, content: isString,
    status: oneOf('untracked', 'modified', 'staged', 'committed', 'conflict'),
  })),
  index: stringRecord,
  document: optional(hasFields<DocumentPracticeState>({ comparison: oneOf('working', 'staged', 'commits') })),
  staged: strings,
  commits: arrayOf(hasFields<PixelCommit>({
    id: isString, hash: isString, message: isString, branch: isString, parents: strings, tree: stringRecord,
    isMerge: isOptionalBoolean, isRevert: isOptionalBoolean, ghost: isOptionalBoolean,
  })),
  branches: stringRecord,
  headBranch: isString,
  previousBranch: isOptionalString,
  origHead: isOptionalString,
  remoteBranches: stringRecord,
  stashes: arrayOf(hasFields<PixelStash>({ base: stringRecord, index: stringRecord, working: stringRecord })),
  stashCount: isCount,
  prs: arrayOf(hasFields<PixelPr>({
    number: isCount, title: isString, headBranch: isString, baseBranch: isString, approved: isBoolean,
    status: oneOf('open', 'draft', 'merged'), ci: oneOf('pending', 'running', 'pass'),
  })),
  issues: arrayOf(hasFields<PixelIssue>({ number: isCount, title: isString, status: oneOf('open', 'closed') })),
  conflict: nullable(hasFields<PixelConflict>({
    file: isString, oursLabel: isString, theirsLabel: isString, theirsCommit: isString,
    oursCode: isString, theirsCode: isString, bothCode: isString,
    oursDeleted: isOptionalBoolean, theirsDeleted: isOptionalBoolean,
    resolvedChoice: oneOf('none', 'ours', 'theirs', 'both', 'manual'),
    revert: optional(hasFields({ index: stringRecord, working: stringRecord })),
  })),
  ghHost: isString,
  ghUser: isString,
  token: hasFields<TokenWorldState>({
    mode: oneOf('classic', 'fine-grained'), scopes: strings,
    ssoAuthorized: isBoolean, sshReady: isBoolean, riskScore: isNumber, pushBlockedDemo: isBoolean,
  }),
  ghes: hasFields<GhesWorldState>({
    host: isString, connected: isBoolean, mode: oneOf('cloud', 'ghes'),
    lastFlow: oneOf('idle', 'blocked', 'vpn-ok', 'api-v3', 'runner'), auditLogs: strings,
  }),
  ai: hasFields<AiWorldState>({
    worktreeActive: isBoolean, worktreeBranch: isString, codeWritten: isBoolean, tokenSafe: isBoolean,
    mainPushBlocked: isBoolean, prNumber: nullable(isCount), humanApproved: isBoolean, merged: isBoolean,
  }),
  completedActions: arrayOf(oneOf(...LESSON_ACTIONS)),
  bubbles: arrayOf(hasFields<SpeechBubble>({
    id: isString, speaker: oneOf('buddy', 'cloud', 'guard', 'ai', 'system'), speakerName: isString,
    anchorX: isNumber, anchorY: isNumber, title: isString, message: isString, nextHint: isOptionalString,
    actions: optional(arrayOf(hasFields<BubbleAction>({
      label: isString, command: isString, tone: optional(oneOf('primary', 'mint', 'coral', 'amber')),
    }))),
  })),
});

function hasValidHistory(sim: SavedProgress): boolean {
  const ids = new Set<string>();
  for (const commit of sim.commits) {
    if (ids.has(commit.id) || !commit.parents.every((id) => ids.has(id))) return false;
    ids.add(commit.id);
  }
  return Object.hasOwn(sim.branches, sim.headBranch)
    && Object.values(sim.branches).every((id) => ids.has(id))
    && Object.values(sim.remoteBranches).every((id) => ids.has(id))
    && sim.stashCount === sim.stashes.length;
}

function decodeSession(raw: string, id: StageId, legacy: LegacyVersion | null): PracticeSession | null {
  const stored: unknown = JSON.parse(raw);
  if (!isRecord(stored) || !isRecord(stored.sim)) return null;
  const seq = legacy === 'v1' && isRecord(stored.sim.lastAnim) ? stored.sim.lastAnim.seq : stored.seq;
  const snapshot = legacy === 'v1' && stored.sim.bubbles === undefined ? { ...stored.sim, bubbles: [] } : stored.sim;
  if (!savedProgress(snapshot) || snapshot.stageId !== id || !hasValidHistory(snapshot) || !isCount(seq)
    || !nullable(isString)(stored.documentDraft) || (id === 'docs') !== Boolean(snapshot.document)) return null;

  const sim: PixelSimState = {
    ...snapshot,
    lastAnim: { kind: 'IDLE', seq, label: '실습 이어 하기' },
    terminal: [{
      id: 'resumed', command: 'welcome', branch: snapshot.headBranch,
      lines: [{ text: '저장한 작업과 진행 상태를 불러왔어요.', tone: 'muted' }],
    }],
  };
  sim.bubbles = resumePracticeBubbles(sim).map((bubble) => (
    legacy === 'v1' && /^\d+장 실습 완료$/.test(bubble.title)
      ? { ...bubble, title: `${STAGE_MAP[id].number}장 실습 완료` } : bubble
  ));
  return { sim, documentDraft: stored.documentDraft };
}

function getStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readPracticeSessions() {
  const sessions: Partial<Record<StageId, PracticeSession>> = {};
  const issues: Partial<Record<StageId, PracticeSaveIssue>> = {};
  const storage = getStorage();
  if (!storage) return { sessions, issues };

  for (const id of ALL_STAGE_IDS) {
    let current: string | null = null;
    let legacyRaw: string | null = null;
    let legacyVersion: LegacyVersion | null = null;
    try {
      current = storage.getItem(`${SESSION_KEY}.${id}`);
      if (current === null) {
        for (const [index, key] of LEGACY_KEYS.entries()) {
          const raw = storage.getItem(`${key}.${id}`);
          if (raw !== null) {
            legacyRaw = raw;
            legacyVersion = index === 0 ? 'v2' : 'v1';
            break;
          }
        }
      }
    } catch {
      break;
    }
    const raw = current ?? legacyRaw;
    if (raw === null) continue;
    try {
      const session = decodeSession(raw, id, legacyVersion);
      // 이미 v3으로 옮겨졌더라도 옛 브랜치 이름이 남아 있으면 새 예제로 안내해요.
      const staleExample = id === 'ch3' && session !== null && 'feature/ui' in session.sim.branches;
      if (!session) {
        issues[id] = 'invalid';
      } else if (staleExample || (legacyVersion !== null && replacedExamples[legacyVersion].has(id))) {
        issues[id] = 'example-updated';
      } else {
        sessions[id] = session;
        if (legacyVersion !== null) writeNow(session);
      }
    } catch {
      issues[id] = 'invalid';
    }
  }
  return { sessions, issues };
}

type StorageFailureListener = () => void;
let failureListener: StorageFailureListener | null = null;
let failureNotified = false;

export function setPracticeStorageFailureListener(listener: StorageFailureListener | null) {
  failureListener = listener;
}

function notifyStorageFailure() {
  if (failureNotified) return;
  failureNotified = true;
  failureListener?.();
}

export function practiceStorageAvailable(): boolean {
  return getStorage() !== undefined;
}

function writeNow({ sim, documentDraft }: PracticeSession) {
  const { lastAnim, terminal: _terminal, ...snapshot } = sim;
  const storage = getStorage();
  if (!storage) {
    notifyStorageFailure();
    return;
  }
  try {
    storage.setItem(`${SESSION_KEY}.${sim.stageId}`, JSON.stringify({ sim: snapshot, seq: lastAnim.seq, documentDraft }));
  } catch {
    // The page keeps the latest work in memory when browser storage is unavailable.
    notifyStorageFailure();
  }
}

export function readExternalSession(key: string, raw: string): { id: StageId; session: PracticeSession } | null {
  const prefix = `${SESSION_KEY}.`;
  if (!key.startsWith(prefix)) return null;
  const id = key.slice(prefix.length) as StageId;
  if (!ALL_STAGE_IDS.includes(id)) return null;
  try {
    const session = decodeSession(raw, id, null);
    return session ? { id, session } : null;
  } catch {
    return null;
  }
}

export function clearLegacyPracticeSessions(id: StageId) {
  const storage = getStorage();
  if (!storage) return;
  for (const key of LEGACY_KEYS) {
    try {
      storage.removeItem(`${key}.${id}`);
    } catch {
      // 저장소를 지울 수 없는 환경에서는 건너뛰어요.
    }
  }
}

const pendingSaves = new Map<StageId, { timer: number; session: PracticeSession }>();

export function writePracticeSession(session: PracticeSession, defer = false) {
  if (typeof window === 'undefined') return;
  const id = session.sim.stageId;
  const pending = pendingSaves.get(id);
  if (pending) {
    window.clearTimeout(pending.timer);
    pendingSaves.delete(id);
  }
  if (!defer) {
    writeNow(session);
    return;
  }
  const timer = window.setTimeout(() => {
    pendingSaves.delete(id);
    writeNow(session);
  }, DRAFT_SAVE_DELAY_MS);
  pendingSaves.set(id, { timer, session });
}

export function flushPracticeSaves() {
  for (const { session } of pendingSaves.values()) writePracticeSession(session);
}
