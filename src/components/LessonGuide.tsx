import { ArrowRight, Pencil, Play, Save } from 'lucide-react';
import { getNextPendingStep, isPracticeCommand, isStepCompleted, STAGE_MAP, STAGE_TRACKS } from '../engine';
import { diffDocumentLines, DOCUMENT_REVERT, getDocumentComparison } from '../engine/documentDiff';
import { CANONICAL_TERMS } from '../engine/terms';
import { usePixelStore } from '../store/usePixelStore';

export function LessonGuide() {
  const sim = usePixelStore((state) => state.sim);
  const sessions = usePixelStore((state) => state.sessions);
  const draft = usePixelStore((state) => state.documentDraft);
  const saveDocument = usePixelStore((state) => state.saveDocument);
  const runCommand = usePixelStore((state) => state.runCommand);
  const setStage = usePixelStore((state) => state.setStage);
  const lesson = STAGE_MAP[sim.stageId];
  const [basic, advanced] = STAGE_TRACKS;
  const track = lesson.track === 'basic' ? basic : advanced;
  const nextStep = getNextPendingStep(sim);
  const nextLesson = track.lessons.at(track.lessons.indexOf(lesson) + 1);
  const unfinishedBasic = lesson.track === 'basic' && !nextStep && !nextLesson && basic.lessons.find((item) => {
    const session = sessions[item.id];
    return item.id !== lesson.id && (!session || getNextPendingStep(session.sim) !== null);
  });
  const nextStage = nextLesson?.id ?? (unfinishedBasic ? unfinishedBasic.id : lesson.track === 'basic' ? advanced.lessons[0].id : 'docs');
  const nextLabel = nextLesson ? `다음 장 · ${nextLesson.shortTitle}`
    : unfinishedBasic ? `기본 이어 하기 · ${unfinishedBasic.shortTitle}`
      : lesson.track === 'basic' ? `심화 ${advanced.lessons[0].number}장 · ${advanced.lessons[0].shortTitle}` : '1장으로 돌아가기';
  const finishedBasic = lesson.id === 'ch4' && !nextStep && !unfinishedBasic;
  const doneCount = lesson.steps.filter((step) => isStepCompleted(sim, step)).length;
  let phaseOffset = 0;
  const phaseGroups = lesson.phases?.map((phase) => {
    const steps = lesson.steps.slice(phaseOffset, phaseOffset + phase.steps);
    phaseOffset += phase.steps;
    return { label: phase.label, steps, done: steps.every((step) => isStepCompleted(sim, step)) };
  });
  const editDocument = lesson.id === 'docs' && nextStep?.doneAction === 'EDIT';
  const saveDraft = draft !== null;
  const ButtonIcon = saveDraft ? Save : editDocument ? Pencil : Play;
  const label = saveDraft ? '문서 저장하기' : nextStep?.label;
  // 지금 단계에서 쓰는 용어만 보여 줘서 첫 화면을 가볍게 해요. 단계에 명시된 용어를 우선 사용해요.
  const stepTerms = nextStep
    ? nextStep.terms
      ? nextStep.terms.map((name) => ({ name, meaning: CANONICAL_TERMS[name] }))
      : lesson.terms.filter(({ name }) => nextStep.goal.includes(name) || nextStep.command.includes(name))
    : [];
  // 1장은 비교 결과를 안내 카드에 한 줄로 보여 줘서, 아래로 스크롤하지 않아도 무슨 일이 일어났는지 알 수 있게 해요.
  const docComparison = lesson.id === 'docs' && sim.document ? getDocumentComparison(sim, sim.document.comparison) : null;
  const docLines = docComparison ? diffDocumentLines(docComparison.before, docComparison.after) : [];
  const docRemoved = docLines.filter((line) => line.kind === 'removed').length;
  const docAdded = docLines.filter((line) => line.kind === 'added').length;

  function runGuidedStep() {
    if (saveDraft) {
      saveDocument();
    } else if (editDocument) {
      document.getElementById('practice-document-editor')?.focus();
    } else if (nextStep) {
      runCommand(nextStep.command);
      if (lesson.id === 'docs' && nextStep.command.startsWith('git diff ') && !usePixelStore.getState().notice) {
        // 비교 영역으로 스크롤을 끌어내리지 않아 안내 카드가 화면 밖에 사라지지 않게 해요.
        document.getElementById('document-comparison')?.focus({ preventScroll: true });
      }
    }
  }

  return (
    <section aria-labelledby="lesson-title" className="shrink-0 border-b border-[#D7C7AE] bg-[#FFFDF8]">
      <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-3.5 sm:px-6 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-8 lg:py-5">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#80613B]">{track.label} · {lesson.number}장</p>
          <h1 id="lesson-title" className="break-keep text-xl font-bold leading-tight tracking-tight sm:text-2xl">{lesson.title}</h1>
          <p className="mt-1.5 max-w-[68ch] break-keep text-sm leading-relaxed text-[#59483B]">
            {nextStep ? lesson.tagline : finishedBasic
              ? '이제 팀 저장소의 문서를 고치고 변경을 기록한 뒤, GitHub에서 검토를 요청하고 합친 내용을 내 컴퓨터로 가져올 수 있어요. 기본 1~4장만으로도 팀 협업 시작은 충분해요. 5~9장은 선택 심화예요.'
              : lesson.takeaway}
          </p>
          <p className="mt-1.5 text-xs text-[#715A43]">이 브라우저 안의 가상 실습이에요. 실제 GitHub에는 반영되지 않아요.</p>
          {lesson.track === 'advanced' && (
            <p className="mt-1 text-xs text-[#715A43]">선택 심화 과정이에요. 기본 1~4장만 완주해도 팀 협업의 기본은 충분해요.</p>
          )}
          {(lesson.id === 'docs' || lesson.id === 'ch4') && <GitHubWebGuide />}
        </div>
        <div className="min-w-0 border-l-[3px] border-[#D69724] pl-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#715A43]" aria-live="polite">
            {phaseGroups ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {phaseGroups.map((group) => (
                  <span key={group.label} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="flex gap-1">
                      {group.steps.map((step) => (
                        <span key={step.id} className={`h-2 w-2 rounded-[2px] ${isStepCompleted(sim, step) ? 'bg-[#198361]' : 'bg-[#DED1B8]'}`} />
                      ))}
                    </span>
                    <span className={group.done ? 'font-semibold text-[#198361]' : undefined}>{group.label}</span>
                    <span className="sr-only">{group.done ? '완료' : '진행 중'}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span aria-hidden="true" className="flex gap-1">
                {lesson.steps.map((step) => (
                  <span key={step.id} className={`h-2 w-2 rounded-[2px] ${isStepCompleted(sim, step) ? 'bg-[#198361]' : 'bg-[#DED1B8]'}`} />
                ))}
              </span>
            )}
            <span data-testid="stage-step-badge">실습 {doneCount}/{lesson.steps.length} 완료</span>
          </div>
          {label ? (
            <>
              {nextStep && !saveDraft && <p className="mt-1.5 break-keep text-sm">{nextStep.goal}</p>}
              {lesson.id === 'docs' && docLines.length > 0 && (
                <p role="status" className="mt-1 text-xs font-semibold text-[#196446]">
                  비교 결과: 빠진 줄 {docRemoved}개 · 들어간 줄 {docAdded}개
                </p>
              )}
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
                <div className="mt-2 text-xs text-[#715A43]">
                  <p>
                    <code className="font-mono-code break-words">{nextStep.command}</code>
                    {isPracticeCommand(nextStep.command) && <span className="ml-2">실습 전용</span>}
                  </p>
                  {nextStep.commandNote && <p className="mt-1 break-keep leading-relaxed">{nextStep.commandNote}</p>}
                </div>
              )}
              {stepTerms.length > 0 && (
                <dl data-testid="step-terms" className="mt-2 space-y-1 rounded-md border border-[#E3D5BE] bg-[#F9F3E8] px-2.5 py-1.5 text-xs leading-relaxed text-[#59483B]">
                  {stepTerms.map(({ name, meaning }) => (
                    <div key={name} className="break-keep">
                      <dt className="inline font-semibold text-[#14694F]">{name}</dt>
                      <dd className="inline"> — {meaning}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid={nextLesson ? 'next-chapter-btn' : 'all-chapters-done-btn'}
                onClick={() => setStage(nextStage)}
                className="pixel-btn inline-flex items-center gap-2 rounded-md border-[#116349] bg-[#197957] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#14694F]"
              >
                {nextLabel}
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
              </button>
              {lesson.id === 'docs' && !sim.completedActions.includes('REVERT') && (
                <button type="button" onClick={() => runCommand(DOCUMENT_REVERT.command)}
                  className="rounded-md border border-[#CDBCA3] px-3 py-1.5 text-sm font-semibold">
                  {DOCUMENT_REVERT.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {lesson.terms.length > 0 && (
        <details data-testid="all-terms" className="mx-auto max-w-[1440px] px-4 pb-3 sm:px-6">
          <summary className="cursor-pointer text-xs font-semibold text-[#166447]">이 장에서 쓰는 용어 전체 보기</summary>
          <dl className="mt-1.5 max-w-[68ch] space-y-1 rounded-md border border-[#DED1B8] bg-[#F9F3E8] px-2.5 py-2 text-xs leading-relaxed text-[#59483B]">
            {lesson.terms.map(({ name, meaning }) => (
              <div key={name} className="break-keep">
                <dt className="inline font-semibold text-[#14694F]">{name}</dt>
                <dd className="inline"> — {meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

function GitHubWebGuide() {
  return (
    <details className="mt-2 max-w-[68ch] rounded-md border border-[#DED1B8] bg-[#F9F3E8] px-2.5 text-xs">
      <summary className="cursor-pointer py-1.5 font-semibold text-[#166447]">GitHub 웹에서 이어 하기 (실제 GitHub에서 써보기 · 선택)</summary>
      <p className="mb-2 break-keep leading-relaxed text-[#715A43]">지금은 실습에 집중하세요. 이 안내는 나중에 실제 GitHub에서 써볼 때 참고하는 선택 과정이에요.</p>
      <ol className="mb-2 ml-4 list-decimal space-y-1.5 break-keep leading-relaxed text-[#59483B]">
        <li>저장소에서 문서를 열고 연필 버튼으로 편집해요. <strong>Preview</strong>에서 문서가 어떻게 보이는지 확인해요.</li>
        <li><strong>Commit changes</strong>에서 변경 이유를 적고 새 브랜치에 기록해요. 쓰기 권한이 없는 저장소에서는 포크(다른 사람 저장소를 내 계정으로 복사)를 만들어 <strong>Propose changes</strong>로 변경을 제안할 수 있어요.</li>
        <li><strong>Compare &amp; pull request</strong>에서 변경을 확인하고 <strong>Create pull request</strong>로 팀에 검토를 요청해요.</li>
      </ol>
      <p className="mb-2 break-keep leading-relaxed text-[#715A43]">
        Preview·Commit changes·Compare &amp; pull request는 실제 GitHub 화면의 버튼이에요. 이 실습에서는 명령으로 같은 일을 해요.
      </p>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-medium text-[#166447]">
        <a className="underline" target="_blank" rel="noopener noreferrer"
          href="https://docs.github.com/ko/repositories/working-with-files/managing-files/editing-files">
          GitHub 문서 편집 도움말<span className="sr-only"> (새 탭)</span>
        </a>
        <a className="underline" target="_blank" rel="noopener noreferrer"
          href="https://docs.github.com/ko/pull-requests/how-tos/create-pull-requests/creating-a-pull-request">
          GitHub 검토 요청 도움말<span className="sr-only"> (새 탭)</span>
        </a>
      </div>
    </details>
  );
}
