/**
 * Canonical Coboard visual language. Values are platform-neutral; generators
 * produce Web CSS custom properties and Mini Program SCSS from this object.
 */
export const colorTokens = {
  light: {
    background: '60 11% 98%',
    foreground: '240 4% 5%',
    card: '0 0% 100%',
    'card-foreground': '240 4% 5%',
    popover: '0 0% 100%',
    'popover-foreground': '240 4% 5%',
    primary: '240 4% 5%',
    'primary-foreground': '60 11% 98%',
    secondary: '60 8% 95%',
    'secondary-foreground': '240 5% 16%',
    muted: '60 8% 95%',
    'muted-foreground': '240 2% 38%',
    accent: '60 5% 93%',
    'accent-foreground': '240 4% 5%',
    destructive: '6 63% 46%',
    'destructive-foreground': '0 0% 100%',
    success: '149 66% 30%',
    'success-foreground': '0 0% 100%',
    warning: '35 92% 33%',
    'warning-foreground': '0 0% 100%',
    border: '60 6% 90%',
    input: '60 4% 82%',
    ring: '240 4% 5%',
  },
  dark: {
    background: '240 4% 5%',
    foreground: '60 5% 96%',
    card: '240 5% 8%',
    'card-foreground': '60 5% 96%',
    popover: '240 5% 12%',
    'popover-foreground': '60 5% 96%',
    primary: '60 5% 96%',
    'primary-foreground': '240 4% 5%',
    secondary: '240 5% 12%',
    'secondary-foreground': '60 5% 96%',
    muted: '240 5% 12%',
    'muted-foreground': '240 3% 64%',
    accent: '240 5% 15%',
    'accent-foreground': '60 5% 96%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 100%',
    success: '142 69% 58%',
    'success-foreground': '240 4% 5%',
    warning: '35 92% 33%',
    'warning-foreground': '0 0% 100%',
    border: '240 5% 17%',
    input: '240 5% 24%',
    ring: '60 5% 96%',
  },
} as const;

export const radiusTokens = {
  lg: 10,
  md: 8,
  sm: 6,
  pill: 9999,
} as const;

export const spacingTokens = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export const durationTokens = {
  instant: 100,
  fast: 120,
  base: 150,
  medium: 200,
  emphasized: 220,
  slow: 240,
  spinner: 700,
} as const;

export const easingTokens = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  emphasized: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

export const fontTokens = {
  sans: [
    'Inter',
    'system-ui',
    '-apple-system',
    'PingFang SC',
    'Microsoft YaHei',
    'Segoe UI',
    'sans-serif',
  ],
} as const;

export const designTokens = {
  color: colorTokens,
  radius: radiusTokens,
  spacing: spacingTokens,
  duration: durationTokens,
  easing: easingTokens,
  font: fontTokens,
} as const;

export type ThemeName = keyof typeof colorTokens;
export type SemanticColor = keyof (typeof colorTokens)['light'];
