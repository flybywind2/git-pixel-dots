import { resumePracticeBubbles } from '../engine';
import { getDocumentWorkingText } from '../engine/documentDiff';
import {
  ALL_STAGE_IDS, LESSON_ACTIONS,
  type AiWorldState, type BubbleAction, type DocumentPracticeState, type GhesWorldState,
  type PixelCommit, type PixelConflict, type PixelFile, type PixelIssue, type PixelPr,
  type PixelSimState, type PixelStash, type SpeechBubble, type StageId, type TokenWorldState,
} from '../types/sim';

// Bump the version when changing the saved snapshot shape or replacing a chapter's example.
// 시드(예제) 변경도 아래 stale* 감지 대상이에요. 저장본 shape가 같아도 새 예제가 필요하면 감지해요.
const SESSION_KEY = 'gitdots.practice.v4';
const LEGACY_KEYS = ['gitdots.practice.v3', 'gitdots.practice.v2', 'gitdots.practice.v1'] as const;
const DRAFT_SAVE_DELAY_MS = 250;
const TAB_DRAFT_KEY = 'gitdots.tab-draft';

export function saveTabDraft(session: PracticeSession) {
  if (session.sim.stageId !== 'docs' || typeof window === 'undefined') return;
  try {
    const old = JSON.parse(window.sessionStorage.getItem(TAB_DRAFT_KEY) ?? 'null');
    const base = session.documentDraft !== null && old?.text !== null && typeof old?.base === 'string'
      ? old.base : getDocumentWorkingText(session.sim);
    window.sessionStorage.setItem(TAB_DRAFT_KEY, JSON.stringify({ text: session.documentDraft, base }));
  } catch { /* browser storage may be unavailable */ }
}

export function readTabDraft(): { text: string | null; base: string } | null {
  try {
    const item = JSON.parse(window.sessionStorage.getItem(TAB_DRAFT_KEY) ?? 'null');
    return item && (item.text === null || typeof item.text === 'string') && typeof item.base === 'string' ? item : null;
  } catch { return null; }
}
type LegacyVersion = 'v3' | 'v2' | 'v1';
// v3→v4에서는 3장 보관과 취소 예제에 비밀 메모 빼기 미션이 추가됐어요. v2→v4는 4장 협업 예제와 5장 브랜치 이름(feat/ui) 변경, v1→v4는 이전 회의록 전환까지 포함해요.
const replacedExamples: Record<LegacyVersion, ReadonlySet<StageId>> = {
  v3: new Set<StageId>(['ch2']),
  v2: new Set<StageId>(['ch2', 'ch3', 'ch4']),
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
    body: isOptionalString,
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
    expires: isOptionalString,
  }),
  ghes: hasFields<GhesWorldState>({
    host: isString, connected: isBoolean, mode: oneOf('cloud', 'ghes'),
    lastFlow: oneOf('idle', 'blocked', 'unauth', 'vpn-ok', 'api-v3', 'runner'), auditLogs: strings,
  }),
  ai: hasFields<AiWorldState>({
    worktreeActive: isBoolean, worktreeBranch: isString, worktreeDir: isOptionalString,
    codeWritten: isBoolean, tokenSafe: isBoolean,
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
  sim.bubbles = resumePracticeBubbles(sim);
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
            legacyVersion = index === 0 ? 'v3' : index === 1 ? 'v2' : 'v1';
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
      // 6장(ch5)도 시드 변경 대상이에요. fix/font 브랜치가 없는 옛 저장본은
      // PR #12를 병합할 브랜치가 없어 막히므로 새 예제로 안내해요.
      const staleCh5 = id === 'ch5' && session !== null && !('fix/font' in session.sim.branches);
      if (!session) {
        issues[id] = 'invalid';
      } else if (staleExample || staleCh5 || (legacyVersion !== null && replacedExamples[legacyVersion].has(id))) {
        issues[id] = 'example-updated';
      } else {
        const tabDraft = id === 'docs' ? readTabDraft() : null;
        sessions[id] = tabDraft ? { ...session, documentDraft: tabDraft.text } : session;
        if (legacyVersion !== null && writeNow(session)) clearLegacyPracticeSessions(id);
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

function writeNow({ sim, documentDraft }: PracticeSession): boolean {
  const { lastAnim, terminal: _terminal, ...snapshot } = sim;
  const storage = getStorage();
  if (!storage) {
    notifyStorageFailure();
    return false;
  }
  try {
    storage.setItem(`${SESSION_KEY}.${sim.stageId}`, JSON.stringify({ sim: snapshot, seq: lastAnim.seq, documentDraft }));
    return true;
  } catch {
    // The page keeps the latest work in memory when browser storage is unavailable.
    notifyStorageFailure();
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * 저장본의 진행 상태만 비교할 수 있는 서명이에요.
 * lastAnim/terminal/bubbles는 화면 연출·복원 시점에 다시 만들어지므로 빼고 비교해요.
 * 두 탭이 같은 진행 상태에서 초안만 주고받는지(에코) 구분하는 데 사용해요.
 */
export function practiceProgressSignature(sim: PixelSimState): string {
  const { lastAnim: _lastAnim, terminal: _terminal, bubbles: _bubbles, ...progress } = sim;
  return stableStringify(progress);
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
  saveTabDraft(session);
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

/** 이 장에 아직 실행되지 않은 예약(지연) 저장이 있는지 확인해요. */
export function hasPendingPracticeSave(id: StageId): boolean {
  return pendingSaves.has(id);
}

/** 예약된 지연 저장만 취소해요. 이미 저장된 내용은 건드리지 않아요. */
export function cancelPendingPracticeSave(id: StageId) {
  const pending = pendingSaves.get(id);
  if (!pending) return;
  if (typeof window !== 'undefined') window.clearTimeout(pending.timer);
  pendingSaves.delete(id);
}

export function flushPracticeSaves() {
  for (const { session } of pendingSaves.values()) writePracticeSession(session);
}
