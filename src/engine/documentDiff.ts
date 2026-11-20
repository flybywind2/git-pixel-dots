import type { DocumentComparison, PixelSimState } from '../types/sim';
import { commitById, headCommit, treeEntry } from './repoVersions';

export { diffDocumentLines } from './lineDiff';

export const DOCUMENT_PATH = '회의록.md';
export const DOCUMENT_SAVE_LABEL = '회의록.md 저장';
export const DOCUMENT_LIMIT = 4000;
export const ORIGINAL_DOCUMENT = '# 스터디 회의록\n\n다음 모임은 금요일 저녁 7시예요.\n장소는 1층 회의실이에요.\n';
export const EXAMPLE_DOCUMENT = '# 스터디 회의록\n\n다음 모임은 토요일 오전 10시예요.\n장소는 1층 회의실이에요.\n참석 여부는 목요일까지 알려 주세요.\n';

export const DOCUMENT_COMPARISONS = {
  working: {
    label: '작업 중',
    command: 'git diff -- 회의록.md',
    before: '스테이징 영역',
    after: '저장한 작업 문서',
    empty: '작업 문서와 스테이징 영역의 내용이 같아요.',
    action: 'DOCUMENT_WORKING_DIFF',
  },
  staged: {
    label: '스테이징',
    command: 'git diff --staged -- 회의록.md',
    before: '최근 커밋',
    after: '스테이징 영역',
    empty: '다음 커밋에 들어갈 문서 변경이 없어요.',
    action: 'DOCUMENT_STAGED_DIFF',
  },
  commits: {
    label: '커밋 이력',
    command: 'git diff HEAD~1 HEAD -- 회의록.md',
    before: '이전 커밋 (HEAD~1)',
    after: '최근 커밋 (HEAD)',
    empty: '두 커밋의 문서 내용이 같아요.',
    action: 'DOCUMENT_COMMIT_DIFF',
  },
} as const;

export function getDocumentWorkingText(state: PixelSimState): string {
  return state.files.find((file) => file.name === DOCUMENT_PATH)?.content ?? '';
}

export function getDocumentComparison(state: PixelSimState, mode: DocumentComparison) {
  const head = headCommit(state);
  if (!state.document || !head) return null;
  if (mode === 'working') {
    const staged = treeEntry(state.index, DOCUMENT_PATH);
    return { before: staged ?? '', after: staged === undefined ? '' : getDocumentWorkingText(state) };
  }
  if (mode === 'staged') {
    return { before: treeEntry(head.tree, DOCUMENT_PATH) ?? '', after: treeEntry(state.index, DOCUMENT_PATH) ?? '' };
  }
  const previous = commitById(state, head.parents[0]);
  return previous ? { before: treeEntry(previous.tree, DOCUMENT_PATH) ?? '', after: treeEntry(head.tree, DOCUMENT_PATH) ?? '' } : null;
}
