import { useCallback, useRef, useState } from 'react';

/**
 * Hover-to-open + click-to-pin behaviour for a Radix menu/popover that is
 * otherwise click-only (e.g. the project switcher, the user/avatar menu).
 *
 * - **Hover** the trigger → the menu opens as a *transient preview* that closes
 *   shortly after the pointer leaves both the trigger and the menu.
 * - **Click** the trigger → the menu is *pinned* open and STAYS open: clicking the
 *   trigger never closes it. It closes only on Escape, an outside click, or when an
 *   item is chosen.
 *
 * Wire-up:
 *   const menu = useHoverMenu();
 *   <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange} modal={false}>
 *     <DropdownMenuTrigger asChild {...menu.triggerProps}>
 *       <button> … </button>
 *     </DropdownMenuTrigger>
 *     <DropdownMenuContent {...menu.contentProps}> … </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * Design: rather than fight Radix's built-in trigger toggle (which is merged onto
 * the asChild button by Slot and is awkward to suppress), this hook works *with*
 * it. Radix's toggle drives `onOpenChange`; the hook interprets each change using
 * a "did a trigger pointer-down cause this?" flag:
 *   - open  → pin (a real click/keyboard open).
 *   - close caused by a trigger click (preview OR pinned) → keep it pinned open.
 *   - close from Escape / outside-click / item-select → really close.
 * `triggerProps` MUST go on `DropdownMenuTrigger` so its `onPointerDown` runs
 * before Radix's toggle (and thus sets the flag in time).
 *
 * `modal={false}` is REQUIRED: a modal Radix menu scroll-locks the page and traps
 * focus while open, which is hostile to a menu that opens merely on hover.
 */
export function useHoverMenu(closeDelay = 150) {
  const [open, setOpen] = useState(false);
  // Hover only makes sense on a fine pointer that can actually hover. On touch
  // there is no hover, and synthesized mouseenter/leave on tap make the menu feel
  // like it needs a second tap — so we wire the hover handlers only when the
  // device genuinely supports hover, leaving plain tap-to-open on touch.
  const [canHover] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
      : true,
  );
  // Refs (not state) so the pointer/focus event handlers always read the live
  // value without depending on the render closure.
  const openRef = useRef(false);
  const pinnedRef = useRef(false);
  // True for the brief window in which a pointer-down on the trigger is driving
  // the current `onOpenChange` — lets us tell a trigger click apart from Escape /
  // outside-click / item-select.
  const triggerDownRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpenState = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelClose();
    pinnedRef.current = false;
    setOpenState(false);
  }, [cancelClose, setOpenState]);

  const pin = useCallback(() => {
    cancelClose();
    pinnedRef.current = true;
    setOpenState(true);
  }, [cancelClose, setOpenState]);

  // The single funnel for every Radix-initiated open/close.
  const onOpenChange = useCallback(
    (next: boolean) => {
      cancelClose();
      if (next) {
        // Radix opened via a real click or keyboard → pin.
        pin();
        return;
      }
      if (triggerDownRef.current) {
        // The close was driven by a click on the trigger itself — keep it open
        // (pinned). Clicking the avatar / project switcher must NEVER close it
        // (whether it was a hover preview or already pinned); only Escape, an
        // outside click, or choosing an item closes it.
        pin();
        return;
      }
      // Genuine close: Escape, an outside click, or an item selection.
      close();
    },
    [cancelClose, pin, close],
  );

  // Pointer entered the trigger → open as a transient (un-pinned) preview.
  const openOnHover = useCallback(() => {
    cancelClose();
    setOpenState(true);
  }, [cancelClose, setOpenState]);

  // Pointer left the trigger or the menu → close after a short grace period so
  // the pointer can cross the small gap between trigger and menu. Pinned menus
  // ignore pointer-leave entirely.
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (pinnedRef.current) return;
    closeTimer.current = setTimeout(() => setOpenState(false), closeDelay);
  }, [cancelClose, closeDelay, setOpenState]);

  // Flag that the close `onOpenChange(false)` about to fire was driven by a click
  // on the trigger itself — so we keep the menu pinned open instead of closing it.
  //
  // On a mouse, Radix's trigger toggle AND the dismissable-layer fire synchronously
  // during this pointer-down, so the flag is read immediately. On TOUCH, however,
  // react-dismissable-layer DEFERS its dismiss to the trailing `click` event (not
  // the pointer-down). If we cleared the flag on the next macrotask it would be
  // gone by the time that deferred click runs, and a tap on an open trigger would
  // wrongly close the menu (leaving the trigger stuck in its dark hover state).
  // So hold the flag until just after the trailing click's dismiss handler runs;
  // a fallback timer releases it if no click follows (e.g. pointercancel).
  const onTriggerPointerDown = useCallback(() => {
    triggerDownRef.current = true;
    if (typeof document === 'undefined') {
      setTimeout(() => {
        triggerDownRef.current = false;
      }, 0);
      return;
    }
    let fallback: ReturnType<typeof setTimeout>;
    // Capture phase so this always runs before the layer's bubble-phase dismiss;
    // the setTimeout then clears the flag only after that dismiss has been read.
    const onClick = (): void => {
      document.removeEventListener('click', onClick, true);
      clearTimeout(fallback);
      setTimeout(() => {
        triggerDownRef.current = false;
      }, 0);
    };
    document.addEventListener('click', onClick, true);
    fallback = setTimeout(() => {
      document.removeEventListener('click', onClick, true);
      triggerDownRef.current = false;
    }, 500);
  }, []);

  // Don't steal focus for a mere hover preview (would yank focus / scroll on
  // hover); allow it once pinned so keyboard users can navigate into the menu.
  const onContentOpenAutoFocus = useCallback((event: Event) => {
    if (!pinnedRef.current) event.preventDefault();
  }, []);

  return {
    open,
    onOpenChange,
    triggerProps: {
      onPointerDown: onTriggerPointerDown,
      onMouseEnter: canHover ? openOnHover : undefined,
      onMouseLeave: canHover ? scheduleClose : undefined,
    },
    contentProps: {
      onMouseEnter: canHover ? cancelClose : undefined,
      onMouseLeave: canHover ? scheduleClose : undefined,
      onOpenAutoFocus: onContentOpenAutoFocus,
    },
  };
}
