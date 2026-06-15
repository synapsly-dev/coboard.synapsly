/**
 * Barrel export for UI primitives (§4 components/ui). Downstream feature agents
 * import from `@/components/ui` for a single, stable surface.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Input, type InputProps } from './Input';
export { Textarea, type TextareaProps } from './Textarea';
export { Label, type LabelProps } from './Label';
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { Spinner, FullPageSpinner } from './Spinner';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { TooltipProvider, Tooltip, type TooltipProps } from './Tooltip';

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
} from './Dialog';

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  type DrawerContentProps,
} from './Drawer';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  type DropdownMenuItemProps,
} from './DropdownMenu';

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectLabel,
  type SelectTriggerProps,
} from './Select';
