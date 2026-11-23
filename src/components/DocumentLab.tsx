import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, GitCompareArrows } from 'lucide-react';
import {
  diffDocumentLines,
  DOCUMENT_COMPARISONS,
  DOCUMENT_LIMIT,
  DOCUMENT_PATH,
  getDocumentComparison,
  getDocumentComparisonLabels,
  getDocumentWorkingText,
} from '../engine/documentDiff';
import { usePixelStore } from '../store/usePixelStore';
import type { DocumentComparison } from '../types/sim';
import { treeEntry } from '../engine/repoVersions';
import { SPEAKER_THEMES } from '../pixel/palette';

const COMPARISON_MODES: DocumentComparison[] = ['working', 'staged', 'commits'];
const DIFF_STYLES = {
  unchanged: { prefix: ' ', description: '그대로인 줄', color: 'bg-[#FFFDF8] text-[#584938]' },
  removed: { prefix: '−', description: '빠진 줄', color: 'bg-[#FDE9E8] text-[#8C2630]' },
  added: { prefix: '+', description: '들어간 줄', color: 'bg-[#E0F4E9] text-[#155C40]' },
} as const;

export function DocumentLab() {
  const notice = usePixelStore((state) => state.notice);
  const sim = usePixelStore((s) => s.sim);
  const draft = usePixelStore((s) => s.documentDraft);
  const setDraft = usePixelStore((s) => s.setDocumentDraft);
  const loadExample = usePixelStore((s) => s.loadExampleDocument);
  const saveDocument = usePixelStore((s) => s.saveDocument);
  const runCommand = usePixelStore((s) => s.runCommand);
  const [pendingCompare, setPendingCompare] = useState<DocumentComparison | null>(null);
  const conflict = sim.conflict;
  const working = getDocumentWorkingText(sim);
  const text = draft ?? working;
  const unsaved = text !== working;
  useEffect(() => {
    if (!unsaved) setPendingCompare(null);
  }, [unsaved]);
  const mode = sim.document?.comparison ?? 'working';
  const view = DOCUMENT_COMPARISONS[mode];
  // 비교 탭이 실제로 읽는 사본을 패널과 터미널에서 같은 이름으로 보여 줘요.
  const { before: beforeLabel } = getDocumentComparisonLabels(sim, mode);
  const comparison = getDocumentComparison(sim, mode);
  const tabRefs = useRef<Partial<Record<DocumentComparison, HTMLButtonElement | null>>>({});
  const focusTabAfterCompare = useRef<DocumentComparison | null>(null);
  const focusAfterAction = useRef(false);
  const bubbleRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = focusTabAfterCompare.current;
    if (!target || unsaved) return;
    focusTabAfterCompare.current = null;
    tabRefs.current[target]?.focus();
  }, [unsaved, mode]);
  useEffect(() => {
    if (!focusAfterAction.current) return;
    focusAfterAction.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    const guided = document.querySelector<HTMLButtonElement>('[data-testid="guided-command"]');
    (guided && !guided.disabled ? guided : bubbleRef.current)?.focus({ preventScroll: true });
  }, [sim.lastAnim.seq]);
  const before = comparison?.before;
  const after = comparison?.after;
  const lines = useMemo(
    () => before === undefined || after === undefined ? [] : diffDocumentLines(before, after),
    [before, after],
  );
  const additions = lines.filter((line) => line.kind === 'added').length;
  const removals = lines.filter((line) => line.kind === 'removed').length;

  const staged = sim.staged.includes(DOCUMENT_PATH);
  const workingDiffersFromIndex = working !== treeEntry(sim.index, DOCUMENT_PATH);
  const showEmptyHelpers = Boolean(comparison) && lines.length === 0 && (workingDiffersFromIndex || unsaved);
  let fileStatus = staged ? '장바구니에 담김' : '최근 커밋과 같음';
  if (working !== treeEntry(sim.index, DOCUMENT_PATH)) {
    fileStatus = staged ? '장바구니에 담은 뒤 추가 수정됨' : '작업 문서에 저장됨';
  }
  if (unsaved) fileStatus = '저장할 수정이 있어요';

  function handleSelectComparison(item: DocumentComparison) {
    if (unsaved) {
      setPendingCompare(item);
      return;
    }
    setPendingCompare(null);
    focusTabAfterCompare.current = item;
    runCommand(DOCUMENT_COMPARISONS[item].command);
  }

  function handleSaveAndCompare() {
    const target = pendingCompare ?? mode;
    // 배너 버튼이 사라져 포커스가 body로 튀지 않도록, 저장이 끝난 뒤 비교를 실행한 탭 버튼으로 옮겨요.
    focusTabAfterCompare.current = target;
    saveDocument();
    runCommand(DOCUMENT_COMPARISONS[target].command);
    setPendingCompare(null);
  }

  function showWorkingComparison() {
    if (unsaved) {
      setPendingCompare('working');
      return;
    }
    setPendingCompare(null);
    focusTabAfterCompare.current = 'working';
    runCommand(DOCUMENT_COMPARISONS.working.command);
  }

  function addToNextCommit() {
    focusAfterAction.current = true;
    if (unsaved) saveDocument();
    runCommand(`git add ${DOCUMENT_PATH}`);
  }

  function runBubbleOrCardAction(command: string) {
    focusAfterAction.current = true;
    runCommand(command);
  }

  // 충돌 안내 영역이 이미 제공하는 버튼은 말풍선에서 중복해서 보여 주지 않아요.
  const conflictCommands = new Set(conflict?.revert ? ['resolve ours', 'resolve theirs', 'git revert --continue', 'git revert --abort'] : []);
  const bubbleActions = (sim.bubbles[0]?.actions ?? []).filter((act) => !conflictCommands.has(act.command));

  return (
    <div className="dot-bg flex flex-1 bg-[#F6EFE2]">
      <div className="mx-auto grid w-full max-w-[1440px] min-w-0 items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-2">
        {sim.bubbles.length > 0 && (
          <section
            ref={bubbleRef}
            tabIndex={-1}
            aria-live="polite"
            data-testid="speech-bubble"
            style={{ borderColor: SPEAKER_THEMES[sim.bubbles[0].speaker].border }}
            className="rounded-xl border bg-[#FFFDF8] px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80613B] lg:col-span-2"
          >
            <div className="flex items-center gap-2">
              <span
                style={{
                  backgroundColor: SPEAKER_THEMES[sim.bubbles[0].speaker].badgeBg,
                  color: SPEAKER_THEMES[sim.bubbles[0].speaker].badgeText,
                  borderColor: SPEAKER_THEMES[sim.bubbles[0].speaker].border,
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-pixel text-xs"
              >
                <span style={{ backgroundColor: SPEAKER_THEMES[sim.bubbles[0].speaker].dot }} className="h-1.5 w-1.5 shrink-0 rounded-[1px]" />
                {sim.bubbles[0].speakerName}
              </span>
              <h2 className="min-w-0 break-keep text-sm font-bold text-[#2F241D] [overflow-wrap:anywhere]">{sim.bubbles[0].title}</h2>
            </div>
            <p className="mt-1 break-keep text-sm leading-relaxed text-[#4E3E33] [overflow-wrap:anywhere]">{sim.bubbles[0].message}</p>
            {sim.bubbles[0].nextHint && <p className="mt-1 break-words text-xs leading-relaxed text-[#79521D] [overflow-wrap:anywhere]">{sim.bubbles[0].nextHint}</p>}
            {bubbleActions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {bubbleActions.map((act) => (
                  <button key={`${act.label}-${act.command}`} type="button" onClick={() => runBubbleOrCardAction(act.command)}
                    className="pixel-btn cursor-pointer rounded-md border border-[#CDBCA3] bg-[#FAF4E8] px-2.5 py-1 text-xs font-semibold hover:bg-[#F0E5CF]">
                    {act.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {conflict?.revert && (
          <section aria-labelledby="document-conflict-title" className="rounded-xl border border-[#D69B61] bg-[#FFF2D7] p-4 lg:col-span-2">
            <h2 id="document-conflict-title" className="font-bold">커밋 취소 중 변경이 겹쳤어요</h2>
            <p className="mt-1 text-sm">남길 내용을 고르거나, 편집기에서 충돌 표시를 정리한 뒤 저장하고 스테이징하세요.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(conflict.resolvedChoice === 'none' ? [
                ['현재 버전 유지', 'resolve ours'], ['이전 버전 사용', 'resolve theirs'],
              ] : [['취소 커밋 기록하기', 'git revert --continue']]).map(([label, command]) => (
                <button key={command} type="button" onClick={() => runBubbleOrCardAction(command)}
                  className="rounded-md border border-[#BF8B29] bg-[#F4B942] px-3 py-1.5 text-sm font-semibold">
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => runBubbleOrCardAction('git revert --abort')}
                className="rounded-md border border-[#CDBCA3] bg-[#FFFDF8] px-3 py-1.5 text-sm font-semibold">
                취소 작업 중단
              </button>
            </div>
          </section>
        )}
        <form
          className="min-w-0 overflow-hidden rounded-xl border border-[#CDBCA3] bg-[#FFFDF8]"
          onSubmit={(event) => { event.preventDefault(); if (unsaved) saveDocument(); }}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DFD1BA] bg-[#F6EDDB] px-4 py-3">
            <label htmlFor="practice-document-editor" className="flex items-center gap-2 font-semibold">
              <FileText aria-hidden="true" className="h-4 w-4 text-[#886237]" />
              <code className="font-mono-code text-sm">{DOCUMENT_PATH}</code>
            </label>
            <span id="document-file-status" className="text-xs font-medium text-[#705638]">{fileStatus}</span>
          </header>
          {sim.stashes.length > 0 && (
            <div data-testid="document-stash-banner" className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3D5BE] bg-[#F8F3FD] px-4 py-2 text-xs text-[#5B3E9E]">
              <span className="font-semibold">임시 보관함: {sim.stashes.length}개</span>
              <button
                type="button"
                onClick={() => runBubbleOrCardAction('git stash pop')}
                className="rounded-md border border-[#B69AD9] bg-[#FFFDF8] px-2.5 py-1 text-xs font-semibold text-[#5B3E9E] hover:bg-[#EFE6FA]"
              >
                꺼내기
              </button>
            </div>
          )}
          <textarea
            id="practice-document-editor"
            aria-describedby="document-file-status"
            spellCheck={false}
            maxLength={DOCUMENT_LIMIT}
            value={text}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono-code block min-h-56 w-full resize-y bg-[#FFFDF8] px-4 py-4 text-base leading-7 text-[#2F241D] focus:outline-2 focus:-outline-offset-2 focus:outline-[#80613B] sm:pointer-fine:text-sm"
          />
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#DFD1BA] px-4 py-3">
            <button
              type="button"
              onClick={loadExample}
              className="min-h-9 rounded-md border border-[#CDBCA3] bg-[#FAF4E8] px-3 py-1.5 text-sm font-semibold hover:bg-[#F0E5CF]"
            >
              예시 수정 넣기
            </button>
            <button
              type="submit"
              disabled={!unsaved}
              className="min-h-9 rounded-md border border-[#B68223] bg-[#F4B942] px-3 py-1.5 text-sm font-bold hover:bg-[#F7C55D] disabled:border-[#DDD0BB] disabled:bg-[#EEE5D5] disabled:text-[#746453]"
            >
              문서 저장하기
            </button>
          </footer>
        </form>

        {notice?.startsWith('다른 탭에서') && <p role="status" className="rounded-md border border-[#DDBE8A] bg-[#FFF2D7] p-2 text-sm text-[#73450E]">{notice}</p>}
        <section
          id="document-comparison"
          tabIndex={-1}
          aria-labelledby="document-comparison-title"
          className="min-w-0 rounded-xl border border-[#CDBCA3] bg-[#FFFDF8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80613B]"
        >
          <header className="rounded-t-xl border-b border-[#DFD1BA] bg-[#F6EDDB] px-4 py-3">
            <h2 id="document-comparison-title" className="flex items-center gap-2 text-sm font-bold">
              <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-[#196446]" />
              변경 비교
            </h2>
            <div role="group" aria-label="비교 기준" className="mt-3 flex flex-wrap gap-1.5">
              {COMPARISON_MODES.map((item) => (
                <button
                  type="button"
                  key={item}
                  ref={(node) => { tabRefs.current[item] = node; }}
                  aria-pressed={item === mode}
                  onClick={() => handleSelectComparison(item)}
                  className="min-h-9 rounded-md border border-[#CDBCA3] bg-[#FFFDF8] px-3 text-xs font-semibold text-[#59483B] hover:border-[#987855] aria-pressed:border-[#4D8C6E] aria-pressed:bg-[#E2F3E8] aria-pressed:text-[#145439]"
                >
                  {DOCUMENT_COMPARISONS[item].label}
                </button>
              ))}
            </div>
          </header>
          {unsaved && pendingCompare !== null && (
            <div
              role="status"
              data-testid="unsaved-compare-banner"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDBE8A] bg-[#FFF2D7] px-4 py-2.5 text-xs text-[#73450E]"
            >
              <p className="break-keep font-semibold">
                ‘{DOCUMENT_COMPARISONS[pendingCompare].label}’ 탭은 {DOCUMENT_COMPARISONS[pendingCompare].reads}를 읽어 비교해요.
                편집 중인 내용을 먼저 저장해야 해요.
              </p>
              <button
                type="button"
                onClick={handleSaveAndCompare}
                className="pixel-btn shrink-0 rounded-md border-[#C78B1E] bg-[#F4B942] px-2.5 py-1 text-xs font-bold text-[#362711] hover:bg-[#F7C55D]"
              >
                지금 저장하고 비교하기
              </button>
            </div>
          )}
          <div className="border-b border-[#E9DFCE] px-4 py-3">
            <p className="text-sm font-semibold">{beforeLabel} 기준으로 {view.after} 비교</p>
            <code className="font-mono-code break-words text-xs text-[#705638]">{view.command}</code>
          </div>
          <div className="px-4 py-2.5 text-sm text-[#59483B]">
            <p className="font-semibold text-[#715A43]">‘{view.label}’ 비교 기준: {beforeLabel} → {view.after}</p>
            <p className="mt-0.5">
              {!comparison
                ? '문서를 커밋하면 이전 기록과 비교할 수 있어요.'
                : lines.length === 0
                  ? mode === 'working' && staged
                    ? '작업 문서와 장바구니 내용이 같아요. 방금 담은 변경은 ‘담아 둔 변경’ 탭에서 확인할 수 있어요.'
                    : view.empty
                  : <><span className="font-semibold text-[#8C2630]">− 빠진 줄 {removals}개</span><span className="mx-2" aria-hidden="true">·</span><span className="font-semibold text-[#155C40]">+ 들어간 줄 {additions}개</span></>}
            </p>
            {comparison && lines.length === 0 && mode === 'working' && staged && (
              <div className="mt-2">
                <button type="button" onClick={() => handleSelectComparison('staged')}
                  className="min-h-8 rounded-md border border-[#4D8C6E] bg-[#E2F3E8] px-2.5 text-xs font-semibold text-[#145439] hover:bg-[#D2EEDD]">
                  담아 둔 변경 탭으로 이동
                </button>
              </div>
            )}
            {showEmptyHelpers && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={showWorkingComparison}
                  className="min-h-8 rounded-md border border-[#CDBCA3] bg-[#FAF4E8] px-2.5 text-xs font-semibold hover:bg-[#F0E5CF]">
                  바뀐 줄 보기
                </button>
                <button type="button" onClick={addToNextCommit}
                  className="min-h-8 rounded-md border border-[#B68223] bg-[#F4B942] px-2.5 text-xs font-bold hover:bg-[#F7C55D]">
                  다음 기록에 담기
                </button>
                <span className="break-keep text-xs text-[#715A43]">
                  {staged
                    ? '장바구니에 담긴 변경은 ‘담아 둔 변경’ 탭에서 확인해요.'
                    : '바뀐 줄을 확인한 뒤 다음 기록에 담아 보세요.'}
                </span>
              </div>
            )}
            {comparison && lines.length === 0 && !showEmptyHelpers && mode === 'working' && !staged && (
              <p className="mt-2 break-keep text-xs text-[#715A43]">먼저 편집기에서 회의록을 고쳐 보세요. 저장하면 바뀐 줄이 여기에 보여요.</p>
            )}
          </div>
          {lines.length > 0 && (
            <ul tabIndex={0} aria-label={`${DOCUMENT_PATH} 변경 내용`} className="font-mono-code max-h-72 overflow-auto rounded-b-xl border-t border-[#E9DFCE] text-xs leading-6 sm:text-sm">
              {lines.map((line) => {
                const style = DIFF_STYLES[line.kind];
                return (
                  <li key={`${line.beforeLine ?? ''}:${line.afterLine ?? ''}`} className={`grid grid-cols-[2.1rem_2.1rem_1.15rem_minmax(0,1fr)] ${style.color}`}>
                    <span aria-hidden="true" className="px-1 text-right text-xs opacity-75">{line.beforeLine}</span>
                    <span aria-hidden="true" className="px-1 text-right text-xs opacity-75">{line.afterLine}</span>
                    <span aria-hidden="true" className="text-center font-bold">{style.prefix}</span>
                    <span className="whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]">
                      <span className="sr-only">{style.description} </span>
                      {line.text}
                      {line.noFinalNewline && <span className="ml-2 text-xs italic opacity-75">(문서 끝에 줄바꿈 없음)</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
