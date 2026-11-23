import { create } from 'zustand';
import { ALL_STAGE_IDS, type PixelSimState, type StageId } from '../types/sim';
import { createStageState, executePixelCommand, pendingHardReset, savePracticeDocument } from '../engine';
import { EXAMPLE_DOCUMENT, getDocumentWorkingText } from '../engine/documentDiff';
import {
  cancelPendingPracticeSave, clearLegacyPracticeSessions, flushPracticeSaves, practiceStorageAvailable,
  readPracticeSessions, setPracticeStorageFailureListener, writePracticeSession,
  type PracticeSaveIssue, type PracticeSession,
} from './practiceStorage';

export function chapterHash(id: StageId): string {
  return `#/chapter/${ALL_STAGE_IDS.indexOf(id) + 1}`;
}

export function stageFromHash(hash: string): StageId {
  const path = hash.replace(/^#\/?/, '').replace(/\/$/, '');
  const numbered = /^chapter\/([1-9])$/.exec(path);
  if (numbered) return ALL_STAGE_IDS[Number(numbered[1]) - 1] ?? 'docs';
  return ALL_STAGE_IDS.find((id) => id === path) ?? 'docs';
}

export function syncChapterLocation(): StageId {
  const id = stageFromHash(window.location.hash);
  const hash = chapterHash(id);
  if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash);
  return id;
}

export type PracticeConfirmation =
  | { kind: 'lesson-reset' }
  | { kind: 'replace-draft' }
  | { kind: 'undo-draft' }
  | { kind: 'hard-reset'; command: string; target: string };

export interface PixelStore extends PracticeSession {
  stageId: StageId;
  sessions: Partial<Record<StageId, PracticeSession>>;
  undoStacks: Partial<Record<StageId, PracticeSession[]>>;
  saveIssues: Partial<Record<StageId, PracticeSaveIssue>>;
  history: string[];
  helpOpen: boolean;
  certificateOpen: boolean;
  confirmation: PracticeConfirmation | null;
  notice: string | null;
  storageWarning: boolean;

  setStage: (id: StageId) => void;
  runCommand: (cmd: string) => void;
  undoStep: () => void;
  resetStage: () => void;
  resetStageImmediately: () => void;
  setDocumentDraft: (text: string) => void;
  loadExampleDocument: () => void;
  saveDocument: () => void;
  setHelpOpen: (open: boolean) => void;
  setCertificateOpen: (open: boolean) => void;
  resolveConfirmation: (confirmed: boolean) => void;
  dismissStorageWarning: () => void;
  adoptExternalSession: (id: StageId, session: PracticeSession) => void;
}

const MAX_UNDO_STEPS = 20;

function freshSession(id: StageId): PracticeSession {
  return { sim: createStageState(id), documentDraft: null };
}

function pushUndoSnapshot(state: PixelStore) {
  const stack = state.undoStacks[state.stageId] ?? [];
  const snapshot: PracticeSession = { sim: state.sim, documentDraft: state.documentDraft };
  return {
    ...state.undoStacks,
    [state.stageId]: [...stack.slice(-(MAX_UNDO_STEPS - 1)), snapshot],
  };
}

function clearUndoStack(state: PixelStore) {
  if (!state.undoStacks[state.stageId]?.length) return state.undoStacks;
  return { ...state.undoStacks, [state.stageId]: [] };
}

function applySession(state: PixelStore, sim: PixelSimState, documentDraft: string | null, defer = false) {
  const current = { sim, documentDraft };
  const sessions = { ...state.sessions, [sim.stageId]: current };
  const saveIssues = state.saveIssues[sim.stageId] ? { ...state.saveIssues, [sim.stageId]: undefined } : state.saveIssues;
  writePracticeSession(current, defer);
  return { ...current, sessions, saveIssues, notice: null, confirmation: null };
}

function applyDocumentDraft(state: PixelStore, text: string, defer = false) {
  const draft = text === getDocumentWorkingText(state.sim) ? null : text;
  return applySession(state, state.sim, draft, defer);
}

