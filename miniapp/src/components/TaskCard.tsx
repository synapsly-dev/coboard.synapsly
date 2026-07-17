import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { PRIORITY_META, TASK_STATUS_META, TASK_TYPE_META, type Task } from 'shared';
import { Avatar, Badge } from './ui';
import './task-card.scss';

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dueState(task: Task): { text: string; tone: string } | null {
  if (!task.dueDate) return null;
  const due = new Date(`${task.dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return null;
  if (task.status === 'done' && task.completedAt) return new Date(task.completedAt) <= due ? { text: '按期完成', tone: 'success' } : { text: '逾期完成', tone: 'danger' };
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: '已逾期', tone: 'danger' };
  if (days <= 2) return { text: '即将到期', tone: 'warning' };
  return null;
}

export function TaskCard({
  task,
  action,
  showStatus = true,
  showProject = false,
}: {
  task: Task;
  action?: React.ReactNode;
  showStatus?: boolean;
  showProject?: boolean;
}): JSX.Element {
  const priority = PRIORITY_META[task.priority];
  const labels = task.labels.slice(0, 3);
  const extraLabels = task.labels.length - labels.length;
  const stageDate = task.status === 'done'
    ? task.completedAt
    : task.status === 'pending_review'
      ? task.deliveredAt
      : task.createdAt;
  const stagePrefix = task.status === 'done' ? '完成' : task.status === 'pending_review' ? '提交' : '发布';
  const deadline = dueState(task);

  return (
    <View
      className="task-card"
      onClick={() => Taro.navigateTo({ url: `/pages/task/index?id=${task.id}` })}
    >
      <View className="task-card__badges">
        <View className="task-card__badge-group">
          {showProject && <Badge>{task.projectName ?? '任务池'}</Badge>}
          {task.taskType && <Badge tone={TASK_TYPE_META[task.taskType].colorRole === 'danger' ? 'danger' : TASK_TYPE_META[task.taskType].colorRole === 'warning' ? 'warning' : 'primary'}>{TASK_TYPE_META[task.taskType].code} 类</Badge>}
          <Badge tone={priority.colorRole === 'danger' ? 'danger' : priority.colorRole === 'warning' ? 'warning' : priority.colorRole === 'primary' ? 'primary' : 'neutral'}>
            <Text className={`priority-dot priority-dot--${task.priority}`} />
            {priority.label}
          </Badge>
          {showStatus && <Badge>{TASK_STATUS_META[task.status].label}</Badge>}
          {task.status === 'done' && task.qualityGrade && <Badge tone={task.qualityGrade === 'a' ? 'success' : task.qualityGrade === 'd' ? 'danger' : 'warning'}>质量 {task.qualityGrade.toUpperCase()}</Badge>}
        </View>
        {task.points != null && <Badge tone="primary">{task.points} 点</Badge>}
      </View>

      <Text className="task-card__title">{task.title}</Text>

      {task.labels.length > 0 && (
        <View className="task-card__labels">
          {labels.map((label) => (
            <Text key={label.id} className="task-card__label" style={{ borderColor: label.color, color: label.color }}>
              {label.name}
            </Text>
          ))}
          {extraLabels > 0 && <Text className="task-card__label task-card__label--more">+{extraLabels}</Text>}
        </View>
      )}

      <View className="task-card__footer">
        <View className="task-card__meta">
          <Text>◷ {stagePrefix} {dateTime(stageDate ?? task.createdAt)}</Text>
          {task.dueDate && <Text className={`task-card__due ${deadline ? `task-card__due--${deadline.tone}` : ''}`}>DDL {shortDate(task.dueDate)}{deadline ? ` · ${deadline.text}` : ''}</Text>}
          <Text className={task.claimants.length < task.minClaimants ? 'task-card__claim-limit--low' : ''}>{task.claimants.length}/{task.maxClaimants ?? '∞'} 人{task.claimants.length < task.minClaimants ? ` · 至少 ${task.minClaimants}` : ''}</Text>
        </View>
        {task.claimants.length > 0 && (
          <View className="task-card__claimants">
            {task.claimants.slice(0, 3).map((person) => (
              <Avatar key={person.userId} name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} size="small" />
            ))}
            {task.claimants.length > 3 && <Text className="task-card__claimant-more">+{task.claimants.length - 3}</Text>}
          </View>
        )}
      </View>

      {action && (
        <View className="task-card__action" onClick={(event) => event.stopPropagation()}>
          {action}
        </View>
      )}
    </View>
  );
}

export function SmallAction({ children, onClick, loading }: { children: React.ReactNode; onClick: () => void; loading?: boolean }): JSX.Element {
  return <Button className="small-action" size="mini" loading={loading} onClick={onClick}>{children}</Button>;
}
