import type { ReactNode } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button, Tooltip } from '../../../components/ui';

/**
 * The floating bottom-right control cluster shared by both org chart canvases
 * (树形 tidy-tree and 星系 planet mode): zoom out / 100% / zoom in / fit, plus an
 * optional `extra` slot after a divider — the 星系↔树形 mode toggle lives there.
 */
export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  extra,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-md backdrop-blur">
      <Tooltip content="缩小">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:h-8 sm:w-8"
          aria-label="缩小"
          onClick={onZoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content="缩放至 100%">
        <button
          type="button"
          className="h-8 min-w-[3rem] rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground"
          aria-label="缩放至 100%"
          onClick={onReset}
        >
          {Math.round(scale * 100)}%
        </button>
      </Tooltip>
      <Tooltip content="放大">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:h-8 sm:w-8"
          aria-label="放大"
          onClick={onZoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </Tooltip>
      <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <Tooltip content="适应视图">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:h-8 sm:w-8"
          aria-label="适应视图"
          onClick={onFit}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </Tooltip>
      {extra != null && (
        <>
          <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          {extra}
        </>
      )}
    </div>
  );
}
