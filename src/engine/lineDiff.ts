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
