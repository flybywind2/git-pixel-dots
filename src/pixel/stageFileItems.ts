import type { PixelFileStatus, PixelSimState, StageId } from '../types/sim';
import { changedPaths, headTree, treeEntry } from '../engine/repoVersions';

export type StageFileBadge = PixelFileStatus | 'stashed' | 'extra-edit' | 'deleted';

export interface StageFileItem {
  id: string;
  name: string;
  badges: StageFileBadge[];
  /** 작업 폴더(working)에 있는 최신 내용. 없으면 삭제된 상태예요. */
  workingContent?: string;
  /** 장바구니(index)에 담아 둔 사본. 작업 파일과 다를 때만 채워요. */
  stagedContent?: string;
  /** 임시 보관(stash) 항목이면 어느 보관 번호인지와 세 사본을 함께 담아요. */
  stash?: {
    label: string;
    base?: string;
    index?: string;
    working?: string;
  };
}

function stashLabel(total: number, index: number): string {
  return `stash@{${total - 1 - index}}`;
}

/**
 * 2~4장 파일 카드에 보여 줄 항목을 만들어요.
 * 스테이징 사본(index)과 작업 파일(working)을 따로 담고,
 * 여러 건의 임시 보관(stash)은 보관 번호별로 모두 펼쳐 보여 줘요.
 */
export function buildStageFileItems(sim: PixelSimState, stageId: StageId): StageFileItem[] {
  const items: StageFileItem[] = sim.files.map((file) => {
    const stagedContent = treeEntry(sim.index, file.name);
    const badges: StageFileBadge[] = sim.staged.includes(file.name) && file.status !== 'staged'
      ? ['staged', file.status]
      : [file.status];
    if (stagedContent !== undefined && stagedContent !== file.content) {
      badges.push('extra-edit');
    }
    return {
      id: `file:${file.name}`,
      name: file.name,
      badges,
      workingContent: file.content,
      stagedContent: stagedContent !== undefined && stagedContent !== file.content ? stagedContent : undefined,
    };
  });

  if (stageId !== 'ch2') return items;

  // 스테이징된 삭제처럼 작업 폴더에 없지만 장바구니에 남은 항목도 카드에 보여 줘요.
  for (const name of sim.staged) {
    if (items.some((item) => item.name === name)) continue;
    const stagedContent = treeEntry(sim.index, name);
    items.push({
      id: `index:${name}`,
      name,
      badges: ['staged', 'deleted'],
      stagedContent,
    });
  }

  const head = headTree(sim);
  sim.stashes.forEach((stash, index) => {
    const label = stashLabel(sim.stashes.length, index);
    const paths = [...new Set([
      ...Object.keys(stash.base),
      ...Object.keys(stash.index),
      ...Object.keys(stash.working),
      ...changedPaths(head, stash.working),
    ])];
    for (const name of paths) {
      const base = treeEntry(stash.base, name);
      const indexContent = treeEntry(stash.index, name);
      const working = treeEntry(stash.working, name);
      if (base === indexContent && base === working) continue;
      const badges: StageFileBadge[] = ['stashed'];
      if (working === undefined) badges.push('deleted');
      items.push({
        id: `stash:${index}:${name}`,
        name,
        badges,
        stash: { label, base, index: indexContent, working },
      });
    }
  });
  return items;
}