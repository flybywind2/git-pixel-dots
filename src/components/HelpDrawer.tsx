import { useEffect, useRef, useState } from 'react';
import { BookOpen, Play, Search, X } from 'lucide-react';
import { isPracticeCommand, STAGE_MAP, STAGE_SCENARIOS } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

export function HelpDrawer() {
  const helpOpen = usePixelStore((state) => state.helpOpen);
  const stageId = usePixelStore((state) => state.stageId);
  const setHelpOpen = usePixelStore((state) => state.setHelpOpen);
  const setStage = usePixelStore((state) => state.setStage);
  const runCommand = usePixelStore((state) => state.runCommand);
  const [query, setQuery] = useState('');
  const [allLessons, setAllLessons] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lesson = STAGE_MAP[stageId];
  const term = query.trim().toLowerCase();
  const groups = (allLessons || term ? STAGE_SCENARIOS : [lesson]).map((entry) => ({
    lesson: entry,
    commands: entry.cheatSheet.filter(({ cmd, desc }) => `${entry.shortTitle} ${cmd} ${desc}`.toLowerCase().includes(term)),
  })).filter((group) => group.commands.length > 0);

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
          <h2 id="dictionary-title" className="flex items-center gap-2 text-lg font-bold">
            <BookOpen aria-hidden="true" className="h-5 w-5 text-[#965B0D]" /> 명령어 사전
          </h2>
          <button type="button" aria-label="명령어 사전 닫기" onClick={() => setHelpOpen(false)}
            className="rounded-md border border-[#CFBFA4] bg-[#FFFDF8] p-2 hover:bg-white">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-2 border-b border-[#D4C3A8] px-5 py-3">
          <label className="flex items-center gap-2 rounded-md border border-[#CFBFA4] bg-[#FFFDF8] px-2 focus-within:outline-2 focus-within:outline-[#196446]">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[#695643]" />
            <span className="sr-only">모든 장에서 명령어 검색</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="모든 장에서 명령어 검색" className="min-w-0 flex-1 py-2 text-sm outline-none" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allLessons || Boolean(term)} disabled={Boolean(term)}
              onChange={(event) => setAllLessons(event.target.checked)} /> 모든 장 보기
          </label>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!term && !allLessons && (
            <section aria-labelledby="terms-title">
              <h3 id="terms-title" className="mb-2 font-bold">이 장에서 쓰는 용어</h3>
              <dl className="space-y-2 rounded-lg border border-[#D8C9B0] bg-[#FFFDF8] p-3 text-sm leading-relaxed">
                {lesson.terms.map(({ name, meaning }) => (
                  <div key={name}>
                    <dt className="font-semibold text-[#14694F]">{name}</dt>
                    <dd className="break-keep text-[#59483B]">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {groups.length === 0 && <p role="status" className="text-sm">일치하는 명령어가 없어요.</p>}
          {groups.map(({ lesson: group, commands }) => (
            <section key={group.id} aria-labelledby={`examples-${group.id}`}>
              <h3 id={`examples-${group.id}`} className="mb-2 font-bold">{group.number}장 · {group.shortTitle}</h3>
              <ul className="space-y-2">
                {commands.map(({ cmd, desc }) => (
                  <li key={cmd} className="flex items-center gap-3 rounded-lg border border-[#D8C9B0] bg-[#FFFDF8] p-3">
                    <div className="min-w-0 flex-1">
                      <code className="font-mono-code break-all text-sm font-semibold text-[#14694F]">{cmd}</code>
                      {isPracticeCommand(cmd) && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-[#D4B47C] bg-[#F7E7C4] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#79521D]">
                          실습 전용
                        </span>
                      )}
                      <p className="mt-1 break-keep text-sm leading-relaxed text-[#59483B]">{desc}</p>
                    </div>
                    {group.id === stageId ? (
                      <button type="button" aria-label={`${cmd} 실행`}
                        onClick={() => { runCommand(cmd); setHelpOpen(false); }}
                        className="pixel-btn inline-flex shrink-0 items-center gap-1 rounded-md border-[#C78B1E] bg-[#F4B942] px-2 py-1.5 text-xs font-semibold">
                        <Play aria-hidden="true" className="h-3 w-3 fill-current" /> 실행
                      </button>
                    ) : (
                      <button type="button" onClick={() => { setStage(group.id); setHelpOpen(false); }}
                        className="shrink-0 rounded-md border border-[#CBB99C] px-2 py-1.5 text-xs font-semibold">
                        {group.number}장 열기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </dialog>
  );
}
