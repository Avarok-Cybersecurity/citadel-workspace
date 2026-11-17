import type React from 'react';

/**
 * Thin wrappers so success/error toasts are consistent everywhere.
 *
 * `toastSuccess` used to pass a hardcoded `className` of hex colours
 * ("bg-card border-purple-800 ...") to tint the toast. That both bypassed
 * the theme tokens and broke in light mode. The variant is semantic now, and
 * Sonner colours it from the active theme.
 *
 * They still take `toast` as a parameter rather than importing it: call sites
 * already hold it from `useToast()`, and threading it keeps these usable from
 * anywhere a toast function is injected.
 */

type ToastFn = (opts: {
  title: string;
  description?: React.ReactNode;
  variant?: 'default' | 'success' | 'destructive' | 'outline';
}) => unknown;

export function toastSuccess(toast: ToastFn, title: string, description?: React.ReactNode): void {
  toast({ title, description, variant: 'success' });
}

export function toastError(toast: ToastFn, title: string, description?: React.ReactNode): void {
  toast({ title, description, variant: 'destructive' });
}
