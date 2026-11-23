import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Maximize2, Minimize2, Terminal } from 'lucide-react';
import { STAGE_MAP, getCommandAutocomplete, isPracticeCommand, isStepCompleted } from '../engine';
import { DOCUMENT_SAVE_LABEL } from '../engine/documentDiff';
import { usePixelStore } from '../store/usePixelStore';
import type { TerminalLineTone } from '../types/sim';

const TONE_CLASS: Record<TerminalLineTone, string> = {
  default: 'text-[#3A2D24]',
  mint: 'text-[#147A5B]',
  amber: 'text-[#A66008]',
  coral: 'text-[#B82E3F]',
  sky: 'text-[#1B6799]',
  lavender: 'text-[#623AA8]',
  muted: 'text-[#715D49]',
};

type Suggestion = ReturnType<typeof getCommandAutocomplete>[number];

export function TerminalDock() {
  const sim = usePixelStore((state) => state.sim);
  const history = usePixelStore((state) => state.history);
  const runCommand = usePixelStore((state) => state.runCommand);
  const notice = usePixelStore((state) => state.notice);
  const [open, setOpen] = useState(true);
  const [tall, setTall] = useState(false);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [cycle, setCycle] = useState<{ options: Suggestion[]; index: number } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState('');
  const prompt = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  const scenario = STAGE_MAP[sim.stageId];
  const next = scenario.steps.find((step) => !isStepCompleted(sim, step));
  const promptLabel = sim.headBranch;
  const promptTitle = sim.stageId === 'ch8' && sim.ai.worktreeActive
    ? `현재 브랜치: ${sim.headBranch} · AI 작업 폴더: ${sim.ai.worktreeDir ?? 'wt-ai'} (${sim.ai.worktreeBranch})`
    : `현재 브랜치: ${sim.headBranch}`;
  const options = useMemo(() => {
    if (cycle) return cycle.options;
    return input.trim() ? getCommandAutocomplete(input, sim).slice(0, 5) : [];
  }, [cycle, input, sim]);
  const showOptions = focused && !dismissed && options.length > 0 &&
    (cycle !== null || options.length > 1 || options[0].cmd !== input.trim());
  const active = cycle?.index;

  useEffect(() => {
    setInput('');
    setDismissed(false);
    setCycle(null);
    setHistoryIndex(null);
  }, [sim.stageId]);

  useEffect(() => {
    if (open && !wasOpen.current && window.matchMedia('(pointer: fine)').matches) {
      prompt.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [open, sim.terminal]);

  useEffect(() => {
    const element = log.current;
    if (!open || !element) return;
    const observer = new ResizeObserver(() => { element.scrollTop = element.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (showOptions && active !== undefined) {
      document.getElementById(`terminal-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [showOptions, active]);

  useEffect(() => {
    if (!open) return;
    document.getElementById('quick-action-recommended')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, next?.command]);

  function submit() {
    if (!input.trim()) return;
    runCommand(input);
    setInput('');
    setCycle(null);
    setHistoryIndex(null);
    setDismissed(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      setDismissed(true);
      setCycle(null);
      return;
    }
    if (showOptions && ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const from = active ?? (direction > 0 ? -1 : 0);
      const index = (from + direction + options.length) % options.length;
      setCycle({ options, index });
      setInput(options[index].cmd);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (history.length === 0 || (historyIndex === null && event.key === 'ArrowDown')) return;
    event.preventDefault();
    if (historyIndex === null) setDraftInput(input);
    const index = Math.max(0, (historyIndex ?? history.length) + (event.key === 'ArrowUp' ? -1 : 1));
    setHistoryIndex(index < history.length ? index : null);
    setInput(history[index] ?? draftInput);
    setCycle(null);
    setDismissed(true);
  }

  return (
    <section
      aria-label="실습 터미널"
      data-expanded={open || undefined}
      data-size={open ? (tall ? 'tall' : 'default') : 'closed'}
      className={`terminal-dock relative z-10 flex shrink-0 flex-col border-t border-[#CBB99C] bg-[#FBF6EC] ${
        open
          ? tall
            ? 'h-[min(72%,40rem)] lg:h-[min(72%,44rem)]'
            : 'h-[min(38%,15.5rem)] sm:h-[min(34%,17rem)] lg:h-[min(31%,17rem)]'
          : ''
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`terminal-header flex shrink-0 items-center bg-[#EFE6D5] ${open ? 'gap-2 pr-2 sm:pr-3' : ''}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="terminal-content"
            onClick={() => setOpen(!open)}
            className={`terminal-toggle flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm font-bold text-[#3A2D24] hover:bg-[#F4EADB] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#166447] sm:px-4 ${open ? 'min-h-9 sm:min-h-10' : 'min-h-11'}`}
          >
            <Terminal aria-hidden="true" className="h-4 w-4 shrink-0 text-[#126549]" />
            <span className="truncate">{open ? '터미널 접기' : '직접 입력해 보기'}</span>
            <span aria-hidden="true" className="hidden text-xs font-normal text-[#715D49] sm:inline">빠른 실행·결과</span>
            {open ? <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" /> : <ChevronUp aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" />}
          </button>
          {open && (
            <button
              type="button"
              data-testid="terminal-size-toggle"
              aria-pressed={tall}
              title={tall ? '터미널을 기본 크기로 되돌리기' : '터미널 출력 창 크게 보기'}
              onClick={() => setTall((current) => !current)}
              className="terminal-size-btn inline-flex shrink-0 items-center gap-1 rounded-md border border-[#C7B394] bg-[#FFFDF8] px-2.5 py-1 text-xs font-semibold text-[#3A2D24] hover:bg-[#FFF3D6] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#166447]"
            >
              {tall ? <Minimize2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#126549]" /> : <Maximize2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#126549]" />}
              <span>{tall ? '기본 크기' : '크게 보기'}</span>
            </button>
          )}
        </div>
        {notice && <p role="status" className="shrink-0 border-b border-[#DDBE8A] bg-[#FFF2D7] px-3 py-1 text-xs font-semibold text-[#73450E] sm:px-4">{notice}</p>}
        <div id="terminal-content" hidden={!open} className={open ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          <div role="group" aria-label="빠른 실행" className="terminal-quick-actions flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain border-y border-[#E3D5BE] bg-[#F6EDDE] px-3 py-1 sm:px-4 sm:py-1.5">
            <span className="mr-1 shrink-0 text-xs font-semibold text-[#715D49]">빠른 실행</span>
            {scenario.chips.map((chip) => {
              const step = chip.stepIndex === undefined ? undefined : scenario.steps[chip.stepIndex];
              const recommended = next?.command === chip.command;
              const done = step && isStepCompleted(sim, step);
              return (
                <button
                  key={chip.command}
                  id={recommended ? 'quick-action-recommended' : undefined}
                  type="button"
                  onClick={() => { runCommand(chip.command); setDismissed(true); }}
                  title={chip.command}
                  className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-left text-xs ${recommended ? 'border-[#BF8B29] bg-[#FFE7A8] font-bold' : 'border-[#D7C7AE] bg-[#FFFDF8]'}`}
                >
                  {done && <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-[#147A5B]" />}
                  {chip.label}
                  {isPracticeCommand(chip.command) && (
                    <span className="shrink-0 rounded-full border border-[#D4B47C] bg-[#F7E7C4] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#79521D]">
                      실습 전용
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            ref={log}
            role="log"
            aria-label="명령 실행 결과"
            aria-live="polite"
            tabIndex={0}
            className="terminal-log font-mono-code min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#FFFDF8]/70 px-3 py-1.5 text-[13px] leading-snug focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#166447] sm:space-y-2.5 sm:px-4 sm:py-3 sm:text-sm sm:leading-6"
          >
            {sim.terminal.map((entry) => (
              <div key={entry.id}>
                <p className="break-words font-semibold">
                  {entry.command === 'welcome' ? '연습 저장소'
                    : entry.command === DOCUMENT_SAVE_LABEL ? entry.command : '$ ' + entry.command}
                </p>
                {entry.lines.map((line, index) => (
                  <p key={index} className={`whitespace-pre-wrap pl-3 [overflow-wrap:anywhere] ${TONE_CLASS[line.tone]}`}>{line.text}</p>
                ))}
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); submit(); }}
            className="terminal-form relative shrink-0 border-t border-[#DFCEB3] bg-[#F1E8D8] px-3 py-1.5 sm:px-4 sm:py-2.5"
          >
            {showOptions && (
              <ul
                id="terminal-options"
                role="listbox"
                aria-label="자동완성 후보"
                className="terminal-options absolute inset-x-3 bottom-full mb-1.5 max-h-[min(14rem,42vh)] overflow-y-auto rounded-lg border border-[#CBB99C] bg-[#FFFDF8] shadow-lg sm:inset-x-4"
              >
                {options.map(({ cmd, hint }, index) => (
                  <li
                    key={cmd}
                    id={`terminal-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setInput(cmd); setCycle(null); setDismissed(true); prompt.current?.focus(); }}
                    className={`cursor-pointer border-b border-[#ECE1CF] px-3 py-2 text-xs last:border-b-0 hover:bg-[#FFF3D1] sm:px-3.5 sm:py-2.5 sm:text-[13px] ${index === active ? 'bg-[#FFE7A8]' : ''}`}
                  >
                    <code className="font-mono-code font-semibold text-[#2F241D] [overflow-wrap:anywhere]">{cmd}</code>
                    <span className="ml-2 text-[#6B5743]">{hint}</span>
                  </li>
                ))}
              </ul>
            )}
            <div aria-hidden="true" title={promptTitle} className="terminal-prompt-meta mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#126549] sm:hidden">
              <span className="font-mono-code min-w-0 truncate rounded bg-[#E4F2EC] px-1.5 py-0.5 text-[#126549]">{promptLabel}</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span aria-hidden="true" title={promptTitle} className="terminal-prompt-inline font-mono-code hidden max-w-[11rem] shrink-0 truncate text-sm font-bold text-[#126549] sm:inline lg:max-w-[14rem]">
                {promptLabel} $
              </span>
              <span aria-hidden="true" title={promptTitle} className="font-mono-code shrink-0 text-sm font-bold text-[#126549] sm:hidden">
                $
              </span>
              <input
                ref={prompt}
                data-testid="terminal-input"
                role="combobox"
                aria-label="연습할 명령어"
                aria-expanded={showOptions}
                aria-controls={showOptions ? 'terminal-options' : undefined}
                aria-haspopup="listbox"
                aria-autocomplete="list"
                aria-activedescendant={showOptions && active !== undefined ? `terminal-option-${active}` : undefined}
                aria-describedby="terminal-keys"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setCycle(null);
                  setHistoryIndex(null);
                  setDismissed(false);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => { setFocused(false); setCycle(null); }}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={next?.command ?? '명령어를 입력하세요'}
                className="terminal-input font-mono-code min-h-10 min-w-0 flex-1 rounded-md border border-[#CBB38E] bg-[#FFFDF8] px-3 py-2 text-base text-[#2F241D] placeholder:text-[#8A7560] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#166447] sm:min-h-11 sm:px-3.5 sm:text-[15px]"
              />
              <span id="terminal-keys" className="sr-only">Tab으로 추천 명령을 순환하고 Esc로 목록을 닫아요.</span>
              <button
                type="submit"
                className="terminal-submit min-h-10 shrink-0 rounded-md border border-[#BF8B29] bg-[#F4B942] px-3.5 py-2 text-sm font-bold text-[#362711] hover:bg-[#F7C55D] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#166447] sm:min-h-11 sm:px-4"
              >
                실행
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
