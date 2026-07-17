import Taro from '@tarojs/taro';
import { Button, Image, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useState, type ReactNode } from 'react';
import { absoluteApiUrl } from '../platform/http';
import { sessionStore } from '../platform/session';

export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: string; action?: ReactNode; eyebrow?: string }): JSX.Element {
  return <View className="page-header"><View className="page-header__copy">{eyebrow && <Text className="page-header__eyebrow">{eyebrow}</Text>}<Text className="page-header__title">{title}</Text>{description && <Text className="page-header__description">{description}</Text>}</View>{action && <View className="page-header__action">{action}</View>}</View>;
}

export function Card({ children, className = '', onClick, interactive = Boolean(onClick) }: { children: ReactNode; className?: string; onClick?: () => void; interactive?: boolean }): JSX.Element {
  return <View className={`card ${interactive ? 'card--interactive' : ''} ${className}`} onClick={onClick}>{children}</View>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }): JSX.Element {
  return <Text className={`badge badge--${tone}`}>{children}</Text>;
}

export function ActionButton({ children, tone = 'primary', size = 'default', loading, disabled, onClick, block = false }: { children: ReactNode; tone?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'default' | 'small'; loading?: boolean; disabled?: boolean; onClick?: () => void; block?: boolean }): JSX.Element {
  return <Button className={`action-button action-button--${tone} action-button--${size} ${block ? 'action-button--block' : ''}`} loading={loading} disabled={disabled} onClick={onClick}>{children}</Button>;
}

export function Segmented<T extends string>({ value, items, onChange }: { value: T; items: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void }): JSX.Element {
  return <View className="segmented">{items.map((item) => <View key={item.value} className={`segmented__item ${value === item.value ? 'segmented__item--active' : ''}`} onClick={() => onChange(item.value)}><Text>{item.label}</Text>{item.count != null && <Text className="segmented__count">{item.count}</Text>}</View>)}</View>;
}

export function Field({ label, value, placeholder, multiline, onChange, hint, error, required, disabled }: { label: string; value: string; placeholder?: string; multiline?: boolean; onChange: (value: string) => void; hint?: string; error?: string; required?: boolean; disabled?: boolean }): JSX.Element {
  return <View className={`field ${error ? 'field--error' : ''}`}><Text className="field__label">{label}{required && <Text className="field__required"> *</Text>}</Text>{multiline ? <Textarea className="field__control field__textarea" value={value} placeholder={placeholder} disabled={disabled} onInput={(event) => onChange(event.detail.value)} /> : <Input className="field__control" value={value} placeholder={placeholder} disabled={disabled} onInput={(event) => onChange(event.detail.value)} />}{error ? <Text className="field__error">{error}</Text> : hint ? <Text className="field__hint">{hint}</Text> : null}</View>;
}

export function SelectField({ label, valueLabel, range, value, onChange }: { label: string; valueLabel: string; range: readonly string[]; value: number; onChange: (index: number) => void }): JSX.Element {
  return <View className="field"><Text className="field__label">{label}</Text><Picker mode="selector" range={[...range]} value={value} onChange={(event) => onChange(Number(event.detail.value))}><View className="field__control field__select">{valueLabel}<Text>⌄</Text></View></Picker></View>;
}

export function Section({ title, count, children, description, action }: { title: string; count?: number; children: ReactNode; description?: string; action?: ReactNode }): JSX.Element {
  return <View className="section"><View className="section__header"><View className="section__copy"><View className="row"><Text className="section__title">{title}</Text>{count != null && <Badge>{count}</Badge>}</View>{description && <Text className="section__description">{description}</Text>}</View>{action}</View>{children}</View>;
}

export function Stat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }): JSX.Element {
  return <View className="stat"><Text className="stat__value">{value}{suffix && <Text className="stat__suffix">{suffix}</Text>}</Text><Text className="stat__label">{label}</Text></View>;
}

const avatarCache = new Map<string, string>();

export function clearAvatarCache(userId?: string): void {
  if (userId) avatarCache.delete(userId);
  else avatarCache.clear();
}

export function Avatar({ name, color = '#57575c', userId, hasAvatar = false, size = 'default', version = 0 }: { name: string; color?: string; userId?: string; hasAvatar?: boolean; size?: 'small' | 'default' | 'large'; version?: number }): JSX.Element {
  const [src, setSrc] = useState(() => userId ? avatarCache.get(userId) : undefined);
  useEffect(() => {
    if (!userId || !hasAvatar) { setSrc(undefined); return; }
    const cached = avatarCache.get(userId);
    if (cached && version === 0) { setSrc(cached); return; }
    let active = true;
    const token = sessionStore.token();
    void Taro.downloadFile({
      url: `${absoluteApiUrl(`/users/${userId}/avatar`)}?v=${version}`,
      header: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((response) => {
      if (!active || response.statusCode < 200 || response.statusCode >= 300) return;
      avatarCache.set(userId, response.tempFilePath);
      setSrc(response.tempFilePath);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [hasAvatar, userId, version]);
  return <View className={`avatar avatar--${size}`} style={{ backgroundColor: color }}>{src ? <Image className="avatar__image" src={src} mode="aspectFill" /> : <Text>{name.trim().slice(0, 1).toUpperCase()}</Text>}</View>;
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
  workbench: require('../assets/tabbar/workbench-selected.png'),
  notifications: require('../assets/tabbar/notifications-selected.png'),
  more: require('../assets/tabbar/more-selected.png'),
} as const;

export type AppIconName = keyof typeof APP_ICON_SOURCES;

export function AppIcon({ name, size = 20 }: { name: AppIconName; size?: number }): JSX.Element {
  return <Image className="app-icon" src={APP_ICON_SOURCES[name]} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px` }} />;
}

export function Empty({ title, description }: { title: string; description?: string }): JSX.Element {
  return <View className="empty"><Text className="empty__title">{title}</Text>{description && <Text className="empty__description">{description}</Text>}</View>;
}

export function InlineError({ message }: { message?: string | null }): JSX.Element | null {
  if (!message) return null;
  return <View className="inline-error"><Text>{message}</Text></View>;
}

export function Modal({ open, title, description, children, footer, onClose, className = '' }: { open: boolean; title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; className?: string }): JSX.Element | null {
  if (!open) return null;
  return <View className="modal" catchMove><View className="modal__scrim" onClick={onClose} /><View className={`modal__sheet ${className}`}><View className="modal__handle" /><View className="modal__header"><View className="modal__copy"><Text className="modal__title">{title}</Text>{description && <Text className="modal__description">{description}</Text>}</View><Text className="modal__close" onClick={onClose}>×</Text></View><View className="modal__body">{children}</View>{footer && <View className="modal__footer">{footer}</View>}</View></View>;
}

export function Toolbar({ children }: { children: ReactNode }): JSX.Element {
  return <View className="toolbar">{children}</View>;
}
