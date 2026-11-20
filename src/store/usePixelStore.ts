import { create } from 'zustand';
import { ALL_STAGE_IDS, type PixelSimState, type StageId } from '../types/sim';
import { createStageState, executePixelCommand, pendingHardReset, savePracticeDocument } from '../engine';
import { getDocumentWorkingText } from '../engine/documentDiff';

const SESSION_KEY = 'gitdots.practice.v1';

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

interface PracticeSession {
  sim: PixelSimState;
  documentDraft: string | null;
}

export type PracticeConfirmation = { kind: 'lesson-reset' } | { kind: 'hard-reset'; command: string; target: string };

export interface PixelStore extends PracticeSession {
  stageId: StageId;
  sessions: Partial<Record<StageId, PracticeSession>>;
  history: string[];
  helpOpen: boolean;
  confirmation: PracticeConfirmation | null;
  notice: string | null;

  setStage: (id: StageId) => void;
  runCommand: (cmd: string) => void;
  resetStage: () => void;
  setDocumentDraft: (text: string) => void;
  saveDocument: () => void;
  setHelpOpen: (open: boolean) => void;
  resolveConfirmation: (confirmed: boolean) => void;
}

function freshSession(id: StageId): PracticeSession {
  return { sim: createStageState(id), documentDraft: null };
}

function readSessions() {
  const sessions: PixelStore['sessions'] = {};
  if (typeof window === 'undefined') return sessions;
  for (const id of ALL_STAGE_IDS) {
    try {
      const raw = window.localStorage.getItem(`${SESSION_KEY}.${id}`);
      if (!raw) continue;
      const { sim, documentDraft } = JSON.parse(raw) as PracticeSession;
      if (sim.stageId !== id || !Array.isArray(sim.files) || !sim.index || !sim.branches
        || !Array.isArray(sim.completedActions) || !Array.isArray(sim.commits)
        || !sim.commits.every((commit) => commit.tree && Array.isArray(commit.parents))) continue;
      sessions[id] = { sim, documentDraft: typeof documentDraft === 'string' ? documentDraft : null };
    } catch {
      // Treat a missing or unreadable browser save as a fresh chapter.
    }
  }
  return sessions;
}

function applySession(state: PixelStore, sim: PixelSimState, documentDraft: string | null) {
  const current = { sim, documentDraft };
  const sessions = { ...state.sessions, [sim.stageId]: current };
  if (typeof window !== 'undefined') {
    try {
      // Keep repository versions and progress. Terminal input only lives in the page.
      const resume = {
        ...sim,
        lastAnim: { kind: 'IDLE', seq: sim.lastAnim.seq, label: '실습 이어 하기' },
        bubbles: [],
        terminal: [{
          id: 'resumed', command: 'welcome', branch: sim.headBranch,
          lines: [{ text: '저장한 작업과 진행 상태를 불러왔어요.', tone: 'muted' }],
        }],
      };
      window.localStorage.setItem(`${SESSION_KEY}.${sim.stageId}`, JSON.stringify({ sim: resume, documentDraft }));
    } catch {
      // The current page still keeps each chapter's work if browser storage is unavailable.
    }
  }
  return { ...current, sessions, notice: null, confirmation: null };
}

function execute(state: PixelStore, command: string) {
  const sim = executePixelCommand(state.sim, command);
  const last = state.history.at(-1);
  return {
    ...applySession(state, sim, state.documentDraft),
    history: last === command ? state.history : [...state.history.slice(-49), command],
  };
}

const sessions = readSessions();
const initialStage = typeof window === 'undefined' ? 'docs' : stageFromHash(window.location.hash);

export const usePixelStore = create<PixelStore>((set) => ({
  ...(sessions[initialStage] ?? freshSession(initialStage)),
  stageId: initialStage,
  sessions,
  history: [],
  helpOpen: false,
  confirmation: null,
  notice: null,

  setStage: (id) => {
    const hash = chapterHash(id);
    if (typeof window !== 'undefined' && window.location.hash !== hash) window.location.hash = hash;
    set((state) => state.stageId === id ? state : {
      ...(state.sessions[id] ?? freshSession(id)),
      stageId: id,
      notice: null,
      confirmation: null,
    });
  },

  runCommand: (raw) => set((state) => {
    const command = raw.trim();
    if (!command) return state;
    if (command.toLowerCase() === 'reset') return { confirmation: { kind: 'lesson-reset' } };
    const unsaved = state.documentDraft !== null && state.documentDraft !== getDocumentWorkingText(state.sim);
    if (unsaved && /^(?:(?:edit|resolve)\b|git\s+(?:add|commit|diff|revert|reset|switch|checkout|stash)\b)/i.test(command)) {
      return { notice: '먼저 문서를 저장하세요. 지금 편집한 내용은 아직 작업 파일에 반영되지 않았어요.' };
    }
    const target = pendingHardReset(state.sim, command);
    if (target) return { confirmation: { kind: 'hard-reset', command, target } };
    return execute(state, command);
  }),

  resetStage: () => set({ confirmation: { kind: 'lesson-reset' } }),

  resolveConfirmation: (confirmed) => set((state) => {
    if (!confirmed || !state.confirmation) return { confirmation: null };
    if (state.confirmation.kind === 'hard-reset') return execute(state, state.confirmation.command);
    return applySession(state, createStageState(state.stageId), null);
  }),

  setDocumentDraft: (text) => set((state) =>
    applySession(state, state.sim, text === getDocumentWorkingText(state.sim) ? null : text),
  ),

  saveDocument: () => set((state) => {
    if (state.documentDraft === null) return state;
    const sim = savePracticeDocument(state.sim, state.documentDraft);
    const saved = sim.lastAnim.kind === 'EDIT' || getDocumentWorkingText(sim) === state.documentDraft;
    return applySession(state, sim, saved ? null : state.documentDraft);
  }),

  setHelpOpen: (open) => set({ helpOpen: open }),
}));
