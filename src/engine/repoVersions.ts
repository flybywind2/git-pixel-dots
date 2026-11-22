import type { FileTree, PixelCommit, PixelSimState } from '../types/sim';
import { diffDocumentLines } from './lineDiff';

export function treeEntry(tree: FileTree, path: string): string | undefined {
  return Object.hasOwn(tree, path) ? tree[path] : undefined;
}

export function workingTree(state: Pick<PixelSimState, 'files'>): FileTree {
  return Object.fromEntries(state.files.map(({ name, content }) => [name, content]));
}

export function commitById(state: PixelSimState, id: string | undefined): PixelCommit | undefined {
  return state.commits.find((commit) => commit.id === id);
}

export function headCommit(state: PixelSimState): PixelCommit | undefined {
  return commitById(state, state.branches[state.headBranch]);
}

export function headTree(state: PixelSimState): FileTree {
  return headCommit(state)?.tree ?? {};
}

function pathsIn(...trees: FileTree[]): string[] {
  return [...new Set(trees.flatMap((tree) => Object.keys(tree)))];
}

export function changedPaths(before: FileTree, after: FileTree): string[] {
  return pathsIn(before, after).filter((path) => treeEntry(before, path) !== treeEntry(after, path));
}

export function updateWorkspace(state: PixelSimState, working: FileTree, index: FileTree): PixelSimState {
  const staged = changedPaths(headTree(state), index);
  const files = Object.entries(working).map(([name, content]) => {
    const saved = treeEntry(index, name);
    const status = state.conflict?.file === name && state.conflict.resolvedChoice === 'none'
      ? 'conflict'
      : saved === undefined
        ? 'untracked'
        : saved !== content
          ? 'modified'
          : staged.includes(name) ? 'staged' : 'committed';
    return { name, content, status } as const;
  });
  return { ...state, files, staged, index };
}

export function trackedChanges(state: PixelSimState): string[] {
  const working = workingTree(state);
  return [...new Set([
    ...changedPaths(headTree(state), state.index),
    ...Object.keys(state.index).filter((path) => treeEntry(working, path) !== state.index[path]),
  ])];
}

export function writeTreeEntry(tree: Record<string, string>, path: string, value: string | undefined): void {
  if (value === undefined) delete tree[path];
  else Object.defineProperty(tree, path, { value, enumerable: true, configurable: true, writable: true });
}

function pathsCollide(first: string, second: string): boolean {
  return first === second || first.startsWith(second + '/') || second.startsWith(first + '/');
}

export function restoreWorktree(state: PixelSimState, target: FileTree): FileTree {
  const untracked = Object.entries(workingTree(state)).filter(([path]) =>
    treeEntry(state.index, path) === undefined &&
    treeEntry(headTree(state), path) === undefined &&
    !Object.keys(target).some((tracked) => pathsCollide(path, tracked)),
  );
  return { ...Object.fromEntries(untracked), ...target };
}

export function checkoutTree(state: PixelSimState, target: FileTree, current = headTree(state)) {
  const index = { ...state.index };
  const working = { ...workingTree(state) };
  const blocked: string[] = [];
  for (const path of changedPaths(current, target)) {
    const old = treeEntry(current, path);
    const next = treeEntry(target, path);
    const staged = treeEntry(index, path);
    if (staged === next) continue;
    const untrackedCollision = next !== undefined && Object.keys(working).some((name) =>
      treeEntry(index, name) === undefined && pathsCollide(path, name),
    );
    if (untrackedCollision || staged !== old || treeEntry(working, path) !== staged) {
      blocked.push(path);
      continue;
    }
    writeTreeEntry(index, path, next);
    writeTreeEntry(working, path, next);
  }
  return { working, index, blocked };
}

export function resolveRevision(state: PixelSimState, expression: string): PixelCommit | undefined {
  const base = expression.split(/[~^]/, 1)[0];
  if (!base) return undefined;
  const ref = base === 'HEAD' ? state.branches[state.headBranch]
    : base === 'ORIG_HEAD' ? state.origHead
      : base.startsWith('origin/') ? treeEntry(state.remoteBranches, base.slice(7))
        : treeEntry(state.branches, base);
  const matches = state.commits.filter((commit) => commit.hash.startsWith(base));
  let commit = ref ? commitById(state, ref) : matches.length === 1 ? matches[0] : undefined;
  let suffix = expression.slice(base.length);
  while (commit && suffix) {
    const token = /^([~^])(\d*)/.exec(suffix);
    if (!token) return undefined;
    const hops = token[2] === '' ? 1 : Number(token[2]);
    if (!Number.isSafeInteger(hops) || hops > state.commits.length) return undefined;
    if (token[1] === '^' && hops > 0) commit = commitById(state, commit.parents[hops - 1]);
    if (token[1] === '~') {
      for (let step = 0; step < hops && commit; step++) commit = commitById(state, commit.parents[0]);
    }
    suffix = suffix.slice(token[0].length);
  }
  return commit;
}

