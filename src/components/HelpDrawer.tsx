import { useEffect, useRef } from 'react';
import { BookOpen, Play, X } from 'lucide-react';
import { isPracticeCommand, STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

export function HelpDrawer() {
  const helpOpen = usePixelStore((s) => s.helpOpen);
  const stageId = usePixelStore((s) => s.stageId);
  const setHelpOpen = usePixelStore((s) => s.setHelpOpen);
  const runCommand = usePixelStore((s) => s.runCommand);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lesson = STAGE_MAP[stageId];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (helpOpen && !dialog.open) dialog.showModal();
    if (!helpOpen && dialog.open) dialog.close();
  }, [helpOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="dictionary-title"
      onCancel={() => setHelpOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent text-[#2F241D] backdrop:bg-[#2F241D]/30"
    >
      <aside className="ml-auto flex h-full w-full max-w-md flex-col border-l-2 border-[#D4C3A8] bg-[#FAF4E8] shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-[#D4C3A8] bg-[#EFE6D5] px-5 py-4">
          <div className="flex items-center gap-2">
            <BookOpen aria-hidden="true" className="h-5 w-5 text-[#965B0D]" />
            <h2 id="dictionary-title" className="text-lg font-bold">명령어 사전</h2>
          </div>
          <button type="button" aria-label="명령어 사전 닫기" onClick={() => setHelpOpen(false)}
            className="rounded-md border border-[#CFBFA4] bg-[#FFFDF8] p-2 hover:bg-white">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section aria-labelledby="terms-title">
            <h3 id="terms-title" className="mb-2 font-bold">{lesson.number}장 · {lesson.shortTitle}</h3>
            <dl className="space-y-2 rounded-lg border border-[#D8C9B0] bg-[#FFFDF8] p-3 text-sm leading-relaxed">
              {lesson.terms.map(({ name, meaning }) => (
                <div key={name}>
                  <dt className="font-semibold text-[#14694F]">{name}</dt>
                  <dd className="break-keep text-[#59483B]">{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="examples-title">
            <h3 id="examples-title" className="font-bold">명령어 예제</h3>
            <p className="mb-2 mt-1 text-sm text-[#695643]">버튼을 누르면 브라우저 속 연습 저장소에서 실행돼요.</p>
            <ul className="space-y-2">
              {lesson.cheatSheet.map(({ cmd, desc }) => (
                <li key={cmd} className="flex items-center gap-3 rounded-lg border border-[#D8C9B0] bg-[#FFFDF8] p-3">
                  <div className="min-w-0 flex-1">
                    <code className="font-mono-code break-all text-sm font-semibold text-[#14694F]">{cmd}</code>
                    {isPracticeCommand(cmd) && <span className="ml-2 inline-block text-xs text-[#79521D]">실습 전용</span>}
                    <p className="mt-1 break-keep text-sm leading-relaxed text-[#59483B]">{desc}</p>
                  </div>
                  <button type="button" aria-label={`${cmd} 실행`}
                    onClick={() => { runCommand(cmd); setHelpOpen(false); }}
                    className="pixel-btn inline-flex shrink-0 items-center gap-1 rounded-md border-[#C78B1E] bg-[#F4B942] px-2 py-1.5 text-xs font-semibold">
                    <Play aria-hidden="true" className="h-3 w-3 fill-current" /> 실행
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </dialog>
  );
}
