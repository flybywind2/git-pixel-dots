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

/**
 * 터미널이 펼쳐질 때 입력창에 포커스를 줄지 결정해요.
 * 첫 로드(이미 펼쳐진 상태)에서는 자동 포커스를 주지 않고,
 * 사용자가 접었다가 다시 펼칠 때만 마우스가 있는 환경에서 포커스를 줘요.
 */
export function shouldFocusTerminalOnExpand(open: boolean, wasOpen: boolean, finePointer: boolean): boolean {
  return open && !wasOpen && finePointer;
}

/**
 * 저장된 사용자 설정이 없을 때 터미널 기본 펼침 여부를 정해요.
 * 데스크톱(>=640px, 정밀 포인터)에서는 기본 펼침,
 * 휴대폰(좁은 화면 <640px 또는 터치 기기)에서는 첫 화면에 그림/편집기가 보이도록 기본 접힘으로 시작해요.
 */
export function defaultTerminalOpen(viewportWidth: number, coarsePointer: boolean): boolean {
  return viewportWidth >= 640 && !coarsePointer;
}

/**
 * 입력창 placeholder에 "(Tab 완성)" 안내를 붙일지 결정해요.
 * 터치 기기(pointer: coarse)나 좁은 화면(<640px)에서는 생략해 예시 명령이 잘리지 않게 해요.
 */
export function shouldShowTabHint(coarsePointer: boolean, viewportWidth: number): boolean {
  return !coarsePointer && viewportWidth >= 640;
}

/**
 * 다음 단계 예시 명령을 placeholder 안내 문구로 바꿔요.
 * "예: " 접두어는 화면용일 뿐이고, 실제 자동 완성에는 순수 명령만 써요.
 */
export function examplePlaceholder(command: string | null | undefined, showTabHint = true): string {
  if (!command) return '명령어를 입력하세요';
  return showTabHint ? `예: ${command} (Tab 완성)` : `예: ${command}`;
}

/**
 * Tab을 눌렀을 때 입력창에 채울 값을 정해요.
 * - 빈 입력창: 다음 단계 예시 명령이 있으면 그대로 채워요.
 * - 입력 중: 기존 자동완성 후보가 있으면 기존 순환 동작에 맡기고,
 *   후보가 없더라도 현재 입력이 예시 명령의 접두어면 예시 명령으로 완성해요.
 * - Shift+Tab, 채울 것이 없을 때: null을 돌려 기본 포커스 이동을 유지해요.
 */
export function resolveTabCompletion(
  value: string,
  exampleCommand: string | null | undefined,
  suggestions: readonly { cmd: string }[],
  shiftKey = false,
): string | null {
  if (shiftKey) return null;
  const typed = value.trim();
  const example = exampleCommand?.trim();
  if (!typed) return example || null;
  if (suggestions.length > 0) return null;
  if (!example || typed === example) return null;
  return example.toLowerCase().startsWith(typed.toLowerCase()) ? example : null;
}

const TERMINAL_OPEN_KEY = 'gitdots.terminal.open';
const TERMINAL_TALL_KEY = 'gitdots.terminal.tall';

function readStoredFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // 저장소 접근이 제한된 환경에서는 기본값을 써요.
  }
  return fallback;
}

function writeStoredFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 저장소 쓰기가 막혀도 현재 세션에서는 상태를 유지해요.
  }
}

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

function detectDefaultTerminalOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return defaultTerminalOpen(window.innerWidth, isCoarsePointer());
}

function detectShowTabHint(): boolean {
  if (typeof window === 'undefined') return true;
  return shouldShowTabHint(isCoarsePointer(), window.innerWidth);
}

