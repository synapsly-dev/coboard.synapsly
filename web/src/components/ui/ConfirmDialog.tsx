import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog';

/**
 * App-wide confirmation dialog, replacing the native `window.confirm` (§4). A
 * promise-based hook keeps call sites ergonomic — `if (await confirm({…})) …` —
 * while rendering our themed Radix dialog (focus trap, escape, scroll lock, a11y)
 * instead of the browser's blocking, unstyled box.
 */
export interface ConfirmOptions {
  /** Bold heading; defaults to 确认操作. */
  title?: ReactNode;
  /** Body copy explaining what will happen. */
  description?: ReactNode;
  /** Confirm button label; defaults to 确定. */
  confirmText?: string;
  /** Cancel button label; defaults to 取消. */
  cancelText?: string;
  /**
   * Style the confirm button as destructive (red). Defaults to true — nearly every
   * confirm in the app guards a delete; pass false for benign/reversible actions.
   */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mount once near the app root. Holds the single active request + its resolver so
 * any descendant can `await useConfirm()(…)`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A new request while one is pending resolves the stale one as cancelled so its
    // awaiter never hangs (the modal makes this practically unreachable).
    resolverRef.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const open = options !== null;
  const destructive = options?.destructive ?? true;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
        <DialogContent className="sm:max-w-md" hideClose>
          <DialogHeader>
            <DialogTitle>{options?.title ?? '确认操作'}</DialogTitle>
            {options?.description != null && (
              <DialogDescription>{options.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {options?.cancelText ?? '取消'}
            </Button>
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'primary'}
              onClick={() => settle(true)}
            >
              {options?.confirmText ?? '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns the confirm function. `await confirm({ description })` resolves true when
 * the user confirms, false on cancel / escape / overlay-dismiss. Must be used inside
 * {@link ConfirmProvider}.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用');
  }
  return ctx;
}
