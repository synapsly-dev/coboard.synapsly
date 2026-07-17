import { Picker, Text, View } from '@tarojs/components';
import type { Label, ProjectMemberWithUser } from 'shared';

export const FILTER_ALL = '__all__';
export const FILTER_ME = '__me__';
export const LABEL_FILTER_ALL = '__all__';

export function BoardFilters({ assignee, label, members, labels, currentUserId, showMembers, onAssigneeChange, onLabelChange }: {
  assignee: string;
  label: string;
  members: ProjectMemberWithUser[];
  labels: Label[];
  currentUserId?: string;
  showMembers: boolean;
  onAssigneeChange: (value: string) => void;
  onLabelChange: (value: string) => void;
}): JSX.Element {
  const memberOptions = [{ value: FILTER_ALL, label: '全部成员' }, ...members.map((member) => ({ value: member.userId, label: `${member.user.displayName}${member.userId === currentUserId ? '（我）' : ''}` }))];
  const labelOptions = [{ value: LABEL_FILTER_ALL, label: '全部标签' }, ...labels.map((item) => ({ value: item.id, label: item.name }))];
  const memberIndex = Math.max(0, memberOptions.findIndex((item) => item.value === assignee));
  const labelIndex = Math.max(0, labelOptions.findIndex((item) => item.value === label));
  return <View className="board-filters">
    <View className={`board-filter ${assignee === FILTER_ME ? 'board-filter--active' : ''}`} onClick={() => onAssigneeChange(assignee === FILTER_ME ? FILTER_ALL : FILTER_ME)}><Text>◎</Text><Text>我的任务</Text></View>
    {showMembers && <Picker mode="selector" range={memberOptions.map((item) => item.label)} value={memberIndex} onChange={(event) => onAssigneeChange(memberOptions[Number(event.detail.value)]?.value ?? FILTER_ALL)}><View className={`board-filter ${assignee !== FILTER_ALL && assignee !== FILTER_ME ? 'board-filter--active' : ''}`}><Text>▽</Text><Text>{memberOptions[memberIndex]?.label}</Text></View></Picker>}
    {labels.length > 0 && <Picker mode="selector" range={labelOptions.map((item) => item.label)} value={labelIndex} onChange={(event) => onLabelChange(labelOptions[Number(event.detail.value)]?.value ?? LABEL_FILTER_ALL)}><View className={`board-filter ${label !== LABEL_FILTER_ALL ? 'board-filter--active' : ''}`}><Text>◇</Text><Text>{labelOptions[labelIndex]?.label}</Text></View></Picker>}
  </View>;
}
