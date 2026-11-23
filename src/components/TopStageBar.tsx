import { useEffect, useRef, useState } from 'react';
import { BookOpen, Info, RotateCcw, Undo2 } from 'lucide-react';
import { getNextPendingStep, isStepCompleted, STAGE_MAP, STAGE_SCENARIOS, STAGE_TRACKS } from '../engine';
import { CertificateModal } from './CertificateModal';
import { readCertificateMeta, writeCertificateMeta } from '../store/certificateMeta';
import { chapterHash, usePixelStore } from '../store/usePixelStore';
import { ALL_STAGE_IDS } from '../types/sim';
import type { StageId, StageScenario } from '../types/sim';

const [basic, advanced] = STAGE_TRACKS;

export function TopStageBar() {
  const stageId = usePixelStore((state) => state.stageId);
  const sessions = usePixelStore((state) => state.sessions);
  const undoCount = usePixelStore((state) => state.undoStacks[state.stageId]?.length ?? 0);
  const setStage = usePixelStore((state) => state.setStage);
  const undoStep = usePixelStore((state) => state.undoStep);
  const resetStage = usePixelStore((state) => state.resetStage);
  const setHelpOpen = usePixelStore((state) => state.setHelpOpen);
  const certificateOpen = usePixelStore((state) => state.certificateOpen);
  const setCertificateOpen = usePixelStore((state) => state.setCertificateOpen);
  const inAdvanced = STAGE_MAP[stageId].track === 'advanced';
  const grass = STAGE_SCENARIOS.map((lesson) => {
    const session = sessions[lesson.id];
    const done = session ? lesson.steps.filter((step) => isStepCompleted(session.sim, step)).length : 0;
    return { lesson, done, complete: session !== undefined && getNextPendingStep(session.sim) === null };
  });
  const allComplete = grass.every((cell) => cell.complete);
  const basicComplete = grass
    .filter((cell) => basic.lessons.some((lesson) => lesson.id === cell.lesson.id))
    .every((cell) => cell.complete);
  const [popped, setPopped] = useState<ReadonlySet<StageId>>(new Set());
  const [undoInfoOpen, setUndoInfoOpen] = useState(false);
  const undoInfoRef = useRef<HTMLDivElement>(null);
  const prevComplete = useRef<Map<StageId, boolean> | null>(null);
  useEffect(() => {
    if (!undoInfoOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (undoInfoRef.current && !undoInfoRef.current.contains(event.target as Node)) {
        setUndoInfoOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUndoInfoOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [undoInfoOpen]);
  useEffect(() => {
    const prev = prevComplete.current;
    if (prev) {
      const newly = grass.filter((cell) => cell.complete && !prev.get(cell.lesson.id)).map((cell) => cell.lesson.id);
      if (newly.length > 0) setPopped(new Set(newly));
    }
    prevComplete.current = new Map(grass.map((cell) => [cell.lesson.id, cell.complete]));
  }, [grass]);
  useEffect(() => {
    if (basicComplete && !readCertificateMeta().basicAt) writeCertificateMeta({ basicAt: new Date().toISOString() });
    if (allComplete && !readCertificateMeta().allAt) writeCertificateMeta({ allAt: new Date().toISOString() });
  }, [basicComplete, allComplete]);

  function changeStage(value: string) {
    const next = ALL_STAGE_IDS.find((id) => id === value);
    if (next) setStage(next);
  }

  function chapterComplete(id: StageScenario['id']) {
    const session = sessions[id];
    return session && getNextPendingStep(session.sim) === null;
  }

  function lessonOption(lesson: StageScenario) {
    return <option key={lesson.id} value={lesson.id}>{lesson.number}장 · {lesson.shortTitle}{chapterComplete(lesson.id) ? ' (완료)' : ''}</option>;
  }

  const completedCount = grass.filter((cell) => cell.complete).length;
  const totalCount = STAGE_SCENARIOS.length;

  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-1.5 gap-y-1.5 border-b-2 border-[#D7C7AE] bg-[#EFE6D5] px-2.5 py-1.5 sm:gap-x-3 sm:gap-y-2 sm:px-4 sm:py-2 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
      <a href={chapterHash('docs')} className="col-start-1 row-start-1 inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm font-pixel text-sm sm:gap-2">
        <span aria-hidden="true" className="grid h-5 w-5 shrink-0 grid-cols-2 gap-0.5 rounded-[4px] border border-[#C7B497] bg-[#FFFDF8] p-[3px]">
          <span className="rounded-[1px] bg-[#22A882]" />
          <span className="rounded-[1px] bg-[#F2A93B]" />
          <span className="rounded-[1px] bg-[#3292CE]" />
          <span className="rounded-[1px] bg-[#E05666]" />
        </span>
        GitDots
      </a>

      <div className="col-span-full row-start-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 lg:col-start-2 lg:row-start-2">
        <span role="img" aria-label={`잔디 진행: ${completedCount}/${totalCount}장 완료`} className="flex items-center gap-1">
          {grass.map(({ lesson, done, complete }) => (
            <span
              key={lesson.id}
              title={`${lesson.number}장 ${lesson.shortTitle} · ${complete ? '완료' : done > 0 ? '진행 중' : '시작 전'}`}
              className={`h-2.5 w-2.5 rounded-[2px] ${complete ? `${popped.has(lesson.id) ? 'grass-pop ' : ''}bg-[#198361]` : done > 0 ? 'bg-[#9CCDB4]' : 'bg-[#DED1B8]'}`}
            />
          ))}
        </span>
        <span className="text-xs font-semibold text-[#715A43]">{completedCount}/{totalCount}장 완료</span>
        {basicComplete && (
          <button type="button" onClick={() => setCertificateOpen(true)}
            className="pixel-btn rounded-md border-[#116349] bg-[#197957] px-2 py-0.5 text-xs font-semibold text-white">
            수료증 보기
          </button>
        )}
        <span id="undo-refresh-note" className="sr-only sm:not-sr-only sm:text-[11px] sm:text-[#715A43]">
          새로고침하면 이전 단계 기록이 사라져요
        </span>
        <div ref={undoInfoRef} className="relative flex items-center sm:hidden">
          <button
            type="button"
            data-testid="undo-refresh-info-btn"
            aria-expanded={undoInfoOpen}
            aria-controls="undo-refresh-popover"
            aria-label="이전 단계 기록 안내"
            onClick={() => setUndoInfoOpen((open) => !open)}
            className="inline-flex h-4 items-center gap-0.5 rounded-full border border-[#D4C3A8] bg-[#FAF4E8] px-1.5 text-[10px] font-medium leading-none text-[#715A43] hover:bg-[#FFFDF8]"
          >
            <Info aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="hidden min-[360px]:inline">안내</span>
          </button>
          {undoInfoOpen && (
            <div
              id="undo-refresh-popover"
              role="note"
              className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-[#C7B497] bg-[#FFFDF8] p-2.5 text-left text-xs leading-relaxed text-[#59483B] shadow-md"
            >
              상단 <strong>이전 단계</strong> 기록은 새로고침하면 사라져요. 진행 상태와 문서는 자동 저장돼요.
            </div>
          )}
        </div>
      </div>
      <nav aria-label="학습 장" className="col-span-full row-start-3 min-w-0 lg:col-start-2 lg:col-span-1 lg:row-start-1">
        <select
          value={stageId}
          aria-label="학습할 장 선택"
          onChange={(event) => changeStage(event.target.value)}
          className="w-full min-w-0 rounded-md border border-[#C7B497] bg-[#FFFDF8] px-2 py-1 text-sm font-semibold sm:py-1.5 lg:hidden"
        >
          {STAGE_TRACKS.map((track) => <optgroup key={track.id} label={track.label}>{track.lessons.map(lessonOption)}</optgroup>)}
        </select>
        <div className="hidden items-center justify-center gap-1 whitespace-nowrap lg:flex xl:gap-1.5">
          <span className="mr-0.5 hidden text-xs font-semibold text-[#715A43] xl:inline">{basic.label}</span>
          {basic.lessons.map((lesson) => {
            const active = lesson.id === stageId;
            return (
              <a
                key={lesson.id}
                href={chapterHash(lesson.id)}
                data-testid={`stage-pill-${lesson.id}`}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${active
                  ? 'border-[#C98A1B] bg-[#F4B942] font-bold'
                  : 'border-[#D8C9B0] bg-[#FAF4E8] text-[#5D4C3E] hover:bg-[#FFFDF8]'}`}
              >
                <span className="font-mono-code">{lesson.number}</span>
                {lesson.shortTitle}
                {chapterComplete(lesson.id) && (
                  <>
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#147A5B]" />
                    <span className="sr-only">완료</span>
                  </>
                )}
              </a>
            );
          })}
          <select
            value={inAdvanced ? stageId : ''}
            aria-label="심화 실습 선택"
            onChange={(event) => changeStage(event.target.value)}
            className={`ml-0.5 w-36 rounded-md border px-1.5 py-1 text-xs font-semibold xl:ml-1 xl:w-41 xl:px-2 ${inAdvanced
              ? 'border-[#C98A1B] bg-[#F4B942]' : 'border-[#D8C9B0] bg-[#FFFDF8]'}`}
          >
            <option value="" disabled>{advanced.label}</option>
            {advanced.lessons.map(lessonOption)}
          </select>
        </div>
      </nav>

      <div className="col-start-2 row-start-1 flex shrink-0 justify-end gap-1 sm:gap-1.5 lg:col-start-3">
        <button
          type="button"
          data-testid="undo-step-btn"
          onClick={undoStep}
          disabled={undoCount === 0}
          aria-describedby="undo-refresh-note"
          title={undoCount > 0
            ? '이전 단계로 되돌리기 (새로고침하면 이전 단계 기록은 사라져요)'
            : '되돌릴 이전 단계가 없어요. 새로고침하면 이전 단계 기록이 사라져요'}
          className="flex min-h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-[#D4C3A8] bg-[#FAF4E8] px-1.5 text-xs font-medium hover:bg-[#FFFDF8] disabled:cursor-not-allowed disabled:opacity-45 min-[360px]:gap-1 sm:px-2"
        >
          <Undo2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>이전 단계</span>
        </button>
        <button type="button" onClick={resetStage} title="현재 장 초기화"
          className="flex min-h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-[#D4C3A8] bg-[#FAF4E8] px-1.5 text-xs font-medium hover:bg-[#FFFDF8] min-[360px]:gap-1 sm:px-2">
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only min-[460px]:not-sr-only">현재 장 </span>초기화
        </button>
        <button type="button" onClick={() => setHelpOpen(true)} title="명령어 사전 열기"
          className="flex min-h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-[#D4C3A8] bg-[#FAF4E8] px-1.5 text-xs font-medium hover:bg-[#FFFDF8] min-[360px]:gap-1 sm:px-2">
          <BookOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#965B0D]" />
          <span className="sr-only min-[460px]:not-sr-only">명령어 </span>사전
        </button>
      </div>
      <CertificateModal open={certificateOpen} onClose={() => setCertificateOpen(false)} completed={grass.map((cell) => cell.complete)} allComplete={allComplete} />
    </header>
  );
}
