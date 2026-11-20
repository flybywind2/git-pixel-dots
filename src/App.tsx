import { useEffect } from 'react';
import { ALL_STAGE_IDS, type StageId } from './types/sim';
import { usePixelStore } from './store/usePixelStore';
import { TopStageBar } from './components/TopStageBar';
import { PixelStageCanvas } from './pixel/PixelStageCanvas';
import { TerminalDock } from './components/TerminalDock';
import { HelpDrawer } from './components/HelpDrawer';

export function App() {
  const setStage = usePixelStore((s) => s.setStage);

  useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.replace(/^#\/?/, '') as StageId;
      if ((ALL_STAGE_IDS as readonly string[]).includes(raw)) {
        if (usePixelStore.getState().stageId !== raw) {
          setStage(raw);
        }
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStage]);

  return (
    <div className="h-screen w-full overflow-hidden bg-[#131722] text-[#FFF8EB] flex flex-col">
      <TopStageBar />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-[260px] relative overflow-hidden">
          <PixelStageCanvas />
        </div>
        <TerminalDock />
      </main>
      <HelpDrawer />
    </div>
  );
}

export default App;
