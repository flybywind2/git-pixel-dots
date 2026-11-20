import { useEffect, useRef } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';
import { getNextPendingStep, STAGE_SCENARIOS } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

export function TopStageBar() {
  const stageId = usePixelStore((s) => s.stageId);
  const allDone = usePixelStore((s) => getNextPendingStep(s.sim) === null);
  const clearedStages = usePixelStore((s) => s.clearedStages);
  const setStage = usePixelStore((s) => s.setStage);
  const resetStage = usePixelStore((s) => s.resetStage);
  const setHelpOpen = usePixelStore((s) => s.setHelpOpen);
  const markStageCleared = usePixelStore((s) => s.markStageCleared);
  const activeTab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [stageId]);

  useEffect(() => {
    if (allDone && !clearedStages[stageId]) {
      markStageCleared(stageId);
    }
  }, [stageId, allDone, clearedStages, markStageCleared]);

  return (
    <header className="h-12 shrink-0 bg-[#EFE6D5] border-b-2 border-[#D7C7AE] px-3 sm:px-4 flex items-center justify-between gap-2">
      {/* Left: Cute 4-dot pixel emblem + GitDots title */}
      <div className="flex items-center gap-2 shrink-0 select-none">
        <svg
          width="22"
          height="22"
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="shrink-0 rounded-[4px] border border-[#C7B497] bg-[#FFFDF8]"
        >
          <rect x="3" y="3" width="4" height="4" rx="0.5" fill="#22A882" />
          <rect x="9" y="3" width="4" height="4" rx="0.5" fill="#F2A93B" />
          <rect x="3" y="9" width="4" height="4" rx="0.5" fill="#3292CE" />
          <rect x="9" y="9" width="4" height="4" rx="0.5" fill="#E05666" />
        </svg>
        <span className="font-pixel text-sm sm:text-base font-bold tracking-tight text-[#2F241D]">
          GitDots
        </span>
      </div>

      {/* Center: 8 cozy numbered stage pills */}
      <nav
        aria-label="학습 스테이지"
        className="flex-1 min-w-0 flex items-center justify-start lg:justify-center gap-1.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {STAGE_SCENARIOS.map((scenario) => {
          const isActive = scenario.id === stageId;
          const isCleared = Boolean(clearedStages[scenario.id]);
          return (
            <button
              key={scenario.id}
              ref={isActive ? activeTab : undefined}
              type="button"
              data-testid={`stage-pill-${scenario.id}`}
              aria-current={isActive ? 'page' : undefined}
              title={scenario.title}
              onClick={() => { if (!isActive) setStage(scenario.id); }}
              className={[
                'shrink-0 px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                isActive
                  ? 'bg-[#F4B942] text-[#2F241D] border-[#C98A1B] font-bold shadow-[0_2px_0_rgba(148,101,20,0.3)]'
                  : 'bg-[#FAF4E8] text-[#5D4C3E] border-[#D8C9B0] hover:bg-[#FFFDF8] hover:text-[#2F241D] hover:border-[#BCA687]',
              ].join(' ')}
            >
              <span
                className={
                  isActive
                    ? 'text-[#2F241D]/75 font-mono-code text-[11px]'
                    : 'text-[#8C7865] font-mono-code text-[11px]'
                }
              >
                {scenario.number}
              </span>
              <span>{scenario.shortTitle}</span>
              {isCleared && (
                <span
                  aria-label="클리어 완료"
                  className={[
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    isActive ? 'bg-[#147A5B]' : 'bg-[#22A882]',
                  ].join(' ')}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right: ONLY 2 quiet utility buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={resetStage}
          title="현재 장 초기화"
          aria-label="현재 장 초기화"
          className="h-8 px-2.5 rounded-md bg-[#FAF4E8] border border-[#D4C3A8] text-[#5D4C3E] hover:text-[#2F241D] hover:bg-[#FFFDF8] hover:border-[#B8A07E] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">초기화</span>
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          title="명령어 사전 열기"
          className="h-8 px-2.5 rounded-md bg-[#FAF4E8] border border-[#D4C3A8] text-[#2F241D] hover:bg-[#FFFDF8] hover:border-[#C98A1B] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0 text-[#B86E10]" />
          <span className="hidden sm:inline">명령어 사전</span>
          <span className="sm:hidden">사전</span>
        </button>
      </div>
    </header>
  );
}
