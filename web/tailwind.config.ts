import type { Config } from 'tailwindcss';

/**
 * Tailwind config (§3). A clean, neutral, slate-based design token palette driven
 * by CSS variables (defined in src/index.css). Semantic tokens (background, fg,
 * border, primary, muted, …) keep components themeable and consistent.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'PingFang SC',
          'Microsoft YaHei',
          'Segoe UI',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Keep the centering translate(-50%, -50%) in BOTH frames — the dialog is
        // centered via that transform, so animating a bare translate/scale would
        // override it and make the modal fly in from the center's corner.
        'content-in': {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        // For Radix-positioned popovers (dropdown / select / tooltip): the element
        // is placed by Radix's own transform, so we must NOT translate here (a
        // translate would shift it off its anchor and make it jump). Fade + a tiny
        // scale only.
        'popover-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'overlay-in': 'overlay-in 150ms ease-out',
        'content-in': 'content-in 150ms ease-out',
        'popover-in': 'popover-in 120ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-out-right': 'slide-out-right 200ms ease-in',
        spin: 'spin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
