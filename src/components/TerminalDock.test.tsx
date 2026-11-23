import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TerminalDock } from './TerminalDock';

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
});
