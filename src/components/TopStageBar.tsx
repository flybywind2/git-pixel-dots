import { BookOpen, RotateCcw } from 'lucide-react';
import { getNextPendingStep, STAGE_MAP, STAGE_TRACKS } from '../engine';
import { chapterHash, usePixelStore } from '../store/usePixelStore';
import { ALL_STAGE_IDS } from '../types/sim';
import type { StageScenario } from '../types/sim';

const [basic, advanced] = STAGE_TRACKS;

export function TopStageBar() {
  const stageId = usePixelStore((state) => state.stageId);
  const sessions = usePixelStore((state) => state.sessions);
  const setStage = usePixelStore((state) => state.setStage);
  const resetStage = usePixelStore((state) => state.resetStage);
  const setHelpOpen = usePixelStore((state) => state.setHelpOpen);
  const inAdvanced = STAGE_MAP[stageId].track === 'advanced';

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

  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-b-2 border-[#D7C7AE] bg-[#EFE6D5] px-3 py-2 sm:px-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
      <a href={chapterHash('docs')} className="col-start-1 row-start-1 inline-flex w-fit items-center gap-2 rounded-sm font-pixel text-sm">
        <span aria-hidden="true" className="grid h-5 w-5 grid-cols-2 gap-0.5 rounded-[4px] border border-[#C7B497] bg-[#FFFDF8] p-[3px]">
          <span className="rounded-[1px] bg-[#22A882]" />
          <span className="rounded-[1px] bg-[#F2A93B]" />
          <span className="rounded-[1px] bg-[#3292CE]" />
          <span className="rounded-[1px] bg-[#E05666]" />
        </span>
        GitDots
      </a>

      <nav aria-label="학습 장" className="col-span-full row-start-2 min-w-0 lg:col-start-2 lg:col-span-1 lg:row-start-1">
        <select
          value={stageId}
          aria-label="학습할 장 선택"
          onChange={(event) => changeStage(event.target.value)}
          className="w-full min-w-0 rounded-md border border-[#C7B497] bg-[#FFFDF8] px-2 py-1.5 text-sm font-semibold lg:hidden"
        >
          {STAGE_TRACKS.map((track) => <optgroup key={track.id} label={track.label}>{track.lessons.map(lessonOption)}</optgroup>)}
        </select>
        <div className="hidden items-center justify-center gap-1.5 whitespace-nowrap lg:flex">
          <span className="mr-1 text-xs font-semibold text-[#715A43]">{basic.label}</span>
          {basic.lessons.map((lesson) => {
            const active = lesson.id === stageId;
            return (
              <a
                key={lesson.id}
                href={chapterHash(lesson.id)}
                data-testid={`stage-pill-${lesson.id}`}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${active
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
            className={`ml-1 w-41 rounded-md border px-2 py-1 text-xs font-semibold ${inAdvanced
              ? 'border-[#C98A1B] bg-[#F4B942]' : 'border-[#D8C9B0] bg-[#FFFDF8]'}`}
          >
            <option value="" disabled>{advanced.label}</option>
            {advanced.lessons.map(lessonOption)}
          </select>
        </div>
      </nav>

      <div className="col-start-2 row-start-1 flex justify-end gap-1.5 lg:col-start-3">
        <button type="button" onClick={resetStage} title="현재 장 초기화"
          className="flex min-h-8 items-center gap-1 rounded-md border border-[#D4C3A8] bg-[#FAF4E8] px-2 text-xs font-medium">
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          현재 장 초기화
        </button>
        <button type="button" onClick={() => setHelpOpen(true)} title="명령어 사전 열기"
          className="flex min-h-8 items-center gap-1 rounded-md border border-[#D4C3A8] bg-[#FAF4E8] px-2 text-xs font-medium">
          <BookOpen aria-hidden="true" className="h-3.5 w-3.5 text-[#965B0D]" />
          <span className="hidden min-[360px]:inline">명령어 </span>사전
        </button>
      </div>
    </header>
  );
}
