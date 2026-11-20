import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Check, CornerDownLeft } from 'lucide-react';
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
  muted: 'text-[#83705E]',
};

export function TerminalDock() {
  const stageId = usePixelStore((s) => s.stageId);
  const sim = usePixelStore((s) => s.sim);
  const history = usePixelStore((s) => s.history);
  const runCommand = usePixelStore((s) => s.runCommand);

  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [draftInput, setDraftInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [tabCycleIdx, setTabCycleIdx] = useState(0);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scenario = STAGE_MAP[stageId];

  const nextStepIndex = scenario.steps.findIndex((step) => !isStepCompleted(sim, step));

  const nextStep = nextStepIndex >= 0 ? scenario?.steps[nextStepIndex] : undefined;

  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    return getCommandAutocomplete(input, sim).slice(0, 5);
  }, [input, sim]);

  const activeSuggestion = suggestions[tabCycleIdx % Math.max(suggestions.length, 1)];

  const ghostSuffix = useMemo(() => {
    if (!input || !activeSuggestion) return '';
    if (activeSuggestion.cmd.toLowerCase().startsWith(input.toLowerCase())) {
      return activeSuggestion.cmd.slice(input.length);
    }
    return '';
  }, [input, activeSuggestion]);

  const showPopup =
    isFocused &&
    !popupDismissed &&
    input.trim().length > 0 &&
    suggestions.length > 0 &&
    !(suggestions.length === 1 && suggestions[0]?.cmd === input.trim());

  const lastEntryId = sim.terminal[sim.terminal.length - 1]?.id ?? '';

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [sim.terminal.length, lastEntryId]);

  useEffect(() => {
    setInput('');
    setDraftInput('');
    setHistoryIdx(-1);
    setPopupDismissed(false);
    setTabCycleIdx(0);
  }, [stageId]);

  const submitCommand = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    runCommand(trimmed);
    setInput('');
    setDraftInput('');
    setHistoryIdx(-1);
    setPopupDismissed(false);
    setTabCycleIdx(0);
  };

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitCommand(input);
  };

  const handleChipClick = (cmd: string) => {
    runCommand(cmd);
    setPopupDismissed(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      if (!e.shiftKey && showPopup) {
        e.preventDefault();
        const exactIdx = suggestions.findIndex((s) => s.cmd === input.trim());
        const nextIdx = exactIdx >= 0 ? (exactIdx + 1) % suggestions.length : 0;
        const chosen = suggestions[nextIdx];
        if (chosen) {
          setInput(chosen.cmd);
          setTabCycleIdx(nextIdx);
          setPopupDismissed(false);
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      setPopupDismissed(true);
      return;
    }

    if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIdx === -1) {
        setDraftInput(input);
        const idx = history.length - 1;
        setHistoryIdx(idx);
        setInput(history[idx] ?? '');
      } else if (historyIdx > 0) {
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setInput(history[idx] ?? '');
      }
      setPopupDismissed(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      if (historyIdx === -1) return;
      e.preventDefault();
      if (historyIdx < history.length - 1) {
        const idx = historyIdx + 1;
        setHistoryIdx(idx);
        setInput(history[idx] ?? '');
      } else {
        setHistoryIdx(-1);
        setInput(draftInput);
      }
      setPopupDismissed(true);
    }
  };

  return (
    <section
      aria-label="인터랙티브 터미널"
      className="h-[240px] sm:h-[260px] shrink-0 bg-[#FBF6EC] border-t-2 border-[#D7C7AE] flex flex-col"
    >
      {/* Top Strip: Friendly 1-Click Command Chips */}
      <div className="px-3 sm:px-4 py-1.5 border-b border-[#E3D5BE] bg-[#EFE6D5] flex items-center gap-1.5 overflow-x-auto shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 text-[11px] font-semibold text-[#7A6856] mr-0.5 select-none">
          빠른 실행
        </span>
        {scenario?.chips.map((chip) => {
          const isRecommended =
            nextStepIndex !== -1 &&
            (chip.stepIndex === nextStepIndex ||
              (chip.stepIndex === undefined &&
                nextStep !== undefined &&
                chip.command.trim() === nextStep.command.trim()));

          const stepForChip =
            chip.stepIndex !== undefined ? scenario.steps[chip.stepIndex] : undefined;
          const isChipDone =
            !isRecommended &&
            stepForChip !== undefined &&
            isStepCompleted(sim, stepForChip);

          return (
            <button
              key={`${chip.command}-${chip.label}`}
              type="button"
              onClick={() => handleChipClick(chip.command)}
              title={`${chip.label} (${chip.command})`}
              className={[
                'shrink-0 px-2.5 py-1 rounded-md border text-xs transition-all duration-150 flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                isRecommended
                  ? 'bg-[#FFE7A8] border-[#D49424] text-[#5C3604] font-bold shadow-[0_2px_0_rgba(180,122,22,0.22)]'
                  : isChipDone
                    ? 'bg-[#E2F6EE] border-[#83D2B6] text-[#14694F] hover:bg-[#D4F1E6]'
                    : 'bg-[#FFFDF8] border-[#D7C7AE] text-[#4E3E33] hover:bg-[#FFF9ED] hover:border-[#BCA585] hover:text-[#2F241D]',
              ].join(' ')}
            >
              {isRecommended && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#C97C10] shrink-0 animate-pulse" />
              )}
              {isChipDone && <Check className="w-3 h-3 text-[#1B916D] shrink-0" />}
              <span>{chip.label}</span>
              <code className="hidden md:inline font-mono-code text-[11px] opacity-75">
                {chip.command}
              </code>
            </button>
          );
        })}
      </div>

      {/* Middle Area: Concise Colorized Output Log */}
      <div
        ref={logRef}
        onClick={() => inputRef.current?.focus()}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-2.5 space-y-2.5 font-mono-code text-xs cursor-text"
      >
        {sim.terminal.length === 0 ? (
          <p className="text-[#695643] leading-relaxed font-sans text-xs sm:text-[13px] py-1">
            위 버튼을 누르거나 입력창에 명령어를 쓰고 Enter를 누르세요.
          </p>
        ) : (
          sim.terminal.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[#2F241D]">
                {entry.command !== 'welcome' && entry.command !== DOCUMENT_SAVE_LABEL && (
                  <span className="text-[#147A5B] font-bold select-none">$</span>
                )}
                <span className="font-semibold break-all">{entry.command === 'welcome' ? '연습 저장소' : entry.command}</span>
                {entry.branch && (
                  <span className="text-[10px] text-[#92806E] ml-auto shrink-0">
                    ({entry.branch})
                  </span>
                )}
              </div>
              {entry.lines.length > 0 && (
                <div className="pl-3.5 space-y-0.5 border-l-2 border-[#E3D5BE]">
                  {entry.lines.map((line, idx) => (
                    <div
                      key={`${entry.id}-${idx}`}
                      className={`${TONE_CLASS[line.tone]} whitespace-pre-wrap break-words leading-relaxed`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom Row: Real Interactive Prompt */}
      <div className="relative shrink-0 px-3 sm:px-4 py-2 border-t border-[#E0D1B8] bg-[#F1E8D8]">
        {/* Autocomplete Popup */}
        {showPopup && (
          <div
            role="listbox"
            aria-label="명령어 자동완성"
            className="absolute left-3 right-3 sm:left-4 sm:right-4 bottom-full mb-1.5 z-30 rounded-lg bg-[#FFFDF8] border-2 border-[#C7B497] shadow-[0_8px_22px_rgba(92,70,48,0.16)] overflow-hidden"
          >
            <div className="px-3 py-1 border-b border-[#EAE0CE] bg-[#F6EFE2] flex items-center justify-between text-[11px] text-[#786758]">
              <span>자동완성 추천</span>
              <span className="font-mono-code">Tab 으로 완성</span>
            </div>
            <div className="divide-y divide-[#EFE6D5]">
              {suggestions.map((item, idx) => (
                <button
                  key={item.cmd}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setInput(item.cmd);
                    setPopupDismissed(true);
                    inputRef.current?.focus();
                  }}
                  className={[
                    'w-full px-3 py-1.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer',
                    idx === tabCycleIdx % suggestions.length
                      ? 'bg-[#FFF3D1] hover:bg-[#FFEAB3]'
                      : 'hover:bg-[#FAF4E8]',
                  ].join(' ')}
                >
                  <span className="font-mono-code text-xs font-semibold text-[#8E5206] truncate">
                    {item.cmd}
                  </span>
                  <span className="text-[11px] text-[#6F5E4F] truncate shrink-0 max-w-[48%]">
                    {item.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
          {/* Cozy Prompt Label */}
          <label
            htmlFor="gitdots-terminal-input"
            className="font-mono-code text-xs shrink-0 flex items-center gap-1 select-none"
          >
            <span className="text-[#147A5B] font-bold">gitdots</span>
            <span className="text-[#1C6291] font-semibold">({sim.headBranch})</span>
            <span className="text-[#B86E10] font-bold">$</span>
          </label>

          {/* Input with subtle inline ghost suggestion */}
          <div className="relative flex-1 min-w-0">
            {ghostSuffix && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center font-mono-code text-xs sm:text-[13px] whitespace-pre overflow-hidden"
              >
                <span className="invisible">{input}</span>
                <span className="text-[#A89683]">{ghostSuffix}</span>
              </div>
            )}
            <input
              id="gitdots-terminal-input"
              ref={inputRef}
              data-testid="terminal-input"
              aria-label="연습할 명령어"
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setHistoryIdx(-1);
                setPopupDismissed(false);
                setTabCycleIdx(0);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={
                nextStep ? `예: ${nextStep.command}` : '명령어를 입력하거나 Tab으로 자동완성...'
              }
              className="relative w-full bg-transparent text-[#2F241D] placeholder:text-[#9D8B78] font-mono-code text-xs sm:text-[13px] py-1 focus:outline-none"
            />
          </div>

          {/* Crisp Warm Honey Execute Button */}
          <button
            type="submit"
            className="pixel-btn shrink-0 px-3 py-1.5 rounded-md bg-[#F4B942] hover:bg-[#F7C55D] text-[#2F241D] border-[#C78B1E] font-pixel text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <span>실행</span>
            <CornerDownLeft className="w-3.5 h-3.5 shrink-0" />
          </button>
        </form>
      </div>
    </section>
  );
}
