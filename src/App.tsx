import { useEffect, useRef } from 'react';
import { syncChapterLocation, usePixelStore } from './store/usePixelStore';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';
import { LessonGuide } from './components/LessonGuide';
import { DocumentLab } from './components/DocumentLab';
import { PracticeConfirmation } from './components/PracticeConfirmation';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);
  const stageId = usePixelStore((s) => s.stageId);
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const onHash = () => setStage(syncChapterLocation());
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStage]);

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
        <LessonGuide />
        {stageId === 'docs' ? <DocumentLab /> : <PixelStageCanvas />}
      </main>
      <TerminalDock />
      <HelpDrawer />
      <PracticeConfirmation />
    </div>
  );
}

export default App;
