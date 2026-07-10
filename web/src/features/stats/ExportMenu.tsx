import { Download, FileSpreadsheet, ListChecks } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { useIsAnyTrackManager } from '../../api/tracks';

/**
 * 导出 dropdown for the stats page header (P3 §2, 运营需求 §11). Two CSV downloads
 * (成员分数表 / 任务明细) served by the export routes with `content-disposition:
 * attachment`, so a plain `window.open` downloads without any fetch plumbing. The
 * links carry the page's CURRENT time-range bounds; 全部时间 omits both params.
 * Shown only to global admins / 赛道经理 (client heuristic — the server enforces
 * the real permission and scopes 赛道经理 exports to their tracks).
 */

/** CSV export files exposed by the server (routes/export.ts). */
export type ExportCsv = 'scores' | 'tasks';

/** Build the export URL, omitting unset bounds (exported for tests). */
export function csvExportUrl(
  file: ExportCsv,
  { from, to }: { from?: string | undefined; to?: string | undefined },
): string {
  const search = new URLSearchParams();
  if (from) search.set('from', from);
  if (to) search.set('to', to);
  const qs = search.toString();
  return `/api/export/${file}.csv${qs ? `?${qs}` : ''}`;
}

export interface ExportMenuProps {
  /** ISO lower bound from the page's resolved filters; undefined = unbounded. */
  from: string | undefined;
  /** ISO upper bound from the page's resolved filters; undefined = unbounded. */
  to: string | undefined;
}

export function ExportMenu({ from, to }: ExportMenuProps): JSX.Element | null {
  const { isAdmin } = useAuth();
  const isTrackManager = useIsAnyTrackManager();
  if (!isAdmin && !isTrackManager) return null;

  const download = (file: ExportCsv): void => {
    window.open(csvExportUrl(file, { from, to }), '_blank');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="md" className="shrink-0">
          <Download className="h-4 w-4" aria-hidden />
          导出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => download('scores')}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          成员分数表（CSV）
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download('tasks')}>
          <ListChecks className="h-4 w-4" aria-hidden />
          任务明细（CSV）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
