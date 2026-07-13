import { useState } from 'react';
import { Orbit, TreeDeciduous } from 'lucide-react';
import type { OrgNode, OrgNodeKind } from 'shared';
import { Button, Tooltip } from '../../../components/ui';
import type { OrgTreeNode } from '../tree';
import { OrgChartCanvas } from './OrgChartCanvas';
import { OrgPlanetCanvas } from './OrgPlanetCanvas';

/**
 * 图谱 mode switcher: 星系 (planet/orbital, the default) vs 树形 (tidy-tree).
 * The role-oriented chart is a separate top-level view on OrgPage rather than a
 * mode inside this original chart surface.
 */
export type OrgChartMode = 'galaxy' | 'tree';

const MODE_STORAGE_KEY = 'coboard-org-chart-mode';

function loadMode(): OrgChartMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === 'tree' ? 'tree' : 'galaxy';
  } catch {
    return 'galaxy';
  }
}

interface OrgChartViewProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}

export function OrgChartView(props: OrgChartViewProps): JSX.Element {
  const [mode, setMode] = useState<OrgChartMode>(loadMode);

  const toggleMode = (): void =>
    setMode((previous) => {
      const next: OrgChartMode = previous === 'galaxy' ? 'tree' : 'galaxy';
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        // Non-persistent mode selection is fine when storage is unavailable.
      }
      return next;
    });

  const label = mode === 'galaxy' ? '切换到树形视图' : '切换到星系视图';
  const toggle = (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 sm:h-8 sm:w-8"
        aria-label={label}
        onClick={(event) => {
          event.currentTarget.blur();
          toggleMode();
        }}
      >
        {mode === 'galaxy' ? <TreeDeciduous className="h-4 w-4" /> : <Orbit className="h-4 w-4" />}
      </Button>
    </Tooltip>
  );

  return mode === 'galaxy' ? (
    <OrgPlanetCanvas {...props} modeToggle={toggle} />
  ) : (
    <OrgChartCanvas {...props} modeToggle={toggle} />
  );
}
