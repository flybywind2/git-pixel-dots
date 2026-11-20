import { ArrowRight, Pencil, Play, Save } from 'lucide-react';
import { getNextPendingStep, isPracticeCommand, isStepCompleted, STAGE_MAP, STAGE_SCENARIOS } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

export function LessonGuide() {
  const sim = usePixelStore((state) => state.sim);
  const draft = usePixelStore((state) => state.documentDraft);
  const saveDocument = usePixelStore((state) => state.saveDocument);
  const runCommand = usePixelStore((state) => state.runCommand);
  const setStage = usePixelStore((state) => state.setStage);
  const lesson = STAGE_MAP[sim.stageId];
  const nextStep = getNextPendingStep(sim);
  const nextLesson = STAGE_SCENARIOS[lesson.number];
  const doneCount = lesson.steps.filter((step) => isStepCompleted(sim, step)).length;
  const editDocument = lesson.id === 'docs' && nextStep?.doneAction === 'EDIT';
  const saveDraft = draft !== null;
  const ButtonIcon = saveDraft ? Save : editDocument ? Pencil : Play;
  const label = saveDraft ? '문서 저장' : editDocument ? '문서 편집하기' : nextStep?.label ?? nextStep?.goal;

  function runGuidedStep() {
    if (saveDraft) {
      saveDocument();
    } else if (editDocument) {
      document.getElementById('practice-document-editor')?.focus();
    } else if (nextStep) {
      runCommand(nextStep.command);
      if (lesson.id === 'docs' && nextStep.command.startsWith('git diff ') && !usePixelStore.getState().notice) {
        document.getElementById('document-comparison')?.focus();
      }
    }
  }

  return (
    <section aria-labelledby="lesson-title" className="shrink-0 border-b border-[#D7C7AE] bg-[#FFFDF8]">
      <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-3.5 sm:px-6 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-8 lg:py-5">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#80613B]">{lesson.number}장 / {STAGE_SCENARIOS.length}장</p>
          <h1 id="lesson-title" className="break-keep text-xl font-bold leading-tight tracking-tight sm:text-2xl">{lesson.title}</h1>
          <p className="mt-1.5 max-w-[68ch] break-keep text-sm leading-relaxed text-[#59483B]">
            {nextStep ? lesson.tagline : lesson.takeaway}
          </p>
          {lesson.id === 'docs' && (
            <p className="mt-1.5 text-xs text-[#715A43]">이 브라우저 안의 연습 저장소에서 진행해요.</p>
          )}
        </div>
        <div className="min-w-0 border-l-[3px] border-[#D69724] pl-3.5">
          <div className="flex items-center gap-2 text-xs font-medium text-[#715A43]" aria-live="polite">
            <span aria-hidden="true" className="flex gap-1">
              {lesson.steps.map((step) => (
                <span key={step.id} className={`h-2 w-2 rounded-[2px] ${isStepCompleted(sim, step) ? 'bg-[#198361]' : 'bg-[#DED1B8]'}`} />
              ))}
            </span>
            <span data-testid="stage-step-badge">실습 {doneCount}/{lesson.steps.length} 완료</span>
          </div>
          {label ? (
            <>
              {nextStep?.label && !saveDraft && <p className="mt-1.5 break-keep text-sm">{nextStep.goal}</p>}
              <button
                type="button"
                data-testid="guided-command"
                onClick={runGuidedStep}
                className="pixel-btn mt-2 inline-flex max-w-full items-center gap-2 rounded-md border-[#C78B1E] bg-[#F4B942] px-3 py-1.5 text-left text-sm font-bold text-[#362711] hover:bg-[#F7C55D]"
              >
                <ButtonIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="break-keep">{label}</span>
              </button>
              {nextStep && !editDocument && !saveDraft && (
                <p className="mt-2 text-xs text-[#715A43]">
                  <code className="font-mono-code break-words">{nextStep.command}</code>
                  {isPracticeCommand(nextStep.command) && <span className="ml-2">실습 전용</span>}
                </p>
              )}
            </>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid={nextLesson ? 'next-chapter-btn' : 'all-chapters-done-btn'}
                onClick={() => setStage(nextLesson?.id ?? 'docs')}
                className="pixel-btn inline-flex items-center gap-2 rounded-md border-[#116349] bg-[#197957] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#14694F]"
              >
                {nextLesson ? `다음 장 · ${nextLesson.shortTitle}` : '1장으로 돌아가기'}
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
              </button>
              {lesson.id === 'docs' && !sim.completedActions.includes('REVERT') && (
                <button type="button" onClick={() => runCommand('git revert HEAD')}
                  className="rounded-md border border-[#CDBCA3] px-3 py-1.5 text-sm font-semibold">
                  마지막 변경 취소해 보기
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
