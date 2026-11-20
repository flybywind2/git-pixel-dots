import { useMemo } from 'react';
import { FileText, GitCompareArrows } from 'lucide-react';
import {
  diffDocumentLines,
  DOCUMENT_COMPARISONS,
  DOCUMENT_LIMIT,
  DOCUMENT_PATH,
  EXAMPLE_DOCUMENT,
  getDocumentComparison,
  getDocumentWorkingText,
} from '../engine/documentDiff';
import { usePixelStore } from '../store/usePixelStore';
import type { DocumentComparison } from '../types/sim';

const COMPARISON_MODES: DocumentComparison[] = ['working', 'staged', 'commits'];
const DIFF_STYLES = {
  unchanged: { prefix: ' ', description: '그대로인 줄', color: 'bg-[#FFFDF8] text-[#584938]' },
  removed: { prefix: '−', description: '빠진 줄', color: 'bg-[#FDE9E8] text-[#8C2630]' },
  added: { prefix: '+', description: '들어간 줄', color: 'bg-[#E0F4E9] text-[#155C40]' },
} as const;

export function DocumentLab() {
  const sim = usePixelStore((s) => s.sim);
  const draft = usePixelStore((s) => s.documentDraft);
  const setDraft = usePixelStore((s) => s.setDocumentDraft);
  const saveDocument = usePixelStore((s) => s.saveDocument);
  const runCommand = usePixelStore((s) => s.runCommand);
  const working = getDocumentWorkingText(sim);
  const text = draft ?? working;
  const unsaved = text !== working;
  const mode = sim.document?.comparison ?? 'working';
  const view = DOCUMENT_COMPARISONS[mode];
  const comparison = getDocumentComparison(sim, mode);
  const before = comparison?.before;
  const after = comparison?.after;
  const lines = useMemo(
    () => before === undefined || after === undefined ? [] : diffDocumentLines(before, after),
    [before, after],
  );
  const additions = lines.filter((line) => line.kind === 'added').length;
  const removals = lines.filter((line) => line.kind === 'removed').length;

  const staged = sim.staged.includes(DOCUMENT_PATH);
  let fileStatus = staged ? '다음 커밋에 담김' : '최근 커밋과 같음';
  if (working !== sim.document?.index) {
    fileStatus = staged ? '스테이징한 뒤 추가로 수정됨' : '작업 문서에 저장됨';
  }
  if (unsaved) fileStatus = '저장할 수정이 있어요';

  return (
    <div className="dot-bg flex flex-1 bg-[#F6EFE2]">
      <div className="mx-auto grid w-full max-w-[1440px] min-w-0 items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-2">
        <form
          className="min-w-0 overflow-hidden rounded-xl border border-[#CDBCA3] bg-[#FFFDF8]"
          onSubmit={(event) => { event.preventDefault(); if (unsaved) saveDocument(); }}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DFD1BA] bg-[#F6EDDB] px-4 py-3">
            <label htmlFor="practice-document-editor" className="flex items-center gap-2 font-semibold">
              <FileText aria-hidden="true" className="h-4 w-4 text-[#886237]" />
              <code className="font-mono-code text-sm">{DOCUMENT_PATH}</code>
            </label>
            <span role="status" id="document-file-status" className="text-xs font-medium text-[#705638]">{fileStatus}</span>
          </header>
          <textarea
            id="practice-document-editor"
            aria-describedby="document-file-status"
            spellCheck={false}
            maxLength={DOCUMENT_LIMIT}
            value={text}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono-code block min-h-56 w-full resize-y bg-[#FFFDF8] px-4 py-4 text-sm leading-7 text-[#2F241D] focus:outline-2 focus:-outline-offset-2 focus:outline-[#80613B]"
          />
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#DFD1BA] px-4 py-3">
            <button
              type="button"
              onClick={() => setDraft(EXAMPLE_DOCUMENT)}
              className="min-h-9 rounded-md border border-[#CDBCA3] bg-[#FAF4E8] px-3 py-1.5 text-sm font-semibold hover:bg-[#F0E5CF]"
            >
              예시 수정 넣기
            </button>
            <button
              type="submit"
              disabled={!unsaved}
              className="min-h-9 rounded-md border border-[#B68223] bg-[#F4B942] px-3 py-1.5 text-sm font-bold hover:bg-[#F7C55D] disabled:border-[#DDD0BB] disabled:bg-[#EEE5D5] disabled:text-[#746453]"
            >
              문서 저장
            </button>
          </footer>
        </form>

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
                  aria-pressed={item === mode}
                  onClick={() => runCommand(DOCUMENT_COMPARISONS[item].command)}
                  className="min-h-9 rounded-md border border-[#CDBCA3] bg-[#FFFDF8] px-3 text-xs font-semibold text-[#59483B] hover:border-[#987855] aria-pressed:border-[#4D8C6E] aria-pressed:bg-[#E2F3E8] aria-pressed:text-[#145439]"
                >
                  {DOCUMENT_COMPARISONS[item].label}
                </button>
              ))}
            </div>
          </header>
          <div className="border-b border-[#E9DFCE] px-4 py-3">
            <p className="text-sm font-semibold">{view.before} <span aria-hidden="true">→</span><span className="sr-only">에서 </span> {view.after}</p>
            <code className="font-mono-code break-words text-xs text-[#705638]">{view.command}</code>
          </div>
          <div role="status" className="px-4 py-2.5 text-sm text-[#59483B]">
            {!comparison
              ? '문서를 커밋하면 이전 기록과 비교할 수 있어요.'
              : lines.length === 0
                ? view.empty
                : <><span className="font-semibold text-[#8C2630]">− 빠진 줄 {removals}개</span><span className="mx-2" aria-hidden="true">·</span><span className="font-semibold text-[#155C40]">+ 들어간 줄 {additions}개</span></>}
          </div>
          {lines.length > 0 && (
            <ul tabIndex={0} aria-label="README.md 변경 내용" className="font-mono-code max-h-72 overflow-auto rounded-b-xl border-t border-[#E9DFCE] text-xs leading-6 sm:text-sm">
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
