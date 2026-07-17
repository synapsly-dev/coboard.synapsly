import { MovableArea, MovableView, Text, View } from '@tarojs/components';
import { useMemo, useState } from 'react';
import type { OrgApplication, OrgNode, OrgNodeMember } from 'shared';
import { Avatar } from '../../components/ui';
import { MembershipControl } from './OrgMembership';
import {
  flattenOutline,
  flattenTree,
  flattenVisible,
  forestPeople,
  occupancyLabel,
  ORG_KIND_LABELS,
  subtreePeople,
  type OrgTreeNode,
} from './model';

export interface OrgViewProps {
  roots: OrgTreeNode[];
  nodes: OrgNode[];
  applications: OrgApplication[];
  userId?: string;
  editable: boolean;
  canManageMembers: (node: OrgNode) => boolean;
  onEdit: (node: OrgNode) => void;
  onAddChild: (node: OrgNode) => void;
  onManageMembers: (node: OrgNode) => void;
  onAddMembers: (node: OrgNode) => void;
  onOpenActions: (node: OrgNode) => void;
}

function Person({ person, lead = false }: { person: OrgNodeMember; lead?: boolean }): JSX.Element {
  return (
    <View className="org-person">
      <View className="org-person__avatar">
        <Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} />
        {lead && <Text className="org-person__crown">♛</Text>}
      </View>
      <Text className="org-person__name">{person.displayName}</Text>
    </View>
  );
}

function PeopleLine({ node, max = 6 }: { node: OrgNode; max?: number }): JSX.Element | null {
  const people = [...node.leads, ...node.members];
  if (people.length === 0) return null;
  return (
    <View className="org-people-line">
      {node.leads.slice(0, max).map((person) => <Person key={person.userId} person={person} lead />)}
      {node.members.slice(0, Math.max(0, max - node.leads.length)).map((person) => <Person key={person.userId} person={person} />)}
      {people.length > max && <Text className="org-people-line__more">+{people.length - max}</Text>}
    </View>
  );
}

function MoreIcon(): JSX.Element {
  return <View className="org-more-icon"><View /><View /><View /></View>;
}

function ChevronIcon({ collapsed }: { collapsed: boolean }): JSX.Element {
  return <View className={`org-chevron-icon ${collapsed ? 'is-right' : 'is-down'}`} />;
}

function resolvePath(roots: OrgTreeNode[], path: string[]): OrgTreeNode[] {
  const result: OrgTreeNode[] = [];
  let level = roots;
  for (const id of path) {
    const node = level.find((candidate) => candidate.id === id);
    if (!node) return [];
    result.push(node);
    level = node.children;
  }
  return result;
}

function directPeople(node: OrgTreeNode | undefined): Array<{ person: OrgNodeMember; lead: boolean }> {
  if (!node) return [];
  const seen = new Set<string>();
  const result: Array<{ person: OrgNodeMember; lead: boolean }> = [];
  node.leads.forEach((person) => {
    if (seen.has(person.userId)) return;
    seen.add(person.userId);
    result.push({ person, lead: true });
  });
  node.members.forEach((person) => {
    if (seen.has(person.userId)) return;
    seen.add(person.userId);
    result.push({ person, lead: false });
  });
  return result;
}

