import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageState, getNextPendingStep, savePracticeDocument } from '../engine';
import {
  EXAMPLE_DOCUMENT, getDocumentComparisonLabels, getDocumentWorkingText, ORIGINAL_DOCUMENT,
} from '../engine/documentDiff';
import { DOCUMENT_PATH } from '../engine/documentDiff';
import { flushPracticeSaves } from './practiceStorage';
import type { PixelSimState, StageId } from '../types/sim';
import { usePixelStore } from './usePixelStore';

function seed(id: StageId, sim = createStageState(id)) {
  usePixelStore.setState({
    stageId: id,
    sim,
    sessions: { [id]: { sim, documentDraft: null } },
    undoStacks: {},
    saveIssues: {},
    history: [],
    confirmation: null,
    documentDraft: null,
    notice: null,
  });
  return sim;
}

function sessionFor(sim: PixelSimState) {
  return { sim, documentDraft: null };
}

describe('practice store undo safety', () => {
  beforeEach(() => {
    seed('docs');
  });

  it('asks before an undo replaces an unsaved draft and keeps the draft when cancelled', () => {
    const firstEdit = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '수요일 오후 2시');
    usePixelStore.getState().setDocumentDraft(firstEdit);
    usePixelStore.getState().saveDocument();
    expect(getDocumentWorkingText(usePixelStore.getState().sim)).toBe(firstEdit);
    expect(usePixelStore.getState().undoStacks.docs).toHaveLength(1);

    const laterDraft = firstEdit.replace('1층 회의실', '도서관');
    usePixelStore.getState().setDocumentDraft(laterDraft);
    usePixelStore.getState().undoStep();

    // 저장하지 않은 초안이 있으면 바로 덮어쓰지 않고 확인을 먼저 받아요.
    expect(usePixelStore.getState().confirmation).toEqual({ kind: 'undo-draft' });
    expect(usePixelStore.getState().documentDraft).toBe(laterDraft);
    expect(getDocumentWorkingText(usePixelStore.getState().sim)).toBe(firstEdit);

    usePixelStore.getState().resolveConfirmation(false);
    expect(usePixelStore.getState().documentDraft).toBe(laterDraft);
    expect(getDocumentWorkingText(usePixelStore.getState().sim)).toBe(firstEdit);
  });

  it('restores the previous snapshot quietly after confirmation without replaying an old animation', () => {
    const firstEdit = ORIGINAL_DOCUMENT.replace('금요일 저녁 7시', '수요일 오후 2시');
    usePixelStore.getState().setDocumentDraft(firstEdit);
    usePixelStore.getState().saveDocument();
    const seqBeforeUndo = usePixelStore.getState().sim.lastAnim.seq;

    usePixelStore.getState().setDocumentDraft(`${firstEdit}추가 초안\n`);
    usePixelStore.getState().undoStep();
    usePixelStore.getState().resolveConfirmation(true);

    const state = usePixelStore.getState();
    expect(getDocumentWorkingText(state.sim)).toBe(ORIGINAL_DOCUMENT);
    expect(state.documentDraft).toBe(firstEdit);
    expect(state.sim.lastAnim.kind).toBe('IDLE');
    expect(state.sim.lastAnim.seq).toBe(seqBeforeUndo);
    expect(state.undoStacks.docs).toHaveLength(0);
  });

  it('does not stack undo snapshots for comparison tabs that only change the view', () => {
    const state = usePixelStore.getState();
    const before = state.undoStacks.docs;
    usePixelStore.getState().runCommand('git diff -- 회의록.md');
    expect(usePixelStore.getState().undoStacks.docs).toBe(before);
    expect(getNextPendingStep(usePixelStore.getState().sim)?.id).toBe('docs-edit');
  });
});

describe('practice store external tab adoption', () => {
  beforeEach(() => {
    seed('ch1');
  });

  it('drops the current chapter undo stack when another tab saves a newer session', () => {
    usePixelStore.setState({ undoStacks: { ch1: [sessionFor(createStageState('ch1'))] } });
    const external = savePracticeDocument(createStageState('ch1'), EXAMPLE_DOCUMENT);
    usePixelStore.getState().adoptExternalSession('ch1', sessionFor(external));

    expect(usePixelStore.getState().undoStacks.ch1).toEqual([]);
    expect(getDocumentWorkingText(usePixelStore.getState().sim)).toBe(EXAMPLE_DOCUMENT);
  });

  it('also invalidates undo stacks for an inactive chapter', () => {
    usePixelStore.setState({
      stageId: 'ch1',
      sim: createStageState('ch1'),
      undoStacks: { docs: [sessionFor(createStageState('docs'))], ch1: [sessionFor(createStageState('ch1'))] },
    });
    const external = createStageState('docs');
    usePixelStore.getState().adoptExternalSession('docs', sessionFor(external));

    // 비활성 장의 새 저장본을 받아도 그 장의 예전 스냅샷은 사라져요.
    expect(usePixelStore.getState().undoStacks.docs).toEqual([]);
    expect(usePixelStore.getState().undoStacks.ch1).toHaveLength(1);
    expect(usePixelStore.getState().stageId).toBe('ch1');
  });

  it('keeps this tab draft while adopting the other tab progress', () => {
    usePixelStore.setState({ documentDraft: `${ORIGINAL_DOCUMENT}내 초안\n` });
    const external = savePracticeDocument(createStageState('ch1'), EXAMPLE_DOCUMENT);
    usePixelStore.getState().adoptExternalSession('ch1', sessionFor(external));

    expect(usePixelStore.getState().documentDraft).toBe(`${ORIGINAL_DOCUMENT}내 초안\n`);
  });

  it('re-saves this tab draft when external progress arrives during the debounce window', () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => { saved.set(key, value); },
        removeItem: (key: string) => { saved.delete(key); },
        clear: () => { saved.clear(); },
        key: (index: number) => [...saved.keys()][index] ?? null,
        get length() { return saved.size; },
      },
      setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    seed('docs');
    const draftB = `${ORIGINAL_DOCUMENT}탭 B 미저장 초안\n`;
    usePixelStore.getState().setDocumentDraft(draftB);
    // 지연 저장이 아직 실행되기 전이에요.
    expect(saved.has('gitdots.practice.v4.docs')).toBe(false);

    const external = savePracticeDocument(createStageState('docs'), EXAMPLE_DOCUMENT);
    usePixelStore.getState().adoptExternalSession('docs', { sim: external, documentDraft: null });
    flushPracticeSaves();

    const raw = saved.get('gitdots.practice.v4.docs');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).documentDraft).toBe(draftB);
    expect(getDocumentWorkingText(usePixelStore.getState().sim)).toBe(EXAMPLE_DOCUMENT);
    vi.unstubAllGlobals();
  });
});

describe('document comparison labels', () => {
  it('names the actual index copy instead of calling it the original draft', () => {
    const initial = createStageState('docs');
    // 아직 add하기 전에는 index가 최근 커밋과 같아요.
    expect(getDocumentComparisonLabels(initial, 'working').before).toBe('최근 커밋의 문서');

    const edited = savePracticeDocument(initial, EXAMPLE_DOCUMENT);
    const staged = { ...edited, index: { ...edited.index, [DOCUMENT_PATH]: EXAMPLE_DOCUMENT } };
    expect(getDocumentComparisonLabels(staged, 'working').before).toBe('담아 둔 문서');
  });
});