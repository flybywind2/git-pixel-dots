import type { DocumentComparison, PixelSimState } from '../types/sim';

export const DOCUMENT_PATH = 'README.md';
export const DOCUMENT_SAVE_LABEL = 'README.md 저장';
export const DOCUMENT_LIMIT = 4000;
export const ORIGINAL_DOCUMENT = '# 스터디 안내\n\n다음 모임은 금요일 저녁 7시예요.\n장소는 1층 회의실이에요.\n';
export const EXAMPLE_DOCUMENT = '# 스터디 안내\n\n다음 모임은 토요일 오전 10시예요.\n장소는 1층 회의실이에요.\n참석 여부는 목요일까지 알려 주세요.\n';

export const DOCUMENT_COMPARISONS = {
  working: {
    label: '작업 중',
    command: 'git diff -- README.md',
    before: '스테이징 영역',
    after: '저장한 작업 문서',
    empty: '작업 문서와 스테이징 영역의 내용이 같아요.',
    action: 'DOCUMENT_WORKING_DIFF',
  },
  staged: {
    label: '스테이징',
    command: 'git diff --staged -- README.md',
    before: '최근 커밋',
    after: '스테이징 영역',
    empty: '다음 커밋에 들어갈 문서 변경이 없어요.',
    action: 'DOCUMENT_STAGED_DIFF',
  },
  commits: {
    label: '커밋 이력',
    command: 'git diff HEAD~1 HEAD -- README.md',
    before: '이전 커밋 (HEAD~1)',
    after: '최근 커밋 (HEAD)',
    empty: '두 커밋의 문서 내용이 같아요.',
    action: 'DOCUMENT_COMMIT_DIFF',
  },
} as const;

function getDocumentHead(state: PixelSimState) {
  const id = state.branches[state.headBranch];
  return state.commits.find((commit) => commit.id === id);
}

export function getDocumentWorkingText(state: PixelSimState): string {
  return state.files.find((file) => file.name === DOCUMENT_PATH)?.content ?? '';
}

export function withDocumentVersions(state: PixelSimState, working: string, index: string): PixelSimState {
  if (!state.document) return state;
  const staged = index !== getDocumentHead(state)?.documentContent;
  const status = working !== index ? 'modified' : staged ? 'staged' : 'committed';
  return {
    ...state,
    document: { ...state.document, index },
    files: [{ name: DOCUMENT_PATH, content: working, status }],
    staged: staged ? [DOCUMENT_PATH] : [],
  };
}

export function getDocumentComparison(state: PixelSimState, mode: DocumentComparison) {
  const head = getDocumentHead(state);
  const committed = head?.documentContent;
  if (!state.document || committed === undefined) return null;

  const { index } = state.document;
  if (mode === 'working') return { before: index, after: getDocumentWorkingText(state) };
  if (mode === 'staged') return { before: committed, after: index };

  const previous = state.commits.find((commit) => commit.id === head?.parents[0])?.documentContent;
  return previous === undefined ? null : { before: previous, after: committed };
}

export interface DocumentDiffLine {
  kind: 'unchanged' | 'added' | 'removed';
  text: string;
  beforeLine?: number;
  afterLine?: number;
  noFinalNewline: boolean;
}

export function diffDocumentLines(before: string, after: string): DocumentDiffLine[] {
  if (before === after) return [];
  const oldLines = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const newLines = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  // Keep the longest shared subsequence of lines and report the rest as edits.
  const shared = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      shared[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? 1 + shared[oldIndex + 1][newIndex + 1]
        : Math.max(shared[oldIndex + 1][newIndex], shared[oldIndex][newIndex + 1]);
    }
  }

  const lines: DocumentDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    if (oldLine !== undefined && oldLine === newLine) {
      lines.push({ kind: 'unchanged', text: oldLine, beforeLine: ++oldIndex, afterLine: ++newIndex, noFinalNewline: false });
    } else if (oldLine !== undefined && (newLine === undefined || shared[oldIndex + 1][newIndex] >= shared[oldIndex][newIndex + 1])) {
      lines.push({ kind: 'removed', text: oldLine, beforeLine: ++oldIndex, noFinalNewline: !oldLine.endsWith('\n') });
    } else {
      lines.push({ kind: 'added', text: newLine, afterLine: ++newIndex, noFinalNewline: !newLine.endsWith('\n') });
    }
  }

  return lines.map((line) => ({ ...line, text: line.text.replace(/\n$/, '') }));
}
