import { useEffect, useRef } from 'react';
import { syncChapterLocation, usePixelStore } from './store/usePixelStore';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';
import { LessonGuide } from './components/LessonGuide';
import { DocumentLab } from './components/DocumentLab';
import { PracticeConfirmation } from './components/PracticeConfirmation';
import { flushPracticeSaves, type PracticeSaveIssue } from './store/practiceStorage';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);
  const stageId = usePixelStore((s) => s.stageId);
  const saveIssue = usePixelStore((s) => s.saveIssues[s.stageId]);
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

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
  const resetStage = usePixelStore((state) => state.resetStage);
  const updated = issue === 'example-updated';

  return (
    <section aria-labelledby="practice-recovery-title" className="mx-auto mt-6 w-[calc(100%-2rem)] max-w-xl rounded-xl border border-[#CDBCA3] bg-[#FFFDF8] p-5 sm:p-6">
      <h1 id="practice-recovery-title" className="break-keep text-xl font-bold">
        {updated ? '이 장의 예제가 회의록으로 바뀌었어요' : '이 장의 저장 내용을 읽을 수 없어요'}
      </h1>
      <p className="mt-2 break-keep text-sm leading-relaxed text-[#59483B]">
        {updated ? '이전 실습 기록은 브라우저에 보관했어요. 이 장을 초기화하면 새 문서 예제가 열려요.'
          : '현재 장을 초기화하면 처음부터 다시 실습할 수 있어요.'}
      </p>
      <button type="button" onClick={resetStage} className="pixel-btn mt-4 rounded-md border-[#C78B1E] bg-[#F4B942] px-3 py-2 text-sm font-bold">
        현재 장 초기화
      </button>
    </section>
  );
}

export default App;
