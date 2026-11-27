import { useEffect, useRef } from 'react';
import { chapterHash, syncChapterLocation, usePixelStore } from './store/usePixelStore';
import { STAGE_MAP } from './engine';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';
import { LessonGuide } from './components/LessonGuide';
import { DocumentLab } from './components/DocumentLab';
import { PracticeConfirmation } from './components/PracticeConfirmation';
import { flushPracticeSaves, readExternalSession, type PracticeSaveIssue } from './store/practiceStorage';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);
  const stageId = usePixelStore((s) => s.stageId);
  const saveIssue = usePixelStore((s) => s.saveIssues[s.stageId]);
  const storageWarning = usePixelStore((s) => s.storageWarning);
  const dismissStorageWarning = usePixelStore((s) => s.dismissStorageWarning);
  const adoptExternalSession = usePixelStore((s) => s.adoptExternalSession);
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.newValue === null) return;
      const external = readExternalSession(event.key, event.newValue);
      if (external) adoptExternalSession(external.id, external.session);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adoptExternalSession]);

  useEffect(() => {
    const onHash = () => setStage(syncChapterLocation());
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStage]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPracticeSaves();
    };
    window.addEventListener('pagehide', flushPracticeSaves);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPracticeSaves);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [stageId]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const element = shell.current;
    if (!element || !viewport) return;
    const resize = () => {
      if (viewport.scale !== 1) {
        element.style.removeProperty('height');
        element.style.removeProperty('top');
        element.removeAttribute('data-compact');
        return;
      }
      element.style.height = `${viewport.height}px`;
      element.style.top = `${viewport.offsetTop}px`;
      element.toggleAttribute('data-compact', viewport.height < 420);
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
    };
  }, []);

  return (
    <div ref={shell} className="practice-shell relative flex h-dvh w-full flex-col bg-[#F6EFE2] text-[#2F241D]">
      <TopStageBar />
      <main ref={main} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
        {storageWarning && (
          <div role="alert" className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-start gap-3 rounded-md border border-[#DDBE8A] bg-[#FFF2D7] px-3 py-2 text-sm text-[#73450E]">
            <p className="flex-1 break-keep leading-relaxed">
              이 브라우저에는 진행 상태를 저장할 수 없어요. 이 창을 닫으면 진행 상태가 사라져요.
            </p>
            <button type="button" onClick={dismissStorageWarning}
              className="shrink-0 rounded-md border border-[#DDBE8A] bg-[#FFFDF8] px-2 py-1 text-xs font-semibold">
              닫기
            </button>
          </div>
        )}
        {saveIssue ? <PracticeRecovery issue={saveIssue} /> : (
          <>
            <LessonGuide />
            {stageId === 'docs' ? <DocumentLab /> : <PixelStageCanvas />}
          </>
        )}
      </main>
      {!saveIssue && <TerminalDock />}
      <HelpDrawer />
      <PracticeConfirmation />
    </div>
  );
}

function PracticeRecovery({ issue }: { issue: PracticeSaveIssue }) {
  const lesson = usePixelStore((state) => STAGE_MAP[state.stageId]);
  const resetStage = usePixelStore((state) => state.resetStage);
  const updated = issue === 'example-updated';
  const updateReason = lesson.id === 'ch2' ? '임시 보관과 취소를 배우는 예제에 비밀 메모를 빼는 실습이 추가됐어요.'
    : lesson.id === 'ch5' ? '글꼴 수정 PR을 합치는 데 필요한 fix/font 브랜치가 예제에 추가됐어요.'
      : '이 장의 시작 파일이나 브랜치가 바뀌었어요.';

  return (
    <section aria-labelledby="practice-recovery-title" className="mx-auto mt-6 w-[calc(100%-2rem)] max-w-xl rounded-xl border border-[#CDBCA3] bg-[#FFFDF8] p-5 sm:p-6">
      <h1 id="practice-recovery-title" className="break-keep text-xl font-bold">
        {lesson.number}장 · {lesson.shortTitle}
      </h1>
      <h2 className="mt-2 break-keep font-bold">
        {updated ? '이 장의 실습 예제가 바뀌었어요' : '이 장의 저장 내용을 읽을 수 없어요'}
      </h2>
      <p className="mt-2 break-keep text-sm leading-relaxed text-[#59483B]">
        {updated ? `${updateReason} 이전 저장본을 초기화하면 새 예제로 시작할 수 있어요.`
          : '이 장의 저장본을 초기화하면 처음부터 다시 실습할 수 있어요.'}
        {' '}초기화하면 이 장의 진행 상태와 파일 변경, 작성 중인 초안이 지워져요. 다른 장은 그대로 저장돼요.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={resetStage} className="pixel-btn rounded-md border-[#C78B1E] bg-[#F4B942] px-3 py-2 text-sm font-bold">
          현재 장 초기화
        </button>
        {lesson.id !== 'docs' && (
          <a href={chapterHash('docs')} className="rounded-md px-2 py-2 text-sm font-semibold text-[#14694F] underline">
            1장으로 이동
          </a>
        )}
      </div>
    </section>
  );
}

export default App;
