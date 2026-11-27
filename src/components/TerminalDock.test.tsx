import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TerminalDock,
  defaultTerminalOpen,
  examplePlaceholder,
  resolveTabCompletion,
  shouldFocusTerminalOnExpand,
  shouldShowTabHint,
} from './TerminalDock';

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
    expect(html).toContain('Esc를 누른 뒤 Tab을 누르면 실행 버튼으로 이동해요.');
    expect(html).toContain('Shift+Tab은 이전 항목으로 이동해요.');
  });
});

describe('terminal default open and Tab hint policy', () => {
  it('starts expanded on desktop and collapsed on narrow or coarse-pointer screens', () => {
    expect(defaultTerminalOpen(1366, false)).toBe(true);
    expect(defaultTerminalOpen(640, false)).toBe(true);
    expect(defaultTerminalOpen(390, false)).toBe(false);
    expect(defaultTerminalOpen(320, true)).toBe(false);
    expect(defaultTerminalOpen(844, true)).toBe(false);
  });

  it('omits the Tab hint on narrow or touch devices', () => {
    expect(shouldShowTabHint(false, 1366)).toBe(true);
    expect(shouldShowTabHint(false, 640)).toBe(true);
    expect(shouldShowTabHint(false, 390)).toBe(false);
    expect(shouldShowTabHint(true, 1024)).toBe(false);
  });
});

describe('terminal example placeholder', () => {
  it('prefixes the next command with a short hint and keeps the command pure', () => {
    expect(examplePlaceholder('git add .')).toBe('예: git add . (Tab 완성)');
    expect(examplePlaceholder('git add .', false)).toBe('예: git add .');
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