export function GalaxyView(props: OrgViewProps & { onModeToggle: () => void }): JSX.Element {
  const { roots, applications, userId, editable, canManageMembers, onEdit, onAddChild, onManageMembers, onAddMembers, onOpenActions, onModeToggle } = props;
  const [focusPath, setFocusPath] = useState<string[]>([]);
  const [zoom, setZoom] = useState(66);
  const chain = resolvePath(roots, focusPath);
  const focus = chain.at(-1);
  const planets = focus?.children ?? roots;
  const members = directPeople(focus);
  const totalPeople = forestPeople(roots);

  const enter = (node: OrgTreeNode): void => {
    if (focus) setFocusPath((current) => [...current, node.id]);
    else setFocusPath([node.id]);
  };
  const reset = (): void => {
    setFocusPath([]);
    setZoom(66);
  };

  return (
    <View className="org-galaxy">
      <MovableArea className="org-space" scaleArea>
        <View className="org-space__grid" />
        {chain.length > 0 && (
          <View className="org-space__crumbs">
            <Text onClick={() => setFocusPath([])}>团队</Text>
            {chain.map((node, index) => (
              <View className="org-space__crumb" key={node.id}>
                <Text className="org-space__crumb-separator">/</Text>
                <Text
                  className={index === chain.length - 1 ? 'is-current' : ''}
                  onClick={() => setFocusPath(focusPath.slice(0, index + 1))}
                >
                  {node.title}
                </Text>
              </View>
            ))}
          </View>
        )}

        <MovableView
          className="org-space__world"
          direction="all"
          scale
          scaleMin={0.5}
          scaleMax={1.35}
          scaleValue={zoom / 100}
          outOfBounds
          onScale={(event) => setZoom(Math.round(event.detail.scale * 100))}
        >
          <View className={`org-orbit ${focus ? 'is-focused' : ''}`} />
          <View className={`org-star ${focus ? `is-focus org-kind--${focus.kind}` : ''}`} onClick={() => focus && setFocusPath((current) => current.slice(0, -1))}>
            <Text className="org-star__title">{focus?.title ?? '团队'}</Text>
            <Text className="org-star__count">{focus ? subtreePeople(focus) : totalPeople} 人</Text>
          </View>

          {planets.map((node, index) => {
            const count = Math.max(planets.length, 1);
            const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
            const radius = focus ? 35 : count <= 4 ? 34 : 38;
            const left = 50 + Math.cos(angle) * radius;
            const top = 50 + Math.sin(angle) * (focus ? 34 : 35);
            const people = subtreePeople(node);
            const size = focus ? 60 : Math.min(56, 38 + people * 2);
            return (
              <View
                className={`org-galaxy__planet ${focus ? 'is-moon' : ''} org-kind--${node.kind}`}
                key={node.id}
                style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px` }}
                onClick={() => enter(node)}
              >
                <Text className="org-galaxy__planet-title">{node.title}</Text>
                <Text className="org-galaxy__planet-meta">{node.kind === 'position' ? occupancyLabel(node) : `${people} 人`}</Text>
                <View className="org-galaxy__planet-menu" onClick={(event) => { event.stopPropagation(); onOpenActions(node); }}><MoreIcon /></View>
                <View className="org-galaxy__membership" onClick={(event) => event.stopPropagation()}>
                  <MembershipControl node={node} userId={userId} applications={applications} canManage={canManageMembers(node)} compact />
                </View>
              </View>
            );
          })}

          {focus && members.map(({ person, lead }, index) => {
            const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(members.length, 1);
            const left = 50 + Math.cos(angle) * 20;
            const top = 50 + Math.sin(angle) * 19;
            return (
              <View className="org-galaxy__member" key={person.userId} style={{ left: `${left}%`, top: `${top}%` }} onClick={() => canManageMembers(focus) && onManageMembers(focus)}>
                <Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} />
                {lead && <Text className="org-galaxy__crown">♛</Text>}
                <Text className="org-galaxy__member-name">{person.displayName}</Text>
              </View>
            );
          })}

          {focus && (editable || canManageMembers(focus)) && (
            <View className="org-focus-actions">
              {editable && !focus.trackId && <Text onClick={() => onEdit(focus)}>编辑</Text>}
              {canManageMembers(focus) && <Text onClick={() => onAddMembers(focus)}>＋人</Text>}
              {canManageMembers(focus) && <Text onClick={() => onManageMembers(focus)}>成员</Text>}
              {editable && <Text onClick={() => onAddChild(focus)}>＋</Text>}
            </View>
          )}

          {focus && planets.length === 0 && members.length === 0 && <Text className="org-space__empty">暂无下级和成员</Text>}
        </MovableView>

        <Text className="org-space__hint">
          {focus ? '捏合缩放 · 点击中心返回上级' : '点击部门聚焦 · 双指滑动平移 · 捏合缩放'}
        </Text>
        <View className="org-space__controls">
          <View onClick={() => setZoom((value) => Math.max(50, value - 10))}><Text>−</Text></View>
          <View className="org-space__zoom" onClick={() => setZoom(100)}><Text>{zoom}%</Text></View>
          <View onClick={() => setZoom((value) => Math.min(135, value + 10))}><Text>＋</Text></View>
          <View onClick={reset}><Text>↗</Text></View>
          <View onClick={onModeToggle}><Text>☷</Text></View>
        </View>
      </MovableArea>
    </View>
  );
}

export function OutlineView(props: OrgViewProps & { onModeToggle: () => void }): JSX.Element {
  const { roots, applications, userId, editable, canManageMembers, onAddMembers, onOpenActions, onModeToggle } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flattenOutline(roots, collapsed), [roots, collapsed]);
  const branchIds = useMemo(
    () => flattenTree(roots).filter((node) => node.children.length > 0).map((node) => node.id),
    [roots],
  );
  const allCollapsed = branchIds.length > 0 && branchIds.every((id) => collapsed.has(id));
  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View className="org-outline">
      <View className="org-outline__toolbar">
        {branchIds.length > 0 && (
          <Text className="org-outline__toggle" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(branchIds))}>
            {allCollapsed ? '全部展开' : '全部收起'}
          </Text>
        )}
        <View className="org-outline__mode" onClick={onModeToggle}><Text>◎</Text></View>
      </View>
      <View className="org-outline__root"><Text className="org-outline__root-pill">团队</Text><Text>组织架构大纲</Text></View>
      <View className="org-outline__rows">
        {rows.map((row) => {
          const node = row.node;
          const hasChildren = node.children.length > 0;
          return (
            <View className="org-outline__row" key={node.id}>
              <View className="org-outline__guides">
                {row.ancestorLines.map((continues, index) => {
                  const branch = index === row.depth - 1;
                  return <View key={`${node.id}-${index}`} className={`org-outline__guide ${branch ? `is-elbow ${row.isLast ? 'is-last' : ''}` : continues ? 'is-line' : ''}`} />;
                })}
              </View>
              <View className={`org-outline__chevron ${hasChildren ? '' : 'is-empty'}`} onClick={() => hasChildren && toggle(node.id)}>
                {hasChildren && <ChevronIcon collapsed={collapsed.has(node.id)} />}
              </View>
              <View className="org-outline__content">
                <View className="org-outline__title-row">
                  <View className={`org-outline__accent org-kind-accent--${node.kind}`} />
                  <Text className={`org-outline__kind org-kind-badge--${node.kind}`}>{ORG_KIND_LABELS[node.kind]}</Text>
                  <Text className="org-outline__title">{node.title}</Text>
                  {node.kind === 'position' && <Text className="org-outline__occupancy">{occupancyLabel(node)}</Text>}
                  {collapsed.has(node.id) && hasChildren && <Text className="org-outline__child-count">（{node.children.length} 个下级）</Text>}
                </View>
                <PeopleLine node={node} />
              </View>
              <View className="org-outline__trailing">
                <MembershipControl node={node} userId={userId} applications={applications} canManage={canManageMembers(node)} compact />
                {canManageMembers(node) && <Text className="org-outline__quick" onClick={() => onAddMembers(node)}>＋人</Text>}
                {(editable || canManageMembers(node)) && <View className="org-outline__menu-trigger" onClick={() => onOpenActions(node)}><MoreIcon /></View>}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function ListView(props: OrgViewProps): JSX.Element {
  const { roots, applications, userId, editable, canManageMembers, onAddMembers, onOpenActions } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);
  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View className="org-list">
      {rows.map((node) => {
        const hasChildren = node.children.length > 0;
        return (
          <View className="org-list__row" key={node.id} style={{ marginLeft: `${Math.min(node.depth, 4) * 12}px` }}>
            <View className={`org-list__chevron ${hasChildren ? '' : 'is-empty'}`} onClick={() => hasChildren && toggle(node.id)}>
              {hasChildren && <ChevronIcon collapsed={collapsed.has(node.id)} />}
            </View>
            <View className="org-list__body">
              <View className="org-list__title-row">
                <Text className={`org-outline__kind org-kind-badge--${node.kind}`}>{ORG_KIND_LABELS[node.kind]}</Text>
                <Text className="org-list__title">{node.title}</Text>
                {node.kind === 'position' && <Text className="org-outline__occupancy">{occupancyLabel(node)}</Text>}
                {collapsed.has(node.id) && hasChildren && <Text className="org-outline__child-count">（{node.children.length} 个下级）</Text>}
              </View>
              {node.description && <Text className="org-list__description">{node.description}</Text>}
              <PeopleLine node={node} max={8} />
            </View>
            <View className="org-list__trailing">
              <MembershipControl node={node} userId={userId} applications={applications} canManage={canManageMembers(node)} compact />
              {canManageMembers(node) && <Text className="org-list__quick" onClick={() => onAddMembers(node)}>＋人</Text>}
              {(editable || canManageMembers(node)) && <View className="org-list__more" onClick={() => onOpenActions(node)}><MoreIcon /></View>}
            </View>
          </View>
        );
      })}
    </View>
  );
}
