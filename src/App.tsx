import { useEffect } from 'react';
import { readStageFromLocation, usePixelStore } from './store/usePixelStore';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';
import { LessonGuide } from './components/LessonGuide';
import { DocumentLab } from './components/DocumentLab';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);
  const stageId = usePixelStore((s) => s.stageId);

  useEffect(() => {
    const onHash = () => {
      const stage = readStageFromLocation();
      if (usePixelStore.getState().stageId !== stage) setStage(stage);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStage]);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#F6EFE2] text-[#2F241D]">
      <TopStageBar />
      <main className="flex flex-1 flex-col">
        <LessonGuide />
        {stageId === 'docs' ? <DocumentLab /> : <PixelStageCanvas />}
        <TerminalDock />
      </main>
      <HelpDrawer />
    </div>
  );
}

export default App;