// 비교 탭 전환이나 화면 연출만 바뀐 경우는 되돌리기 기록에 쌓지 않아요.
// 파일·장바구니·커밋·브랜치·학습 진행처럼 실제로 달라진 상태만 기록해요.
function practiceProgressChanged(before: PixelSimState, after: PixelSimState): boolean {
  return after.files !== before.files
    || after.index !== before.index
    || after.staged !== before.staged
    || after.commits !== before.commits
    || after.branches !== before.branches
    || after.headBranch !== before.headBranch
    || after.previousBranch !== before.previousBranch
    || after.origHead !== before.origHead
    || after.remoteBranches !== before.remoteBranches
    || after.stashes !== before.stashes
    || after.stashCount !== before.stashCount
    || after.prs !== before.prs
    || after.issues !== before.issues
    || after.conflict !== before.conflict
    || after.token !== before.token
    || after.ghes !== before.ghes
    || after.ai !== before.ai
    || after.completedActions !== before.completedActions;
}

function hasUnsavedDraft(state: PixelStore): boolean {
  return state.documentDraft !== null && state.documentDraft !== getDocumentWorkingText(state.sim);
}

function execute(state: PixelStore, command: string) {
  const sim = executePixelCommand(state.sim, command);
  const last = state.history.at(-1);
  const changed = practiceProgressChanged(state.sim, sim);
  return {
    ...applySession(state, sim, state.documentDraft),
    undoStacks: changed ? pushUndoSnapshot(state) : state.undoStacks,
    history: last === command ? state.history : [...state.history.slice(-49), command],
  };
}

function applyUndo(state: PixelStore) {
  const stack = state.undoStacks[state.stageId];
  if (!stack || stack.length === 0) return state;
  const previous = stack[stack.length - 1];
  // 되돌린 결과가 예전 명령의 애니메이션으로 정방향 재재생되지 않도록
  // 현재 애니메이션 번호를 그대로 두고 조용한 상태로 복원해요.
  const restored: PixelSimState = {
    ...previous.sim,
    lastAnim: { kind: 'IDLE', seq: state.sim.lastAnim.seq, label: '한 단계 되돌림' },
  };
  return {
    ...applySession(state, restored, previous.documentDraft),
    undoStacks: { ...state.undoStacks, [state.stageId]: stack.slice(0, -1) },
  };
}

const { sessions, issues: saveIssues } = readPracticeSessions();
const initialStage = typeof window === 'undefined' ? 'docs' : stageFromHash(window.location.hash);

