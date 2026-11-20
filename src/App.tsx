import { useEffect } from 'react';
import { readStageFromLocation, usePixelStore } from './store/usePixelStore';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';
import { LessonGuide } from './components/LessonGuide';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);

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
        <PixelStageCanvas />
        <TerminalDock />
      </main>
      <HelpDrawer />
    </div>
  );
}

export default App;
