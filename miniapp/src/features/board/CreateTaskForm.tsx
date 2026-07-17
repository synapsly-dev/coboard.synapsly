import Taro from '@tarojs/taro';
import { Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  createTaskInputSchema,
  PRIORITY_META,
  TASK_TYPE_META,
  type CreateTaskInput,
  type Label,
  type Priority,
  type TaskType,
} from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { ActionButton, Card } from '../../components/ui';

const NO_PROJECT = '__no_project__';
const UNASSIGNED = '__unassigned__';
const NO_TASK_TYPE = '__no_task_type__';
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const TASK_TYPES: TaskType[] = ['critical', 'baseline', 'claimable', 'collab'];
const LABEL_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function FormField({ label, required, children, error }: { label: string; required?: boolean; children: React.ReactNode; error?: string }): JSX.Element {
  return <View className="create-task__field"><Text className="create-task__label">{label}{required && <Text className="create-task__required"> *</Text>}</Text>{children}{error && <Text className="create-task__error">{error}</Text>}</View>;
}

export function CreateTaskForm({ boardProjectId, projects, labels, onCancel, onCreated }: {
  boardProjectId: string;
  projects: Array<{ id: string; name: string }>;
  labels: Label[];
  onCancel: () => void;
  onCreated: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState(boardProjectId === 'all' ? NO_PROJECT : boardProjectId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deliverableSpec, setDeliverableSpec] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [taskType, setTaskType] = useState<string>(NO_TASK_TYPE);
  const [priority, setPriority] = useState<Priority>('medium');
  const [points, setPoints] = useState('');
  const [minClaimants, setMinClaimants] = useState('1');
  const [maxClaimants, setMaxClaimants] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState(UNASSIGNED);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('#3b82f6');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const members = useQuery({
    queryKey: ['projects', selectedProject, 'members'],
    enabled: selectedProject !== NO_PROJECT,
    queryFn: async () => (await coboardClient.projects.members(selectedProject)).members,
  });
  const projectOptions = useMemo(() => [{ id: NO_PROJECT, name: '不指定项目（任务池）' }, ...projects], [projects]);
  const projectIndex = Math.max(0, projectOptions.findIndex((item) => item.id === selectedProject));
  const typeOptions = [{ value: NO_TASK_TYPE, label: '未分类' }, ...TASK_TYPES.map((value) => ({ value, label: TASK_TYPE_META[value].label }))];
  const typeIndex = Math.max(0, typeOptions.findIndex((item) => item.value === taskType));
  const priorityIndex = PRIORITIES.indexOf(priority);
  const assigneeOptions = [{ id: UNASSIGNED, name: '不指派' }, ...(members.data ?? []).map((item) => ({ id: item.userId, name: item.user.displayName }))];
  const assigneeIndex = Math.max(0, assigneeOptions.findIndex((item) => item.id === assigneeId));
  const today = new Date().toISOString().slice(0, 10);

  const create = useMutation({
    mutationFn: (payload: CreateTaskInput) => coboardClient.tasks.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      onCreated();
      Taro.showToast({ title: '任务已创建', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '创建失败，请重试', icon: 'none' }),
  });
  const createLabel = useMutation({
    mutationFn: () => coboardClient.labels.create({ name: labelName.trim(), color: labelColor }),
    onSuccess: (label) => {
      setLabelIds((values) => [...values, label.id]);
      setLabelName(''); setCreatingLabel(false);
      void queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
    onError: () => Taro.showToast({ title: '创建标签失败', icon: 'none' }),
  });

  function submit(): void {
    const payload: CreateTaskInput = {
      title: title.trim(),
      priority,
      minClaimants: minClaimants.trim() ? Number(minClaimants) : 1,
      projectId: selectedProject === NO_PROJECT ? null : selectedProject,
    };
    if (description.trim()) payload.description = description.trim();
    if (deliverableSpec.trim()) payload.deliverableSpec = deliverableSpec.trim();
    if (acceptanceCriteria.trim()) payload.acceptanceCriteria = acceptanceCriteria.trim();
    if (taskType !== NO_TASK_TYPE) payload.taskType = taskType as TaskType;
    if (points.trim()) payload.points = Number(points);
    if (maxClaimants.trim()) payload.maxClaimants = Number(maxClaimants);
    if (dueDate) payload.dueDate = dueDate;
    if (assigneeId !== UNASSIGNED && selectedProject !== NO_PROJECT) payload.assigneeId = assigneeId;
    if (labelIds.length) payload.labelIds = labelIds;
    const parsed = createTaskInputSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => { next[String(issue.path[0] ?? 'form')] ??= issue.message; });
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  return <View className="create-task-overlay" onClick={onCancel}><View className="create-task-dialog" onClick={(event) => event.stopPropagation()}><Card className="create-task">
    <View className="create-task__head"><View><Text className="create-task__title">新建任务</Text><Text className="create-task__description">创建后默认进入「待认领」；直接指派负责人则进入「进行中」。</Text></View><Text className="create-task__close" onClick={onCancel}>×</Text></View>

    <FormField label="所属项目" required><Picker mode="selector" range={projectOptions.map((item) => item.name)} value={projectIndex} onChange={(event) => { const value = projectOptions[Number(event.detail.value)]?.id ?? NO_PROJECT; setSelectedProject(value); setAssigneeId(UNASSIGNED); }}><View className="create-task__control create-task__select"><Text>{projectOptions[projectIndex]?.name}</Text><Text>⌄</Text></View></Picker></FormField>
    <FormField label="标题" required error={errors.title}><Input className={`create-task__control ${errors.title ? 'is-invalid' : ''}`} value={title} maxlength={200} placeholder="任务标题" onInput={(event) => setTitle(event.detail.value)} /></FormField>
    <FormField label="描述（支持 Markdown）"><Textarea className="create-task__control create-task__textarea" value={description} maxlength={20000} placeholder="描述（可选）" onInput={(event) => setDescription(event.detail.value)} /></FormField>

    <View className="create-task__grid create-task__grid--two">
      <FormField label="提交物要求"><Textarea className="create-task__control create-task__textarea create-task__textarea--compact" value={deliverableSpec} maxlength={20000} placeholder="文档 / 链接 / 截图 / 数据表…" onInput={(event) => setDeliverableSpec(event.detail.value)} /></FormField>
      <FormField label="验收标准"><Textarea className="create-task__control create-task__textarea create-task__textarea--compact" value={acceptanceCriteria} maxlength={20000} placeholder="什么算完成 / 合格…" onInput={(event) => setAcceptanceCriteria(event.detail.value)} /></FormField>
    </View>

    <View className="create-task__grid create-task__grid--three">
      <FormField label="任务类型"><Picker mode="selector" range={typeOptions.map((item) => item.label)} value={typeIndex} onChange={(event) => setTaskType(typeOptions[Number(event.detail.value)]?.value ?? NO_TASK_TYPE)}><View className="create-task__control create-task__select"><Text>{typeOptions[typeIndex]?.label}</Text><Text>⌄</Text></View></Picker></FormField>
      <FormField label="优先级" required><Picker mode="selector" range={PRIORITIES.map((item) => PRIORITY_META[item].label)} value={priorityIndex} onChange={(event) => setPriority(PRIORITIES[Number(event.detail.value)] ?? 'medium')}><View className="create-task__control create-task__select"><Text>{PRIORITY_META[priority].label}</Text><Text>⌄</Text></View></Picker></FormField>
      <FormField label="点数"><Input className="create-task__control" type="number" value={points} placeholder="可稍后确定" onInput={(event) => setPoints(event.detail.value)} /></FormField>
    </View>

    <View className="create-task__grid create-task__grid--two">
      <FormField label="认领人数下限" required error={errors.minClaimants}><Input className={`create-task__control ${errors.minClaimants ? 'is-invalid' : ''}`} type="number" value={minClaimants} placeholder="默认 1" onInput={(event) => setMinClaimants(event.detail.value)} /></FormField>
      <FormField label="认领人数上限" error={errors.maxClaimants}><Input className={`create-task__control ${errors.maxClaimants ? 'is-invalid' : ''}`} type="number" value={maxClaimants} placeholder="留空＝不限" onInput={(event) => setMaxClaimants(event.detail.value)} /></FormField>
    </View>

    <View className="create-task__grid create-task__grid--two">
      <FormField label="截止日期"><Picker mode="date" value={dueDate || today} onChange={(event) => setDueDate(event.detail.value)}><View className="create-task__control create-task__select"><Text className={dueDate ? '' : 'is-placeholder'}>{dueDate || '选择日期'}</Text><Text>⌄</Text></View></Picker></FormField>
      {selectedProject !== NO_PROJECT && <FormField label="负责人"><Picker mode="selector" range={assigneeOptions.map((item) => item.name)} value={assigneeIndex} onChange={(event) => setAssigneeId(assigneeOptions[Number(event.detail.value)]?.id ?? UNASSIGNED)}><View className="create-task__control create-task__select"><Text>{assigneeOptions[assigneeIndex]?.name ?? '不指派'}</Text><Text>⌄</Text></View></Picker></FormField>}
    </View>

    <FormField label="标签"><View className="create-task__labels">{labels.map((label) => { const active = labelIds.includes(label.id); return <Text key={label.id} className={`create-task__label ${active ? 'is-active' : ''}`} style={{ borderColor: label.color, backgroundColor: active ? label.color : 'transparent', color: active ? '#fff' : label.color }} onClick={() => setLabelIds((values) => active ? values.filter((id) => id !== label.id) : [...values, label.id])}>{active ? '✓ ' : ''}{label.name}</Text>; })}<Text className="create-task__new-label" onClick={() => setCreatingLabel((value) => !value)}>＋ 新建标签</Text></View>{creatingLabel && <View className="create-task__label-creator"><Input className="create-task__control" value={labelName} maxlength={30} placeholder="标签名称" onInput={(event) => setLabelName(event.detail.value)} /><View className="create-task__palette">{LABEL_COLORS.map((color) => <View key={color} className={`create-task__color ${labelColor === color ? 'is-active' : ''}`} style={{ backgroundColor: color }} onClick={() => setLabelColor(color)} />)}</View><View className="create-task__label-actions"><ActionButton size="small" disabled={!labelName.trim()} loading={createLabel.isPending} onClick={() => createLabel.mutate()}>添加</ActionButton><ActionButton size="small" tone="ghost" onClick={() => setCreatingLabel(false)}>取消</ActionButton></View></View>}</FormField>
    {selectedProject === NO_PROJECT && <Text className="create-task__hint">任务池任务对所有成员可见，创建时无法指派负责人。</Text>}
    {errors.form && <Text className="create-task__error">{errors.form}</Text>}
    <View className="create-task__footer"><ActionButton tone="secondary" onClick={onCancel}>取消</ActionButton><ActionButton loading={create.isPending} onClick={submit}>创建</ActionButton></View>
  </Card></View></View>;
}