export const usePixelStore = create<PixelStore>((set) => ({
  ...(sessions[initialStage] ?? freshSession(initialStage)),
  stageId: initialStage,
  sessions,
  undoStacks: {},
  saveIssues,
  history: [],
  helpOpen: false,
  certificateOpen: false,
  confirmation: null,
  notice: null,
  storageWarning: !practiceStorageAvailable(),

  setStage: (id) => {
    const hash = chapterHash(id);
    if (typeof window !== 'undefined' && window.location.hash !== hash) window.location.hash = hash;
    set((state) => {
      if (state.stageId === id) return state;
      flushPracticeSaves();
      return {
        ...(state.sessions[id] ?? freshSession(id)),
        stageId: id,
        notice: null,
        confirmation: null,
      };
    });
  },

  runCommand: (raw) => set((state) => {
    const command = raw.trim();
    if (!command) return state;
    if (command.toLowerCase() === 'reset') return { confirmation: { kind: 'lesson-reset' } };
    if (state.saveIssues[state.stageId]) return state;
    const unsaved = state.documentDraft !== null && state.documentDraft !== getDocumentWorkingText(state.sim);
    if (unsaved && /^(?:(?:edit|resolve)\b|git\s+(?:add|commit|diff|revert|reset|switch|checkout|stash)\b)/i.test(command)) {
      return { notice: '먼저 문서를 저장하세요. 지금 편집한 내용은 아직 작업 파일에 반영되지 않았어요.' };
    }
    const target = pendingHardReset(state.sim, command);
    if (target) return { confirmation: { kind: 'hard-reset', command, target } };
    return execute(state, command);
  }),

  undoStep: () => set((state) => {
    const stack = state.undoStacks[state.stageId];
    if (!stack || stack.length === 0) return state;
    // 아직 저장하지 않은 초안을 되돌리기가 덮어쓰려 하면 먼저 확인해요.
    if (hasUnsavedDraft(state)) return { confirmation: { kind: 'undo-draft' } };
    return applyUndo(state);
  }),

  resetStage: () => set({ confirmation: { kind: 'lesson-reset' } }),

  resetStageImmediately: () => set((state) => {
    clearLegacyPracticeSessions(state.stageId);
    return {
      ...applySession(state, createStageState(state.stageId), null),
      undoStacks: clearUndoStack(state),
    };
  }),

  resolveConfirmation: (confirmed) => set((state) => {
    if (!confirmed || !state.confirmation) return { confirmation: null };
    if (state.confirmation.kind === 'hard-reset') return execute(state, state.confirmation.command);
    if (state.confirmation.kind === 'replace-draft') return applyDocumentDraft(state, EXAMPLE_DOCUMENT);
    if (state.confirmation.kind === 'undo-draft') return applyUndo({ ...state, confirmation: null });
    clearLegacyPracticeSessions(state.stageId);
    return {
      ...applySession(state, createStageState(state.stageId), null),
      undoStacks: clearUndoStack(state),
    };
  }),

  setDocumentDraft: (text) => set((state) => applyDocumentDraft(state, text, true)),

  loadExampleDocument: () => set((state) => {
    if (state.documentDraft !== null && state.documentDraft !== EXAMPLE_DOCUMENT) {
      return { confirmation: { kind: 'replace-draft' } };
    }
    return applyDocumentDraft(state, EXAMPLE_DOCUMENT);
  }),

  saveDocument: () => set((state) => {
    if (state.documentDraft === null) return state;
    const sim = savePracticeDocument(state.sim, state.documentDraft);
    const saved = sim.lastAnim.kind === 'EDIT' || getDocumentWorkingText(sim) === state.documentDraft;
    return {
      ...applySession(state, sim, saved ? null : state.documentDraft),
      undoStacks: saved ? pushUndoSnapshot(state) : state.undoStacks,
    };
  }),

  setHelpOpen: (open) => set({ helpOpen: open }),

  setCertificateOpen: (open) => set({ certificateOpen: open }),

  dismissStorageWarning: () => set({ storageWarning: false }),

  adoptExternalSession: (id, session) => {
    // 다른 탭의 저장본을 받아들이기 전에 이 탭에서 예약해 둔 저장을 취소해요.
    // 그래야 늦게 도착한 예전 초안이 새 저장본을 다시 덮어쓰지 않아요.
    cancelPendingPracticeSave(id);
    set((state) => {
      const sessions = { ...state.sessions, [id]: session };
      const saveIssues = state.saveIssues[id] ? { ...state.saveIssues, [id]: undefined } : state.saveIssues;
      // 외부 저장본을 채택하면 이 장의 예전 스냅샷은 더 이상 최신 상태가 아니에요.
      // 현재 장과 비활성 장 모두 되돌리기 기록을 비워 다른 탭의 최신 저장본을 지키게 해요.
      const undoStacks = state.undoStacks[id]?.length
        ? { ...state.undoStacks, [id]: [] } : state.undoStacks;
      if (id !== state.stageId) return { sessions, saveIssues, undoStacks };
      // 다른 탭의 진행 상태를 받더라도 이 탭에서 입력 중인 초안은 지우지 않아요.
      const documentDraft = state.documentDraft !== null ? state.documentDraft : session.documentDraft;
      // 예약 저장을 취소했으므로, 이 탭의 미저장 초안을 새 진행 상태와 함께 다시 저장해요.
      // 그래야 곧바로 새로고침해도 방금 입력한 초안이 사라지지 않아요.
      if (state.documentDraft !== null) {
        writePracticeSession({ sim: session.sim, documentDraft }, true);
      }
      return { ...session, documentDraft, stageId: id, sessions, saveIssues, undoStacks, notice: null, confirmation: null };
    });
  },
}));

setPracticeStorageFailureListener(() => usePixelStore.setState({ storageWarning: true }));
