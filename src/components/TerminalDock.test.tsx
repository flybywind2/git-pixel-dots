import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TerminalDock, examplePlaceholder, resolveTabCompletion, shouldFocusTerminalOnExpand } from './TerminalDock';

describe('TerminalDock initial state', () => {
  it('renders expanded in default size by default with collapse and tall-view controls', () => {
    const html = renderToStaticMarkup(<TerminalDock />);

    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('data-size="default"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('터미널 접기');
    expect(html).toContain('data-testid="terminal-size-toggle"');
    expect(html).toContain('크게 보기');
    expect(html).toContain('data-testid="terminal-input"');
    expect(html).not.toMatch(/id="terminal-content"[^>]*hidden/);
  });

  it('shows the next example command with a Tab hint in the empty input placeholder', () => {
    const html = renderToStaticMarkup(<TerminalDock />);

    expect(html).toContain('placeholder="예: edit 회의록.md (Tab 완성)"');
    expect(html).toContain('Tab으로 예시 명령을 채우고');
  });
});

describe('terminal example placeholder', () => {
  it('prefixes the next command with a short hint and keeps the command pure', () => {
    expect(examplePlaceholder('git add .')).toBe('예: git add . (Tab 완성)');
  });

  it('falls back to a plain prompt when no example command exists', () => {
    expect(examplePlaceholder(null)).toBe('명령어를 입력하세요');
    expect(examplePlaceholder(undefined)).toBe('명령어를 입력하세요');
  });
});

describe('terminal Tab completion', () => {
  it('fills the pure example command when the input is empty', () => {
    expect(resolveTabCompletion('', 'git add .', [])).toBe('git add .');
    expect(resolveTabCompletion('   ', 'git add .', [])).toBe('git add .');
  });

  it('does not intercept Tab when there is no example command', () => {
    expect(resolveTabCompletion('', null, [])).toBeNull();
    expect(resolveTabCompletion('', undefined, [])).toBeNull();
    expect(resolveTabCompletion('git', null, [])).toBeNull();
  });

  it('does not intercept Tab when the input already equals the example command', () => {
    expect(resolveTabCompletion('git add .', 'git add .', [])).toBeNull();
    expect(resolveTabCompletion('  git add .  ', 'git add .', [])).toBeNull();
  });

  it('completes the example command when the typed prefix has no suggestions', () => {
    expect(resolveTabCompletion('git', 'git add .', [])).toBe('git add .');
    expect(resolveTabCompletion('git a', 'git add .', [])).toBe('git add .');
  });

  it('leaves unrelated input alone so Tab can move focus', () => {
    expect(resolveTabCompletion('gh', 'git add .', [])).toBeNull();
  });

  it('keeps the existing suggestion cycling when candidates exist', () => {
    const suggestions = [{ cmd: 'git add .' }, { cmd: 'git add 회의록.md' }];
    expect(resolveTabCompletion('git', 'git add .', suggestions)).toBeNull();
    expect(resolveTabCompletion('git add .', 'git add .', [{ cmd: 'git add .' }])).toBeNull();
  });

  it('never intercepts Shift+Tab', () => {
    expect(resolveTabCompletion('', 'git add .', [], true)).toBeNull();
    expect(resolveTabCompletion('git', 'git add .', [], true)).toBeNull();
  });
});

describe('TerminalDock focus policy', () => {
  it('does not steal focus on initial load even though the dock starts open', () => {
    expect(shouldFocusTerminalOnExpand(true, true, true)).toBe(false);
  });

  it('focuses the input when the user reopens the dock with a fine pointer', () => {
    expect(shouldFocusTerminalOnExpand(true, false, true)).toBe(true);
  });

  it('keeps focus away from the input on touch-only devices and when collapsing', () => {
    expect(shouldFocusTerminalOnExpand(true, false, false)).toBe(false);
    expect(shouldFocusTerminalOnExpand(false, true, true)).toBe(false);
  });
});
