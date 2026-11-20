import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { STAGE_MAP, getCommandAutocomplete, isStepCompleted } from '../engine';
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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [cycle, setCycle] = useState<{ options: Suggestion[]; index: number } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState('');
  const prompt = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const scenario = STAGE_MAP[sim.stageId];
  const next = scenario.steps.find((step) => !isStepCompleted(sim, step));
  const promptLabel = sim.stageId === 'ch8' && sim.ai.worktreeActive ? 'wt-ai' : sim.headBranch;
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
    if (open && window.matchMedia('(pointer: fine)').matches) prompt.current?.focus({ preventScroll: true });
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
    <section aria-label="실습 터미널" data-expanded={open || undefined} className={`terminal-dock relative z-10 flex shrink-0 flex-col border-t border-[#CBB99C] bg-[#FBF6EC] ${open ? 'h-[min(44%,14rem)] lg:h-[min(38%,12rem)]' : ''}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="terminal-content"
          onClick={() => setOpen(!open)}
          className={`flex shrink-0 items-center gap-2 bg-[#EFE6D5] px-4 text-left text-sm font-bold text-[#3A2D24] hover:bg-[#F4EADB] ${open ? 'min-h-9' : 'min-h-11'}`}
        >
          <Terminal aria-hidden="true" className="h-4 w-4 shrink-0 text-[#126549]" />
          {open ? '터미널 접기' : '직접 입력해 보기'}
          {open ? <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4" /> : <ChevronUp aria-hidden="true" className="ml-auto h-4 w-4" />}
        </button>
        {notice && <p role="status" className="shrink-0 border-b border-[#DDBE8A] bg-[#FFF2D7] px-3 py-1 text-xs font-semibold text-[#73450E]">{notice}</p>}
        <div id="terminal-content" hidden={!open} className={open ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          <div role="group" aria-label="빠른 실행" className="terminal-quick-actions flex max-h-[44%] shrink-0 flex-wrap items-start gap-1.5 overflow-y-auto overscroll-y-contain border-y border-[#E3D5BE] bg-[#F6EDDE] px-3 py-1.5">
            <span className="mr-1 text-xs font-semibold text-[#715D49]">빠른 실행</span>
            {scenario.chips.map((chip) => {
              const step = chip.stepIndex === undefined ? undefined : scenario.steps[chip.stepIndex];
              const recommended = next?.command === chip.command;
              const done = step && isStepCompleted(sim, step);
              return (
                <button
                  key={chip.command}
                  type="button"
                  onClick={() => { runCommand(chip.command); setDismissed(true); }}
                  title={chip.command}
                  className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-left text-xs ${recommended ? 'border-[#BF8B29] bg-[#FFE7A8] font-bold' : 'border-[#D7C7AE] bg-[#FFFDF8]'}`}
                >
                  {done && <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-[#147A5B]" />}
                  {chip.label}
                </button>
              );
            })}
          </div>
          <div ref={log} role="log" aria-label="명령 실행 결과" aria-live="polite" tabIndex={0}
            className="font-mono-code min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-xs">
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
          <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="relative flex min-h-10 shrink-0 items-center gap-2 border-t border-[#E0D1B8] bg-[#F1E8D8] px-3 py-1">
            {showOptions && (
              <ul id="terminal-options" role="listbox" aria-label="자동완성 후보"
                className="absolute inset-x-3 bottom-full mb-1 max-h-42 overflow-y-auto rounded-md border border-[#CBB99C] bg-[#FFFDF8] shadow-lg">
                {options.map(({ cmd, hint }, index) => (
                  <li key={cmd} id={`terminal-option-${index}`} role="option" aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setInput(cmd); setCycle(null); setDismissed(true); prompt.current?.focus(); }}
                    className={`cursor-pointer border-b border-[#ECE1CF] px-3 py-2 text-xs hover:bg-[#FFF3D1] ${index === active ? 'bg-[#FFE7A8]' : ''}`}>
                    <code className="font-mono-code font-semibold [overflow-wrap:anywhere]">{cmd}</code>
                    <span className="ml-2 text-[#715D49]">{hint}</span>
                  </li>
                ))}
              </ul>
            )}
            <span aria-hidden="true" className="font-mono-code max-w-[25%] truncate text-xs font-bold text-[#126549]">{promptLabel} $</span>
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
              className="font-mono-code min-w-0 flex-1 rounded border border-[#D4C0A1] bg-[#FFFDF8] px-2 py-1.5 text-base text-[#2F241D] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#166447] sm:text-sm"
            />
            <span id="terminal-keys" className="sr-only">Tab으로 추천 명령을 순환하고 Esc로 목록을 닫아요.</span>
            <button type="submit" className="shrink-0 rounded-md border border-[#BF8B29] bg-[#F4B942] px-3 py-1.5 text-sm font-bold">실행</button>
          </form>
        </div>
      </div>
    </section>
  );
}
