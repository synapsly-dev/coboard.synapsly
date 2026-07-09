import type { Config } from 'tailwindcss';

/**
 * Tailwind config (§3). A clean, neutral, slate-based design token palette driven
 * by CSS variables (defined in src/index.css). Semantic tokens (background, fg,
 * border, primary, muted, …) keep components themeable and consistent.
 */
const config: Config = {
  // Theme is toggled by adding `.dark` to <html> (see src/lib/theme.tsx), so
  // `dark:` variants must key off that class, not the OS `prefers-color-scheme`.
  darkMode: 'class',
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
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        // A restrained entrance: fade while settling up a few px. Used for the
        // login/join column and other single-element reveals — one block, no
        // per-child stagger (which would read as over-designed).
        'enter-rise': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
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
        // Symmetric exit for the centered dialog — recede the way it arrived.
        // Keep the centering translate in both frames (see content-in note).
        'content-out': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
          to: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
        },
        // For Radix-positioned popovers (dropdown / select / tooltip): the element
        // is placed by Radix's own transform, so we must NOT translate here (a
        // translate would shift it off its anchor and make it jump). Fade + a tiny
        // scale only.
        'popover-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'popover-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.97)' },
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
        'fade-out': 'fade-out 120ms ease-in',
        'enter-rise': 'enter-rise 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        'overlay-in': 'overlay-in 150ms ease-out',
        'overlay-out': 'fade-out 120ms ease-in',
        'content-in': 'content-in 150ms ease-out',
        'content-out': 'content-out 120ms ease-in',
        'popover-in': 'popover-in 120ms ease-out',
        'popover-out': 'popover-out 100ms ease-in',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-out-right': 'slide-out-right 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        spin: 'spin 0.7s linear infinite',
      },
      // Shared motion scale — one easing family + a 3-step duration scale so
      // added transitions read as the same authored system rather than the
      // browser/Tailwind defaults. Values live as CSS vars in index.css.
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        emphasized: 'var(--ease-emphasized)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
    },
  },
  plugins: [],
};

export default config;