export function TerminalDock() {
  const sim = usePixelStore((state) => state.sim);
  const lessonResetCount = usePixelStore((state) => state.lessonResetCount);
  const history = usePixelStore((state) => state.history);
  const runCommand = usePixelStore((state) => state.runCommand);
  const notice = usePixelStore((state) => state.notice);
  const [open, setOpen] = useState(() => readStoredFlag(TERMINAL_OPEN_KEY, detectDefaultTerminalOpen()));
  const [tall, setTall] = useState(() => readStoredFlag(TERMINAL_TALL_KEY, false));
  const [showTabHint, setShowTabHint] = useState(detectShowTabHint);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [cycle, setCycle] = useState<{ options: Suggestion[]; index: number } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState('');
  const [hasNewOutput, setHasNewOutput] = useState(false);
  const prompt = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const pinnedToBottom = useRef(true);
  const prevLogCount = useRef(sim.terminal.length);
  const prevLastLogId = useRef(sim.terminal.at(-1)?.id);

  const scenario = STAGE_MAP[sim.stageId];
  const next = scenario.steps.find((step) => !isStepCompleted(sim, step));
  const promptLabel = sim.headBranch;
  const exampleCommand = next?.command ?? null;
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
    setDraftInput('');
    pinnedToBottom.current = true;
    setHasNewOutput(false);
  }, [sim.stageId, lessonResetCount]);

  useEffect(() => {
    const update = () => setShowTabHint(detectShowTabHint());
    const coarse = window.matchMedia('(pointer: coarse)');
    const wide = window.matchMedia('(min-width: 640px)');
    coarse.addEventListener('change', update);
    wide.addEventListener('change', update);
    return () => {
      coarse.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (shouldFocusTerminalOnExpand(open, wasOpen.current, finePointer)) {
      prompt.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const lastId = sim.terminal.at(-1)?.id;
    const appended = sim.terminal.length !== prevLogCount.current || lastId !== prevLastLogId.current;
    prevLogCount.current = sim.terminal.length;
    prevLastLogId.current = lastId;
    if (!log.current) return;
    if (pinnedToBottom.current) {
      log.current.scrollTop = log.current.scrollHeight;
      setHasNewOutput(false);
    } else if (appended && open) {
      setHasNewOutput(true);
    }
  }, [open, sim.terminal]);

  useEffect(() => {
    const element = log.current;
    if (!open || !element) return;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  function handleLogScroll() {
    const element = log.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
    pinnedToBottom.current = atBottom;
    if (atBottom) setHasNewOutput(false);
  }

  function jumpToLatestOutput() {
    pinnedToBottom.current = true;
    setHasNewOutput(false);
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      writeStoredFlag(TERMINAL_OPEN_KEY, next);
      return next;
    });
  }

  function toggleTall() {
    setTall((current) => {
      const next = !current;
      writeStoredFlag(TERMINAL_TALL_KEY, next);
      return next;
    });
  }

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
    if (event.key === 'Tab' && dismissed) return;
    if (showOptions && ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const from = active ?? (direction > 0 ? -1 : 0);
      const index = (from + direction + options.length) % options.length;
      setCycle({ options, index });
      setInput(options[index].cmd);
      return;
    }
    if (event.key === 'Tab') {
      const completion = resolveTabCompletion(input, exampleCommand, options, event.shiftKey);
      if (completion === null) return;
      event.preventDefault();
      setInput(completion);
      setCycle(null);
      setHistoryIndex(null);
      setDismissed(true);
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
            : 'h-[min(36%,15.5rem)] sm:h-[min(34%,17rem)] lg:h-[min(31%,17rem)]'
          : ''
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`terminal-header flex shrink-0 items-center bg-[#EFE6D5] ${open ? 'gap-2 pr-2 sm:pr-3' : ''}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="terminal-content"
            onClick={toggleOpen}
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
              onClick={toggleTall}
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
          <div className="relative min-h-0 flex-1">
            <div
              ref={log}
              role="log"
              aria-label="명령 실행 결과"
              aria-live="off"
              tabIndex={0}
              onScroll={handleLogScroll}
              className="terminal-log font-mono-code h-full space-y-2 overflow-y-auto bg-[#FFFDF8]/70 px-3 py-1.5 text-[13px] leading-snug focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#166447] sm:space-y-2.5 sm:px-4 sm:py-3 sm:text-sm sm:leading-6"
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
            {hasNewOutput && (
              <button
                type="button"
                data-testid="terminal-new-output"
                onClick={jumpToLatestOutput}
                className="pixel-btn absolute bottom-2 right-3 z-10 rounded-full border-[#C78B1E] bg-[#FFE7A8] px-2.5 py-1 text-xs font-bold text-[#362711] hover:bg-[#FFD97D]"
              >
                새 결과 ↓
              </button>
            )}
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); submit(); }}
            className="terminal-form relative shrink-0 border-t border-[#DFCEB3] bg-[#F1E8D8] px-3 py-0.5 min-[360px]:py-1.5 sm:px-4 sm:py-2.5"
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
                onBlur={() => { setFocused(false); setCycle(null); setDismissed(false); }}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={examplePlaceholder(exampleCommand, showTabHint)}
                className="terminal-input font-mono-code min-h-10 min-w-0 flex-1 rounded-md border border-[#CBB38E] bg-[#FFFDF8] px-3 py-2 text-base text-[#2F241D] placeholder:text-[#715D49] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#166447] sm:min-h-11 sm:px-3.5 sm:pointer-fine:text-[15px]"
              />
              <span id="terminal-keys" className="sr-only">입력창이 비어 있으면 Tab으로 예시 명령을 채우고, 입력 중에는 Tab으로 추천 명령을 순환해요. Esc를 누른 뒤 Tab을 누르면 실행 버튼으로 이동해요. Shift+Tab은 이전 항목으로 이동해요.</span>
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
