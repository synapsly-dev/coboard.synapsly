import { describe, expect, it } from 'vitest';
import { renderMiniappScss, renderWebCss } from './render.js';

describe('design token renderers', () => {
  it('emits the same semantic colors for both themes on Web', () => {
    const css = renderWebCss();
    expect(css.match(/--background:/g)).toHaveLength(2);
    expect(css).toContain('--duration-base: 150ms;');
    expect(css).toContain('--radius: 0.625rem;');
  });

  it('emits Mini Program variables and runtime theme mixins', () => {
    const scss = renderMiniappScss();
    expect(scss).toContain('@mixin coboard-theme-light');
    expect(scss).toContain('@mixin coboard-theme-dark');
    expect(scss).toContain('$space-md: 12px;');
  });
});
