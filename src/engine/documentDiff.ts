import type { DocumentComparison, PixelSimState } from '../types/sim';
import { commitById, headCommit, headTree, treeEntry } from './repoVersions';

export { diffDocumentLines } from './lineDiff';

export const DOCUMENT_PATH = '회의록.md';
export const DOCUMENT_SAVE_LABEL = '회의록.md 저장';
export const DOCUMENT_LIMIT = 4000;
export const ORIGINAL_DOCUMENT = '# 스터디 회의록\n\n다음 모임은 금요일 저녁 7시예요.\n장소는 1층 회의실이에요.\n';
export const EXAMPLE_DOCUMENT = '# 스터디 회의록\n\n다음 모임은 토요일 오전 10시예요.\n장소는 1층 회의실이에요.\n참석 여부는 목요일까지 알려 주세요.\n';
export const DOCUMENT_REVERT = { command: 'git revert HEAD', label: '마지막 변경 취소해 보기' } as const;

export const DOCUMENT_COMPARISONS = {
  working: {
    label: '바뀐 줄',
    command: 'git diff -- 회의록.md',
    before: '원래 초안',
    after: '지금 작업 문서',
    reads: '작업 파일',
    empty: '작업 문서와 스테이징 영역의 내용이 같아요.',
    action: 'DOCUMENT_WORKING_DIFF',
  },
  staged: {
    label: '담아 둔 변경',
    command: 'git diff --staged -- 회의록.md',
    before: '최근 커밋',
    after: '장바구니에 담은 변경',
    reads: '장바구니에 담아 둔 사본',
    empty: '다음 커밋에 들어갈 문서 변경이 없어요.',
    action: 'DOCUMENT_STAGED_DIFF',
  },
  commits: {
    label: '이전 기록',
    command: 'git diff HEAD~1 HEAD -- 회의록.md',
    before: '이전 커밋',
    after: '최근 커밋',
    reads: '커밋에 기록된 사본',
    empty: '두 커밋의 문서 내용이 같아요.',
    action: 'DOCUMENT_COMMIT_DIFF',
  },
} as const;

/**
 * 비교 탭이 실제로 읽는 사본을 패널과 터미널에서 같은 이름으로 보여 줘요.
 * 특히 add 직후처럼 최근 커밋과 장바구니가 같을 때도 '원래 초안'이라고
 * 잘못 부르지 않도록 index 사본 기준 이름을 계산해요.
 */
export function getDocumentComparisonLabels(state: PixelSimState, mode: DocumentComparison) {
  const view = DOCUMENT_COMPARISONS[mode];
  if (mode !== 'working') return { before: view.before, after: view.after };
  const staged = treeEntry(state.index, DOCUMENT_PATH);
  const head = treeEntry(headTree(state), DOCUMENT_PATH);
  const before = staged === undefined ? '장바구니(비어 있음)'
    : staged !== head ? '담아 둔 문서' : '최근 커밋의 문서';
  return { before, after: view.after };
}

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
