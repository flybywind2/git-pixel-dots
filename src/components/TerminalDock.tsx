import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Check, CornerDownLeft } from 'lucide-react';
import { STAGE_MAP, getCommandAutocomplete } from '../engine';
import { usePixelStore } from '../store/usePixelStore';
import type { PixelAnimKind, StageStep, TerminalLineTone } from '../types/sim';

const TONE_CLASS: Record<TerminalLineTone, string> = {
  default: 'text-[#E8EDF7]',
  mint: 'text-[#5CE1B8]',
  amber: 'text-[#FFD166]',
  coral: 'text-[#FF7B89]',
  sky: 'text-[#6BCBFF]',
  lavender: 'text-[#C4A5FF]',
  muted: 'text-[#7F8EAE]',
};

function isStepDone(step: StageStep, completed: PixelAnimKind[]): boolean {
  if (Array.isArray(step.doneAction)) {
    return step.doneAction.some((act) => completed.includes(act));
  }
  return completed.includes(step.doneAction);
}

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

  const nextStepIndex = useMemo(() => {
    if (!scenario) return -1;
    return scenario.steps.findIndex((step) => !isStepDone(step, sim.completedActions));
  }, [scenario, sim.completedActions]);

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
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      if (suggestions.length > 0) {
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
      className="h-[240px] sm:h-[260px] shrink-0 bg-[#0E121D] border-t-2 border-[#2A334D] flex flex-col"
    >
      {/* Top Strip: Friendly 1-Click Command Chips */}
      <div className="px-3 sm:px-4 py-1.5 border-b border-[#1D253B] bg-[#121726] flex items-center gap-1.5 overflow-x-auto shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 text-[11px] font-medium text-[#7F8EAE] mr-0.5 select-none">
          추천 명령
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
            isStepDone(stepForChip, sim.completedActions);

          return (
            <button
              key={`${chip.command}-${chip.label}`}
              type="button"
              onClick={() => handleChipClick(chip.command)}
              title={`${chip.label} (${chip.command})`}
              className={[
                'shrink-0 px-2.5 py-1 rounded-md border text-xs transition-all duration-150 flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                isRecommended
                  ? 'bg-[#FFD166]/18 border-[#FFD166] text-[#FFE8A3] font-semibold shadow-[0_0_10px_rgba(255,209,102,0.18)]'
                  : isChipDone
                    ? 'bg-[#132328] border-[#2A4D46] text-[#8CE6CB] hover:bg-[#193036] hover:border-[#5CE1B8]/70'
                    : 'bg-[#171E30] border-[#2A3452] text-[#C4CFE8] hover:bg-[#202942] hover:border-[#465682] hover:text-[#FFF8EB]',
              ].join(' ')}
            >
              {isRecommended && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#FFD166] shrink-0 animate-pulse" />
              )}
              {isChipDone && <Check className="w-3 h-3 text-[#5CE1B8] shrink-0" />}
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
          <p className="text-[#9AA8C7] leading-relaxed font-sans text-xs sm:text-[13px] py-1">
            ✨ 위 추천 버튼을 클릭하거나 아래에 명령어를 직접 입력해보세요! (도움말: help)
          </p>
        ) : (
          sim.terminal.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[#FFF8EB]">
                <span className="text-[#5CE1B8] select-none">$</span>
                <span className="font-semibold break-all">{entry.command}</span>
                {entry.branch && (
                  <span className="text-[10px] text-[#6A7899] ml-auto shrink-0">
                    ({entry.branch})
                  </span>
                )}
              </div>
              {entry.lines.length > 0 && (
                <div className="pl-3.5 space-y-0.5 border-l border-[#222B43]">
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
      <div className="relative shrink-0 px-3 sm:px-4 py-2 border-t border-[#202840] bg-[#0B0F19]">
        {/* Autocomplete Popup */}
        {showPopup && (
          <div
            role="listbox"
            aria-label="명령어 자동완성"
            className="absolute left-3 right-3 sm:left-4 sm:right-4 bottom-full mb-1.5 z-30 rounded-lg bg-[#151B2C] border-2 border-[#323E60] shadow-[0_8px_24px_rgba(0,0,0,0.45)] overflow-hidden"
          >
            <div className="px-3 py-1 border-b border-[#232D47] flex items-center justify-between text-[11px] text-[#8392B5]">
              <span>자동완성 추천</span>
              <span className="font-mono-code">Tab 으로 완성</span>
            </div>
            <div className="divide-y divide-[#1E273F]">
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
                    idx === 0
                      ? 'bg-[#FFD166]/10 hover:bg-[#FFD166]/18'
                      : 'hover:bg-[#1E263D]',
                  ].join(' ')}
                >
                  <span className="font-mono-code text-xs text-[#FFE8A3] truncate">
                    {item.cmd}
                  </span>
                  <span className="text-[11px] text-[#9AA8C7] truncate shrink-0 max-w-[48%]">
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
            <span className="text-[#5CE1B8] font-bold">gitdots</span>
            <span className="text-[#6BCBFF]">({sim.headBranch})</span>
            <span className="text-[#FFD166] font-bold">$</span>
          </label>

          {/* Input with subtle inline ghost suggestion */}
          <div className="relative flex-1 min-w-0">
            {ghostSuffix && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center font-mono-code text-xs sm:text-[13px] whitespace-pre overflow-hidden"
              >
                <span className="invisible">{input}</span>
                <span className="text-[#5C6A8A]">{ghostSuffix}</span>
              </div>
            )}
            <input
              id="gitdots-terminal-input"
              ref={inputRef}
              data-testid="terminal-input"
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
              className="relative w-full bg-transparent text-[#FFF8EB] placeholder:text-[#546180] font-mono-code text-xs sm:text-[13px] py-1 focus:outline-none"
            />
          </div>

          {/* Crisp Warm Yellow Execute Button */}
          <button
            type="submit"
            className="pixel-btn shrink-0 px-3 py-1.5 rounded-md bg-[#FFD166] hover:bg-[#FFDD87] text-[#131722] border-[#C99B32] font-pixel text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <span>실행</span>
            <CornerDownLeft className="w-3.5 h-3.5 shrink-0" />
          </button>
        </form>
      </div>
    </section>
  );
}