export function reachableCommits(state: PixelSimState, id: string | undefined): Set<string> {
  const todo = id ? [id] : [];
  const visited = new Set<string>();
  while (todo.length) {
    const commit = commitById(state, todo.pop());
    if (!commit || visited.has(commit.id)) continue;
    visited.add(commit.id);
    todo.push(...commit.parents);
  }
  return visited;
}

export type RemoteRelation = 'none' | 'synced' | 'ahead' | 'behind' | 'diverged';

/**
 * 로컬 브랜치와 원격 브랜치의 실제 커밋 부모 관계를 비교해요.
 * - ahead: 내 컴퓨터에만 있는 커밋이 있어요(공유 대기).
 * - behind: 원격에만 있는 커밋이 있어요(예: reset --soft로 내 브랜치만 뒤로 감김).
 * - diverged: 양쪽에 서로 다른 커밋이 있어요.
 */
export function remoteRelation(state: PixelSimState, branch = state.headBranch): RemoteRelation {
  const local = treeEntry(state.branches, branch);
  const remote = treeEntry(state.remoteBranches, branch);
  if (!remote) return 'none';
  if (!local) return 'behind';
  if (local === remote) return 'synced';
  const localHistory = reachableCommits(state, local);
  const remoteHistory = reachableCommits(state, remote);
  if (localHistory.has(remote)) return 'ahead';
  if (remoteHistory.has(local)) return 'behind';
  return 'diverged';
}

/** 원격 브랜치에서 도달 가능한 되돌림(revert) 커밋이 있는지 확인해요. */
export function remoteHasRevertCommit(state: PixelSimState, branch = state.headBranch): boolean {
  const remote = treeEntry(state.remoteBranches, branch);
  if (!remote) return false;
  const remoteHistory = reachableCommits(state, remote);
  return state.commits.some((commit) => commit.isRevert && remoteHistory.has(commit.id));
}

export function mergeBase(state: PixelSimState, first: string, second: string): PixelCommit | undefined {
  const firstHistory = reachableCommits(state, first);
  const secondHistory = reachableCommits(state, second);
  return [...state.commits].reverse().find((commit) =>
    firstHistory.has(commit.id) && secondHistory.has(commit.id),
  );
}

interface LineEdit {
  start: number;
  end: number;
  lines: string[];
}

function textEdits(base: string, updated: string): LineEdit[] {
  const edits: LineEdit[] = [];
  let line = 0;
  let current: LineEdit | undefined;
  for (const change of diffDocumentLines(base, updated)) {
    if (change.kind === 'unchanged') {
      line++;
      current = undefined;
      continue;
    }
    if (!current) {
      current = { start: line, end: line, lines: [] };
      edits.push(current);
    }
    if (change.kind === 'removed') current.end = ++line;
    else current.lines.push(change.text + (change.noFinalNewline ? '' : '\n'));
  }
  return edits;
}

function mergeText(base: string, ours: string, theirs: string): string | undefined {
  const first = textEdits(base, ours);
  const edits = [...first];
  for (const edit of textEdits(base, theirs)) {
    const overlap = first.find((other) =>
      other.start <= edit.end && edit.start <= other.end,
    );
    if (!overlap) edits.push(edit);
    else if (overlap.start !== edit.start || overlap.end !== edit.end || overlap.lines.join('') !== edit.lines.join('')) {
      return undefined;
    }
  }
  const lines = base.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return lines.join('');
}

export function mergeTrees(base: FileTree, ours: FileTree, theirs: FileTree) {
  const tree = { ...ours };
  const conflicts: string[] = [];
  for (const path of changedPaths(base, theirs)) {
    const original = treeEntry(base, path);
    const local = treeEntry(ours, path);
    const incoming = treeEntry(theirs, path);
    if (local === original || local === incoming) {
      writeTreeEntry(tree, path, incoming);
      continue;
    }
    const merged = original !== undefined && local !== undefined && incoming !== undefined
      ? mergeText(original, local, incoming)
      : undefined;
    if (merged === undefined) conflicts.push(path);
    else writeTreeEntry(tree, path, merged);
  }
  return { tree, conflicts };
}
