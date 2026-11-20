import { create } from 'zustand';
import { ALL_STAGE_IDS, type PixelSimState, type StageId } from '../types/sim';
import { createStageState, executePixelCommand, pendingHardReset, savePracticeDocument } from '../engine';
import { EXAMPLE_DOCUMENT, getDocumentWorkingText } from '../engine/documentDiff';
import {
  flushPracticeSaves, practiceStorageAvailable, readPracticeSessions, setPracticeStorageFailureListener,
  writePracticeSession, type PracticeSaveIssue, type PracticeSession,
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
  | { kind: 'hard-reset'; command: string; target: string };

export interface PixelStore extends PracticeSession {
  stageId: StageId;
  sessions: Partial<Record<StageId, PracticeSession>>;
  saveIssues: Partial<Record<StageId, PracticeSaveIssue>>;
  history: string[];
  helpOpen: boolean;
  confirmation: PracticeConfirmation | null;
  notice: string | null;
  storageWarning: boolean;

  setStage: (id: StageId) => void;
  runCommand: (cmd: string) => void;
  resetStage: () => void;
  resetStageImmediately: () => void;
  setDocumentDraft: (text: string) => void;
  loadExampleDocument: () => void;
  saveDocument: () => void;
  setHelpOpen: (open: boolean) => void;
  resolveConfirmation: (confirmed: boolean) => void;
  dismissStorageWarning: () => void;
  adoptExternalSession: (id: StageId, session: PracticeSession) => void;
}

function freshSession(id: StageId): PracticeSession {
  return { sim: createStageState(id), documentDraft: null };
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

function execute(state: PixelStore, command: string) {
  const sim = executePixelCommand(state.sim, command);
  const last = state.history.at(-1);
  return {
    ...applySession(state, sim, state.documentDraft),
    history: last === command ? state.history : [...state.history.slice(-49), command],
  };
}

const { sessions, issues: saveIssues } = readPracticeSessions();
const initialStage = typeof window === 'undefined' ? 'docs' : stageFromHash(window.location.hash);

export const usePixelStore = create<PixelStore>((set) => ({
  ...(sessions[initialStage] ?? freshSession(initialStage)),
  stageId: initialStage,
  sessions,
  saveIssues,
  history: [],
  helpOpen: false,
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

  resetStage: () => set({ confirmation: { kind: 'lesson-reset' } }),

  resetStageImmediately: () => set((state) => applySession(state, createStageState(state.stageId), null)),

  resolveConfirmation: (confirmed) => set((state) => {
    if (!confirmed || !state.confirmation) return { confirmation: null };
    if (state.confirmation.kind === 'hard-reset') return execute(state, state.confirmation.command);
    if (state.confirmation.kind === 'replace-draft') return applyDocumentDraft(state, EXAMPLE_DOCUMENT);
    return applySession(state, createStageState(state.stageId), null);
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
    return applySession(state, sim, saved ? null : state.documentDraft);
  }),

  setHelpOpen: (open) => set({ helpOpen: open }),

  dismissStorageWarning: () => set({ storageWarning: false }),

  adoptExternalSession: (id, session) => set((state) => {
    const sessions = { ...state.sessions, [id]: session };
    const saveIssues = state.saveIssues[id] ? { ...state.saveIssues, [id]: undefined } : state.saveIssues;
    if (id !== state.stageId) return { sessions, saveIssues };
    return { ...session, stageId: id, sessions, saveIssues, notice: null, confirmation: null };
  }),
}));

setPracticeStorageFailureListener(() => usePixelStore.setState({ storageWarning: true }));
