import { useEffect } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';
import { STAGE_MAP, STAGE_SCENARIOS } from '../engine';
import { usePixelStore } from '../store/usePixelStore';
import type { PixelAnimKind, StageStep } from '../types/sim';

function isStepDone(step: StageStep, completed: PixelAnimKind[]): boolean {
  if (Array.isArray(step.doneAction)) {
    return step.doneAction.some((act) => completed.includes(act));
  }
  return completed.includes(step.doneAction);
}

export function TopStageBar() {
  const stageId = usePixelStore((s) => s.stageId);
  const completedActions = usePixelStore((s) => s.sim.completedActions);
  const clearedStages = usePixelStore((s) => s.clearedStages);
  const setStage = usePixelStore((s) => s.setStage);
  const resetStage = usePixelStore((s) => s.resetStage);
  const setHelpOpen = usePixelStore((s) => s.setHelpOpen);
  const markStageCleared = usePixelStore((s) => s.markStageCleared);

  useEffect(() => {
    const scenario = STAGE_MAP[stageId];
    if (!scenario || scenario.steps.length === 0 || clearedStages[stageId]) return;
    const allDone = scenario.steps.every((step) => isStepDone(step, completedActions));
    if (allDone) {
      markStageCleared(stageId);
    }
  }, [stageId, completedActions, clearedStages, markStageCleared]);

  return (
    <header className="h-12 shrink-0 bg-[#101420] border-b-2 border-[#252D44] px-3 sm:px-4 flex items-center justify-between gap-2">
      {/* Left: Cute 4-dot pixel emblem + GitDots title */}
      <div className="flex items-center gap-2 shrink-0 select-none">
        <svg
          width="22"
          height="22"
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="shrink-0 rounded-[4px] border border-[#354060] bg-[#181E30]"
        >
          <rect x="3" y="3" width="4" height="4" rx="0.5" fill="#5CE1B8" />
          <rect x="9" y="3" width="4" height="4" rx="0.5" fill="#FFD166" />
          <rect x="3" y="9" width="4" height="4" rx="0.5" fill="#6BCBFF" />
          <rect x="9" y="9" width="4" height="4" rx="0.5" fill="#FF7B89" />
        </svg>
        <span className="font-pixel text-sm sm:text-base font-bold tracking-tight text-[#FFF8EB]">
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
              type="button"
              data-testid={`stage-pill-${scenario.id}`}
              aria-current={isActive ? 'page' : undefined}
              title={scenario.title}
              onClick={() => setStage(scenario.id)}
              className={[
                'shrink-0 px-2.5 py-1 rounded-full text-xs border transition-all duration-150 flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                isActive
                  ? 'bg-[#FFD166] text-[#131722] border-[#FFE8A3] font-bold shadow-[0_0_12px_rgba(255,209,102,0.3)]'
                  : 'bg-[#171D2E] text-[#B8C4DF] border-[#293350] hover:bg-[#202840] hover:text-[#FFF8EB] hover:border-[#3D4B72]',
              ].join(' ')}
            >
              <span className={isActive ? 'text-[#131722]/75 font-mono-code text-[11px]' : 'text-[#7F8FB3] font-mono-code text-[11px]'}>
                {scenario.number}
              </span>
              <span>{scenario.shortTitle}</span>
              {isCleared && (
                <span
                  aria-label="클리어 완료"
                  className={[
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    isActive
                      ? 'bg-[#117A5B] ring-1 ring-[#131722]/25'
                      : 'bg-[#5CE1B8] shadow-[0_0_6px_rgba(92,225,184,0.75)]',
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
          title="현재 스테이지 초기화"
          className="h-8 px-2.5 rounded-md bg-[#161C2C] border border-[#293350] text-[#B8C4DF] hover:text-[#FFF8EB] hover:bg-[#1E263B] hover:border-[#41507A] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">초기화</span>
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          title="명령어 사전 열기"
          className="h-8 px-2.5 rounded-md bg-[#161C2C] border border-[#293350] text-[#E6ECF8] hover:text-[#FFF8EB] hover:bg-[#1E263B] hover:border-[#FFD166]/60 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0 text-[#FFD166]" />
          <span className="hidden sm:inline">? 명령어 사전</span>
          <span className="sm:hidden">? 사전</span>
        </button>
      </div>
    </header>
  );
}
