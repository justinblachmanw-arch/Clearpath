import { cn } from '@/lib/utils'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'gray'

const styles: Record<BadgeVariant, string> = {
  success: 'bg-green-100 text-green-800 border-green-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  danger:  'bg-red-100 text-red-800 border-red-200',
  info:    'bg-blue-100 text-blue-800 border-blue-200',
  gray:    'bg-gray-100 text-gray-600 border-gray-200',
}

export function eligibilityVariant(status: string | null): BadgeVariant {
  if (status === 'active')    return 'success'
  if (status === 'not_found') return 'warning'
  if (status === 'inactive')  return 'danger'
  return 'gray'
}

export function eligibilityLabel(status: string | null): string {
  if (status === 'active')    return 'Verified'
  if (status === 'not_found') return 'Check ins.'
  if (status === 'inactive')  return 'Issue'
  return 'Pending'
}

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-full',
      styles[variant], className
    )}>
      {children}
    </span>
  )
}
