import { Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { useState } from 'react';
import { PRIORITY_META, TASK_TYPE_META, updateTaskInputSchema, type Label, type Priority, type Task, type TaskType, type UpdateTaskInput } from 'shared';
import { ActionButton, Card } from '../../components/ui';

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const TASK_TYPES: TaskType[] = ['critical', 'baseline', 'claimable', 'collab'];
const NO_TYPE = '__none__';

function EditField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return <View className="task-edit__field"><Text className="task-edit__label">{label}</Text>{children}{hint && <Text className="task-edit__hint">{hint}</Text>}</View>;
}

export function EditTaskForm({ task, labels, saving, onCancel, onSave }: { task: Task; labels: Label[]; saving: boolean; onCancel: () => void; onSave: (patch: UpdateTaskInput) => void }): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [deliverableSpec, setDeliverableSpec] = useState(task.deliverableSpec ?? '');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task.acceptanceCriteria ?? '');
  const [taskType, setTaskType] = useState<string>(task.taskType ?? NO_TYPE);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [points, setPoints] = useState(task.points == null ? '' : String(task.points));
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [dueReason, setDueReason] = useState('');
  const [minClaimants, setMinClaimants] = useState(String(task.minClaimants));
  const [maxClaimants, setMaxClaimants] = useState(task.maxClaimants == null ? '' : String(task.maxClaimants));
  const [labelIds, setLabelIds] = useState(task.labels.map((label) => label.id));
  const [error, setError] = useState('');
  const typeOptions = [{ value: NO_TYPE, label: '未分类' }, ...TASK_TYPES.map((value) => ({ value, label: TASK_TYPE_META[value].label }))];
  const typeIndex = Math.max(0, typeOptions.findIndex((item) => item.value === taskType));
  const dueChanged = dueDate !== (task.dueDate ?? '');
  const today = new Date().toISOString().slice(0, 10);

  function submit(): void {
    const patch: UpdateTaskInput = {
      title: title.trim(), description: description.trim() || null,
      deliverableSpec: deliverableSpec.trim() || null, acceptanceCriteria: acceptanceCriteria.trim() || null,
      taskType: taskType === NO_TYPE ? null : taskType as TaskType, priority,
      points: points.trim() ? Number(points) : null,
      minClaimants: minClaimants.trim() ? Number(minClaimants) : 1,
      maxClaimants: maxClaimants.trim() ? Number(maxClaimants) : null,
      dueDate: dueDate || null, labelIds,
    };
    if (dueChanged && dueReason.trim()) patch.dueChangeReason = dueReason.trim();
    const parsed = updateTaskInputSchema.safeParse(patch);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查输入'); return; }
    setError(''); onSave(parsed.data);
  }

  return <Card className="task-edit">
    <View className="task-edit__head"><View><Text className="task-edit__title">编辑任务</Text><Text className="task-edit__hint">修改任务定义、认领规则和截止时间。</Text></View><Text className="task-edit__close" onClick={onCancel}>×</Text></View>
    <EditField label="标题"><Input className="task-edit__control" value={title} maxlength={200} onInput={(event) => setTitle(event.detail.value)} /></EditField>
    <EditField label="描述（支持 Markdown）"><Textarea className="task-edit__control task-edit__textarea" value={description} maxlength={20000} onInput={(event) => setDescription(event.detail.value)} /></EditField>
    <View className="task-edit__grid"><EditField label="提交物要求"><Textarea className="task-edit__control task-edit__textarea task-edit__textarea--short" value={deliverableSpec} maxlength={20000} onInput={(event) => setDeliverableSpec(event.detail.value)} /></EditField><EditField label="验收标准"><Textarea className="task-edit__control task-edit__textarea task-edit__textarea--short" value={acceptanceCriteria} maxlength={20000} onInput={(event) => setAcceptanceCriteria(event.detail.value)} /></EditField></View>
    <View className="task-edit__grid task-edit__grid--three"><EditField label="任务类型"><Picker mode="selector" range={typeOptions.map((item) => item.label)} value={typeIndex} onChange={(event) => setTaskType(typeOptions[Number(event.detail.value)]?.value ?? NO_TYPE)}><View className="task-edit__control task-edit__select"><Text>{typeOptions[typeIndex]?.label}</Text><Text>⌄</Text></View></Picker></EditField><EditField label="优先级"><Picker mode="selector" range={PRIORITIES.map((value) => PRIORITY_META[value].label)} value={PRIORITIES.indexOf(priority)} onChange={(event) => setPriority(PRIORITIES[Number(event.detail.value)] ?? 'medium')}><View className="task-edit__control task-edit__select"><Text>{PRIORITY_META[priority].label}</Text><Text>⌄</Text></View></Picker></EditField><EditField label="点数"><Input className="task-edit__control" type="number" value={points} onInput={(event) => setPoints(event.detail.value)} /></EditField></View>
    <View className="task-edit__grid"><EditField label="截止日期"><Picker mode="date" value={dueDate || today} onChange={(event) => setDueDate(event.detail.value)}><View className="task-edit__control task-edit__select"><Text>{dueDate || '未设置'}</Text><Text>⌄</Text></View></Picker></EditField>{dueChanged && <EditField label="改期原因" hint="填写后会记录在任务动态中"><Input className="task-edit__control" value={dueReason} placeholder="为什么调整截止时间…" onInput={(event) => setDueReason(event.detail.value)} /></EditField>}</View>
    <View className="task-edit__grid"><EditField label="认领人数下限" hint="达到该人数才进入进行中"><Input className="task-edit__control" type="number" value={minClaimants} onInput={(event) => setMinClaimants(event.detail.value)} /></EditField><EditField label="认领人数上限" hint="留空表示不限"><Input className="task-edit__control" type="number" value={maxClaimants} placeholder="不限" onInput={(event) => setMaxClaimants(event.detail.value)} /></EditField></View>
    <EditField label="标签"><View className="task-edit__labels">{labels.map((label) => { const active = labelIds.includes(label.id); return <Text key={label.id} className="task-edit__label" style={{ borderColor: label.color, backgroundColor: active ? label.color : 'transparent', color: active ? '#fff' : label.color }} onClick={() => setLabelIds((values) => active ? values.filter((id) => id !== label.id) : [...values, label.id])}>{active ? '✓ ' : ''}{label.name}</Text>; })}</View></EditField>
    {error && <Text className="task-edit__error">{error}</Text>}
    <View className="task-edit__actions"><ActionButton tone="secondary" onClick={onCancel}>取消</ActionButton><ActionButton disabled={!title.trim()} loading={saving} onClick={submit}>保存</ActionButton></View>
  </Card>;
}
