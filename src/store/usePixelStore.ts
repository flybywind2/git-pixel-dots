import { create } from 'zustand';
import { ALL_STAGE_IDS, type StageId, type PixelSimState } from '../types/sim';
import { createStageState, executePixelCommand } from '../engine';

function readInitialStage(): StageId {
  if (typeof window === 'undefined') return 'ch1';
  const raw = window.location.hash.replace(/^#\/?/, '') as StageId;
  return (ALL_STAGE_IDS as readonly string[]).includes(raw) ? raw : 'ch1';
}

export interface PixelStore {
  stageId: StageId;
  sim: PixelSimState;
  history: string[];
  helpOpen: boolean;
  clearedStages: Record<string, boolean>;

  setStage: (id: StageId) => void;
  runCommand: (cmd: string) => void;
  resetStage: () => void;
  setHelpOpen: (open: boolean) => void;
  markStageCleared: (id: StageId) => void;
}

const initialStage = readInitialStage();

export const usePixelStore = create<PixelStore>((set, get) => ({
  stageId: initialStage,
  sim: createStageState(initialStage),
  history: [],
  helpOpen: false,
  clearedStages: {},

  setStage: (id) => {
    if (typeof window !== 'undefined' && window.location.hash !== `#/${id}`) {
      window.location.hash = `#/${id}`;
    }
    set({
      stageId: id,
      sim: createStageState(id),
    });
  },

  runCommand: (rawCmd) => {
    const trimmed = rawCmd.trim();
    if (!trimmed) return;
    const nextSim = executePixelCommand(get().sim, trimmed);
    set((s) => ({
      sim: nextSim,
      history:
        s.history[s.history.length - 1] === trimmed
          ? s.history
          : [...s.history.slice(-49), trimmed],
    }));
  },

  resetStage: () => {
    const id = get().stageId;
    set({ sim: createStageState(id) });
  },

  setHelpOpen: (open) => set({ helpOpen: open }),

  markStageCleared: (id) =>
    set((s) =>
      s.clearedStages[id] ? s : { clearedStages: { ...s.clearedStages, [id]: true } },
    ),
}));
