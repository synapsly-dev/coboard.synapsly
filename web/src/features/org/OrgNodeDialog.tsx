import { useEffect, useState } from 'react';
import type { OrgNode, OrgNodeKind, OrgScope } from 'shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useCreateOrgNode, useUpdateOrgNode } from '../../api/org';
import { ORG_KIND_LABELS, ORG_KIND_OPTIONS } from './labels';

/**
 * Create / edit an org node (团队架构). Collects a title, a kind (部门/小组/单元), and
 * an optional description. Create mode appends the node under `parentId` (null = a new
 * root) in `scope`; edit mode patches the given node. The server is the real validator
 * — this form only guards the obvious (non-empty title).
 */

interface CreateProps {
  mode: 'create';
  scope: OrgScope;
  /** Parent to append under; null creates a new root. */
  parentId: string | null;
}

interface EditProps {
  mode: 'edit';
  scope: OrgScope;
  node: OrgNode;
}

type OrgNodeDialogProps = (CreateProps | EditProps) & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OrgNodeDialog(props: OrgNodeDialogProps): JSX.Element {
  const { open, onOpenChange, mode, scope } = props;
  const editingNode = mode === 'edit' ? props.node : null;

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<OrgNodeKind>('group');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateOrgNode(scope);
  const updateMut = useUpdateOrgNode(scope);
  const pending = createMut.isPending || updateMut.isPending;

  // Reset the form to the node's values (edit) or blank defaults (create) each time
  // the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingNode) {
      setTitle(editingNode.title);
      setKind(editingNode.kind);
      setDescription(editingNode.description ?? '');
    } else {
      setTitle('');
      setKind(mode === 'create' && props.parentId ? 'group' : 'department');
      setDescription('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('名称不能为空');
      return;
    }
    setError(null);
    const desc = description.trim() ? description.trim() : null;
    try {
      if (editingNode) {
        await updateMut.mutateAsync({
          id: editingNode.id,
          input: { title: trimmed, kind, description: desc },
        });
      } else {
        await createMut.mutateAsync({
          scope,
          parentId: (props as CreateProps).parentId,
          kind,
          title: trimmed,
          description: desc,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '保存失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingNode ? '编辑节点' : '新增节点'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-node-title">名称</Label>
            <Input
              id="org-node-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="名称"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-node-kind">类型</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as OrgNodeKind)}>
              <SelectTrigger id="org-node-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORG_KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {ORG_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-node-desc">说明（可选）</Label>
            <Textarea
              id="org-node-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="备注"
              rows={3}
              maxLength={500}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editingNode ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
