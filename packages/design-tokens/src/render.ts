import {
  colorTokens,
  durationTokens,
  easingTokens,
  fontTokens,
  radiusTokens,
  spacingTokens,
  type ThemeName,
} from './tokens.js';

const banner = '/* Generated from packages/design-tokens/src/tokens.ts. Do not edit. */';

function cssDeclarations(theme: ThemeName, indent: string): string {
  return Object.entries(colorTokens[theme])
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');
}

export function renderWebCss(): string {
  return `${banner}
@layer base {
  :root {
    color-scheme: light;
${cssDeclarations('light', '    ')}
    --radius: ${radiusTokens.lg / 16}rem;
    --radius-md: ${radiusTokens.md / 16}rem;
    --radius-sm: ${radiusTokens.sm / 16}rem;
    --radius-pill: ${radiusTokens.pill}px;
    --ease-standard: ${easingTokens.standard};
    --ease-emphasized: ${easingTokens.emphasized};
${Object.entries(durationTokens)
  .map(([name, value]) => `    --duration-${name}: ${value}ms;`)
  .join('\n')}
${Object.entries(spacingTokens)
  .map(([name, value]) => `    --space-${name}: ${value / 16}rem;`)
  .join('\n')}
    --font-sans: ${fontTokens.sans.join(', ')};
  }

  :root[data-theme='dark'],
  .dark {
    color-scheme: dark;
${cssDeclarations('dark', '    ')}
  }
}
`;
}

function scssTheme(theme: ThemeName): string {
  return Object.entries(colorTokens[theme])
    .map(([name, value]) => `  --${name}: hsl(${value.replaceAll(' ', ', ')});`)
    .join('\n');
}

export function renderMiniappScss(): string {
  const variables = [
    ...Object.entries(radiusTokens).map(([name, value]) => `$radius-${name}: ${value}px;`),
    ...Object.entries(spacingTokens).map(([name, value]) => `$space-${name}: ${value}px;`),
    ...Object.entries(durationTokens).map(([name, value]) => `$duration-${name}: ${value}ms;`),
    ...Object.entries(easingTokens).map(([name, value]) => `$ease-${name}: ${value};`),
  ].join('\n');

  return `${banner}
${variables}
$font-sans: ${fontTokens.sans.map((font) => (font.includes(' ') ? `'${font}'` : font)).join(', ')};

@mixin coboard-theme-light {
${scssTheme('light')}
}

@mixin coboard-theme-dark {
${scssTheme('dark')}
}

page {
  @include coboard-theme-light;
  color: var(--foreground);
  background: var(--background);
  font-family: $font-sans;
}

.theme-dark {
  @include coboard-theme-dark;
}
`;
}
