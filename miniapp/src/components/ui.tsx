import { Button, Image, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import type { ReactNode } from 'react';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }): JSX.Element {
  return <View className="page-header"><View className="page-header__copy"><Text className="page-header__title">{title}</Text>{description && <Text className="page-header__description">{description}</Text>}</View>{action}</View>;
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }): JSX.Element {
  return <View className={`card ${className}`} onClick={onClick}>{children}</View>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }): JSX.Element {
  return <Text className={`badge badge--${tone}`}>{children}</Text>;
}

export function ActionButton({ children, tone = 'primary', size = 'default', loading, disabled, onClick }: { children: ReactNode; tone?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'default' | 'small'; loading?: boolean; disabled?: boolean; onClick?: () => void }): JSX.Element {
  return <Button className={`action-button action-button--${tone} action-button--${size}`} loading={loading} disabled={disabled} onClick={onClick}>{children}</Button>;
}

export function Segmented<T extends string>({ value, items, onChange }: { value: T; items: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void }): JSX.Element {
  return <View className="segmented">{items.map((item) => <View key={item.value} className={`segmented__item ${value === item.value ? 'segmented__item--active' : ''}`} onClick={() => onChange(item.value)}><Text>{item.label}</Text>{item.count != null && <Text className="segmented__count">{item.count}</Text>}</View>)}</View>;
}

export function Field({ label, value, placeholder, multiline, onChange }: { label: string; value: string; placeholder?: string; multiline?: boolean; onChange: (value: string) => void }): JSX.Element {
  return <View className="field"><Text className="field__label">{label}</Text>{multiline ? <Textarea className="field__control field__textarea" value={value} placeholder={placeholder} onInput={(event) => onChange(event.detail.value)} /> : <Input className="field__control" value={value} placeholder={placeholder} onInput={(event) => onChange(event.detail.value)} />}</View>;
}

export function SelectField({ label, valueLabel, range, value, onChange }: { label: string; valueLabel: string; range: readonly string[]; value: number; onChange: (index: number) => void }): JSX.Element {
  return <View className="field"><Text className="field__label">{label}</Text><Picker mode="selector" range={[...range]} value={value} onChange={(event) => onChange(Number(event.detail.value))}><View className="field__control field__select">{valueLabel}<Text>⌄</Text></View></Picker></View>;
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }): JSX.Element {
  return <View className="section"><View className="section__header"><Text className="section__title">{title}</Text>{count != null && <Badge>{count}</Badge>}</View>{children}</View>;
}

export function Stat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }): JSX.Element {
  return <View className="stat"><Text className="stat__value">{value}{suffix && <Text className="stat__suffix">{suffix}</Text>}</Text><Text className="stat__label">{label}</Text></View>;
}

export function Avatar({ name, color = '#57575c' }: { name: string; color?: string }): JSX.Element {
  return <View className="avatar" style={{ backgroundColor: color }}><Text>{name.trim().slice(0, 1).toUpperCase()}</Text></View>;
}

const APP_ICON_SOURCES = {
  admin: require('../assets/icons/admin.png'),
  assets: require('../assets/icons/assets.png'),
  board: require('../assets/icons/board.png'),
  ideas: require('../assets/icons/ideas.png'),
  info: require('../assets/icons/info.png'),
  org: require('../assets/icons/org.png'),
  profile: require('../assets/icons/profile.png'),
  projects: require('../assets/icons/projects.png'),
  stats: require('../assets/icons/stats.png'),
} as const;

export type AppIconName = keyof typeof APP_ICON_SOURCES;

export function AppIcon({ name, size = 20 }: { name: AppIconName; size?: number }): JSX.Element {
  return <Image className="app-icon" src={APP_ICON_SOURCES[name]} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px` }} />;
}

export function Empty({ title, description }: { title: string; description?: string }): JSX.Element {
  return <View className="empty"><Text className="empty__title">{title}</Text>{description && <Text className="empty__description">{description}</Text>}</View>;
}
