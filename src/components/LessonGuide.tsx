import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pencil, Play, Save } from 'lucide-react';
import { getNextPendingStep, isPracticeCommand, isStepCompleted, STAGE_MAP, STAGE_SCENARIOS, STAGE_TRACKS } from '../engine';
import { diffDocumentLines, DOCUMENT_COMPARISONS, DOCUMENT_REVERT, getDocumentComparison } from '../engine/documentDiff';
import { CANONICAL_TERMS } from '../engine/terms';
import { usePixelStore } from '../store/usePixelStore';

export function LessonGuide() {
  const sim = usePixelStore((state) => state.sim);
  const sessions = usePixelStore((state) => state.sessions);
  const draft = usePixelStore((state) => state.documentDraft);
  const saveDocument = usePixelStore((state) => state.saveDocument);
  const runCommand = usePixelStore((state) => state.runCommand);
  const setStage = usePixelStore((state) => state.setStage);
  const setCertificateOpen = usePixelStore((state) => state.setCertificateOpen);
  const lesson = STAGE_MAP[sim.stageId];
  const [basic, advanced] = STAGE_TRACKS;
  const track = lesson.track === 'basic' ? basic : advanced;
  const nextStep = getNextPendingStep(sim);
  const [quiz, setQuiz] = useState<{ stepId: string; picked: 0 | 1 | null } | null>(null);
  const [introExpanded, setIntroExpanded] = useState(false);
  const [introClamped, setIntroClamped] = useState(false);
  const introRef = useRef<HTMLParagraphElement>(null);
  const nextStepId = nextStep?.id;
  useEffect(() => {
    setQuiz((current) => (current && current.stepId !== nextStepId ? null : current));
  }, [nextStepId]);
  useEffect(() => {
    setIntroExpanded(false);
  }, [sim.stageId]);
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
  // 9장을 모두 마쳤다면 마지막 장에서 바로 수료증으로 이어져요.
  const allComplete = STAGE_SCENARIOS.every((scenario) => {
    const session = sessions[scenario.id];
    return session !== undefined && getNextPendingStep(session.sim) === null;
  });
  const showAllCertificateCta = !nextStep && allComplete;
  const showBasicCertificateCta = finishedBasic && !allComplete;
  const showCertificateCta = showAllCertificateCta || showBasicCertificateCta;
  const effectiveNote = nextStep?.id === 'docs-diff' && sim.staged.includes('회의록.md')
    ? '이미 장바구니에 담겨 있어서 바뀐 줄 탭은 비어 보여요. ‘담아 둔 변경’ 탭에서 방금 담은 줄을 확인해 보세요.'
    : nextStep?.commandNote;
  const doneCount = lesson.steps.filter((step) => isStepCompleted(sim, step)).length;
  let phaseOffset = 0;
  const phaseGroups = lesson.phases?.map((phase) => {
    const steps = lesson.steps.slice(phaseOffset, phaseOffset + phase.steps);
    phaseOffset += phase.steps;
    return { label: phase.label, steps, done: steps.every((step) => isStepCompleted(sim, step)) };
  });
  const editDocument = lesson.id === 'docs' && nextStep?.doneAction === 'EDIT';
  const saveDraft = draft !== null;
  const awaitingPick = quiz !== null && quiz.picked === null && quiz.stepId === nextStep?.id;
  const continuing = quiz !== null && quiz.picked !== null && quiz.stepId === nextStep?.id;
  const compareConflict = nextStep?.doneAction === 'RESOLVE'
    && sim.conflict !== null && sim.conflict.resolvedChoice === 'none';
  const ButtonIcon = saveDraft ? Save : editDocument ? Pencil : continuing || compareConflict ? ArrowRight : Play;
  const label = saveDraft ? '문서 저장하기' : awaitingPick ? '먼저 예측을 골라 주세요'
    : compareConflict ? '남길 내용 비교하기' : continuing ? '계속하기' : nextStep?.label;
  // 지금 단계에서 쓰는 용어만 보여 줘서 첫 화면을 가볍게 해요. 단계에 명시된 용어를 우선 사용해요.
  const stepTerms = nextStep
    ? nextStep.terms
      ? nextStep.terms.map((name) => ({ name, meaning: CANONICAL_TERMS[name] }))
      : lesson.terms.filter(({ name }) => nextStep.goal.includes(name) || nextStep.command.includes(name))
    : [];
  // 1장은 비교 단계를 한 번이라도 실행한 뒤에만 결과를 안내 카드에 한 줄로 보여 줘요.
  const docDiffDone = lesson.id === 'docs' && sim.completedActions.some((action) =>
    action === 'DOCUMENT_WORKING_DIFF' || action === 'DOCUMENT_STAGED_DIFF' || action === 'DOCUMENT_COMMIT_DIFF');
  const docComparison = docDiffDone && sim.document ? getDocumentComparison(sim, sim.document.comparison) : null;
  const docModeLabel = sim.document ? DOCUMENT_COMPARISONS[sim.document.comparison].label : '';
  const docLines = docComparison ? diffDocumentLines(docComparison.before, docComparison.after) : [];
  const docRemoved = docLines.filter((line) => line.kind === 'removed').length;
  const docAdded = docLines.filter((line) => line.kind === 'added').length;

  function runNow() {
    if (saveDraft) {
      saveDocument();
    } else if (editDocument) {
      const editor = document.getElementById('practice-document-editor');
      editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor?.focus({ preventScroll: true });
    } else if (nextStep?.doneAction === 'RESOLVE' && sim.conflict && sim.conflict.resolvedChoice === 'none') {
      // 충돌을 바로 해결하지 않고, 아래 비교 카드에서 세 선택지를 직접 보게 안내해요.
      const card = document.getElementById('conflict-comparison');
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.focus({ preventScroll: true });
    } else if (nextStep) {
      runCommand(nextStep.command);
      if (lesson.id === 'docs' && nextStep.command.startsWith('git diff ') && !usePixelStore.getState().notice) {
        // 비교 영역으로 스크롤을 끌어내리지 않아 안내 카드가 화면 밖에 사라지지 않게 해요.
        document.getElementById('document-comparison')?.focus({ preventScroll: true });
      }
    }
  }

  function runGuidedStep() {
    if (nextStep?.prediction && !saveDraft && !editDocument) {
      if (!quiz || quiz.stepId !== nextStep.id) {
        setQuiz({ stepId: nextStep.id, picked: null });
        return;
      }
      if (quiz.picked === null) return;
    }
    setQuiz(null);
    runNow();
  }

  const introText = nextStep ? lesson.tagline : finishedBasic
    ? '이제 팀 저장소의 문서를 고치고 변경을 기록한 뒤, GitHub에서 검토를 요청하고 합친 내용을 내 컴퓨터로 가져올 수 있어요. 기본 1~4장만으로도 팀 협업 시작은 충분해요. 5~9장은 선택 심화예요.'
    : lesson.takeaway;
  const hasAdvancedNote = lesson.track === 'advanced';

  useEffect(() => {
    const element = introRef.current;
    if (!element) return;
    const measure = () => {
      if (introExpanded) {
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20;
        setIntroClamped(element.scrollHeight > lineHeight * 1.5);
      } else {
        setIntroClamped(element.scrollHeight > element.clientHeight + 1);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [introText, introExpanded]);

  const showIntroToggle = introClamped || hasAdvancedNote || introExpanded;

  return (
    <section aria-labelledby="lesson-title" className="shrink-0 border-b border-[#D7C7AE] bg-[#FFFDF8]">
      <div className="mx-auto grid max-w-[1440px] gap-2 px-3 py-2 sm:gap-2.5 sm:px-6 sm:py-2.5 lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-x-8 lg:gap-y-1.5 lg:py-2.5">
        <div className="min-w-0">
          <p className="mb-0.5 text-xs font-semibold text-[#80613B] sm:mb-1">{track.label} · {lesson.number}장</p>
          <h1 id="lesson-title" className="break-keep text-lg font-bold leading-tight tracking-tight sm:text-2xl">{lesson.title}</h1>
          <div className="mt-1 flex items-start gap-1.5 sm:mt-1.5">
            <p
              ref={introRef}
              className={`min-w-0 flex-1 max-w-[68ch] break-keep text-xs leading-relaxed text-[#59483B] sm:text-sm ${introExpanded ? '' : 'line-clamp-1'}`}
            >
              {introText}
            </p>
            {showIntroToggle && (
              <button
                type="button"
                data-testid="lesson-intro-toggle"
                onClick={() => setIntroExpanded((open) => !open)}
                aria-expanded={introExpanded}
                className="min-h-6 shrink-0 px-1 text-xs font-semibold text-[#166447] underline"
              >
                {introExpanded ? '접기' : '더 보기'}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-[#715A43] sm:mt-1 sm:text-xs">
            가상 실습이에요. 실제 GitHub에는 반영되지 않아요.
          </p>
          {hasAdvancedNote && introExpanded && (
            <p className="mt-1 text-xs text-[#715A43]">
              선택 심화 과정이에요. 기본 1~4장만 완주해도 팀 협업의 기본은 충분해요.
            </p>
          )}
        </div>
        <div className="min-w-0 border-l-[3px] border-[#D69724] pl-3 sm:pl-3.5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#715A43]">
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
              {nextStep && !saveDraft && <p className="mt-1 break-keep text-sm sm:mt-1.5 [overflow-wrap:anywhere]">{nextStep.goal}</p>}
              {docDiffDone && (
                <p className="mt-1 text-xs font-semibold text-[#196446]">
                  {docRemoved + docAdded > 0
                    ? `비교 결과 · ${docModeLabel}: 빠진 줄 ${docRemoved}개 · 들어간 줄 ${docAdded}개`
                    : sim.staged.length > 0 && sim.document?.comparison === 'working'
                      ? '비교 결과 · 바뀐 줄: 작업 파일과 장바구니가 같아요. 방금 담은 변경은 ‘담아 둔 변경’ 탭에서 확인하세요.'
                      : `비교 결과 · ${docModeLabel}: 바뀐 줄이 없어요`}
                </p>
              )}
              {nextStep?.prediction && quiz && quiz.stepId === nextStep.id && (
                <div data-testid="prediction-quiz" className="mt-1.5 rounded-md border border-[#C9B8E8] bg-[#F5F0FB] px-2.5 py-1.5 text-xs leading-normal text-[#4A3670] sm:mt-2">
                  <p className="font-semibold text-[#5B3E9E]">잠깐! 실행 전에 예측해 봐요</p>
                  <p className="mt-0.5 break-keep">{nextStep.prediction.question}</p>
                  {quiz.picked === null ? (
                    <div className="mt-1 flex flex-col items-start gap-1">
                      {nextStep.prediction.choices.map((choice, index) => (
                        <button
                          key={choice}
                          type="button"
                          data-testid={`prediction-choice-${index}`}
                          onClick={() => setQuiz({ stepId: nextStep.id, picked: index as 0 | 1 })}
                          className="pixel-btn max-w-full rounded-md border-[#B9A6E8] bg-[#FFFDF8] px-2.5 py-0.5 text-left font-semibold hover:bg-[#F1EAF9]"
                        >
                          {index === 0 ? '①' : '②'} {choice}
                        </button>
                      ))}
                      <button type="button" onClick={() => { setQuiz(null); runNow(); }} className="min-h-6 px-1 text-[#715A43] underline">
                        건너뛰고 실행하기
                      </button>
                    </div>
                  ) : (
                    <p role="status" className="mt-1 break-keep font-semibold">
                      {quiz.picked === nextStep.prediction.answer
                        ? '정답! 🎉 '
                        : `아쉬워요. 정답은 ${nextStep.prediction.answer === 0 ? '①' : '②'}번. `}
                      {nextStep.prediction.explain}
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                data-testid="guided-command"
                onClick={runGuidedStep}
                disabled={awaitingPick}
                className="pixel-btn mt-1.5 inline-flex max-w-full items-center gap-2 rounded-md border-[#C78B1E] bg-[#F4B942] px-3 py-1.5 text-left text-sm font-bold text-[#362711] hover:bg-[#F7C55D] sm:mt-2"
              >
                <ButtonIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="break-keep">{label}</span>
              </button>
              {nextStep && !editDocument && !saveDraft && (
                <div className="mt-1.5 text-xs text-[#715A43] sm:mt-2">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <code className="font-mono-code break-words">{nextStep.command}</code>
                    {isPracticeCommand(nextStep.command) && (
                      <span
                        title="이 실습 앱에서만 동작하는 체험용 명령어예요"
                        className="inline-flex items-center rounded-full border border-[#D4B47C] bg-[#F7E7C4] px-2 py-0.5 text-[10px] font-semibold leading-none text-[#79521D]"
                      >
                        실습 전용
                      </span>
                    )}
                  </p>
                  {effectiveNote && <p className="mt-1 break-keep leading-relaxed">{effectiveNote}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid={showBasicCertificateCta ? 'basic-certificate-btn' : nextLesson ? 'next-chapter-btn' : 'all-chapters-done-btn'}
                onClick={() => showCertificateCta ? setCertificateOpen(true) : setStage(nextStage)}
                className="pixel-btn inline-flex items-center gap-2 rounded-md border-[#116349] bg-[#197957] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#14694F]"
              >
                {showAllCertificateCta
                  ? `수료증 보기 · ${STAGE_SCENARIOS.length}장 완주 🎉`
                  : showBasicCertificateCta
                    ? '기본 과정 수료증 보기'
                    : nextLabel}
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
              </button>
              {showCertificateCta && (
                <button
                  type="button"
                  data-testid="next-chapter-secondary-btn"
                  onClick={() => setStage(nextStage)}
                  className="rounded-md border border-[#CDBCA3] px-3 py-1.5 text-sm font-semibold"
                >
                  {nextLabel}
                </button>
              )}
              {lesson.id === 'docs' && !sim.completedActions.includes('REVERT') && (
                <button type="button" onClick={() => runCommand(DOCUMENT_REVERT.command)}
                  className="rounded-md border border-[#CDBCA3] px-3 py-1.5 text-sm font-semibold">
                  {DOCUMENT_REVERT.label}
                </button>
              )}
            </div>
          )}
        </div>
        {stepTerms.length > 0 && (
          <dl data-testid="step-terms" className="space-y-0.5 rounded-md border border-[#E3D5BE] bg-[#F9F3E8] px-2.5 py-1 text-xs leading-snug text-[#59483B] lg:col-start-1 lg:row-start-2">
            {stepTerms.map(({ name, meaning }) => (
              <div key={name} className="break-keep">
                <dt className="inline font-semibold text-[#14694F]">{name}</dt>
                <dd className="inline"> — {meaning}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {(lesson.terms.length > 0 || lesson.id === 'docs' || lesson.id === 'ch4') && (
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-x-5 gap-y-1.5 px-3 pb-1.5 sm:px-6 sm:pb-2">
          {lesson.terms.length > 0 && (
            <details data-testid="all-terms">
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
          {(lesson.id === 'docs' || lesson.id === 'ch4') && <GitHubWebGuide />}
        </div>
      )}
    </section>
  );
}

function GitHubWebGuide() {
  return (
    <details data-testid="github-web-guide" className="max-w-[68ch] text-xs">
      <summary className="cursor-pointer font-semibold text-[#166447]">GitHub 웹에서 이어 하기 (실제 GitHub 화면 대응)</summary>
      <div className="mt-1.5 rounded-md border border-[#DED1B8] bg-[#F9F3E8] px-2.5 py-2">
        <ol className="mb-2 ml-4 list-decimal space-y-1.5 break-keep leading-relaxed text-[#59483B]">
          <li>저장소에서 문서를 열고 연필 버튼으로 편집해요. <strong>Preview</strong>에서 문서가 어떻게 보이는지 확인해요.</li>
          <li><strong>Commit changes</strong>에서 변경 이유를 적고 새 브랜치에 기록해요. 쓰기 권한이 없는 저장소에서는 포크(다른 사람 저장소를 내 계정으로 복사)를 만들어 <strong>Propose changes</strong>로 변경을 제안할 수 있어요.</li>
          <li><strong>Compare &amp; pull request</strong>에서 변경을 확인하고 <strong>Create pull request</strong>로 팀에 검토를 요청해요.</li>
          <li><strong>Conversation</strong> 탭에서 팀원의 리뷰 의견과 승인 여부를 확인해요. PR 작성자는 자기 PR을 직접 승인할 수 없어요.</li>
          <li><strong>Files changed → Review changes → Approve</strong>는 리뷰어(팀원)가 남기는 승인이에요. 이 실습에서는 ‘팀원 승인 확인하기’ 단계에서 팀원 승인이 자동으로 도착해요.</li>
          <li>승인을 확인한 뒤 PR 하단의 <strong>Merge pull request</strong> 버튼으로 합쳐요.</li>
        </ol>
        <p className="mb-2 break-keep leading-relaxed text-[#715A43]">
          Preview·Commit changes·Compare &amp; pull request·Merge pull request는 실제 GitHub 웹사이트 버튼이에요. 이 실습에서는 명령으로 같은 일을 해요.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-[#166447]">
          <a className="underline" target="_blank" rel="noopener noreferrer"
            href="https://docs.github.com/ko/repositories/working-with-files/managing-files/editing-files">
            GitHub 문서 편집 도움말<span className="sr-only"> (새 탭)</span>
          </a>
          <a className="underline" target="_blank" rel="noopener noreferrer"
            href="https://docs.github.com/ko/pull-requests/how-tos/create-pull-requests/creating-a-pull-request">
            GitHub 검토 요청 도움말<span className="sr-only"> (새 탭)</span>
          </a>
        </div>
      </div>
    </details>
  );
}
