import { useEffect } from 'react';
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

  useEffect(() => {
    const onHash = () => setStage(syncChapterLocation());
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStage]);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#F6EFE2] text-[#2F241D]">
      <TopStageBar />
      <main className="flex flex-1 flex-col">
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
