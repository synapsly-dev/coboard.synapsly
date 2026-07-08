import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Theme provider — light / dark / follow-system. Persists the choice in
 * localStorage and reflects the resolved theme onto <html> as both
 * `data-theme="dark"` and the `.dark` class, matching the CSS-var overrides in
 * index.css. An inline script in index.html applies the same before first paint
 * to avoid a flash; this provider keeps it in sync and reactive.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'coboard-theme';

interface ThemeContextValue {
  /** The user's preference (may be 'system'). */
  theme: ThemePreference;
  /** The concrete theme currently applied. */
  resolved: Resolved;
  setTheme: (theme: ThemePreference) => void;
  /** Flip between light and dark (drops 'system'). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>(readPreference);
  const [sysDark, setSysDark] = useState<boolean>(systemPrefersDark);

  // Track OS-level changes so 'system' stays live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: Resolved = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;

  // Cross-fade the canvas only when the change came from a deliberate user
  // toggle — never on first paint or a silent OS theme change.
  const userToggledRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    if (userToggledRef.current) {
      userToggledRef.current = false;
      el.classList.add('theme-transition');
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      // Remove just after --duration-base so the transition never lingers.
      fadeTimerRef.current = setTimeout(() => {
        el.classList.remove('theme-transition');
        fadeTimerRef.current = null;
      }, 260);
    }
    el.dataset.theme = resolved;
    el.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  useEffect(
    () => () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    },
    [],
  );

  const setTheme = useCallback((next: ThemePreference): void => {
    userToggledRef.current = true;
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback((): void => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内部使用');
  return ctx;
}
