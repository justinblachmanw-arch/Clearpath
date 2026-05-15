import { clsx as clsxLib, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsxLib(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatCurrencyFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatTime(time: string | null | undefined): string {
  if (!time) return ''
  const parts = time.split(':')
  const h = parseInt(parts[0], 10)
  const m = parts[1] || '00'
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${period}`
}

export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export function calcAge(dob: string | null): string {
  if (!dob) return '—'
  const birth = new Date(dob + 'T00:00:00')
  const today = new Date()
  const age = today.getFullYear() - birth.getFullYear() -
    (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0)
  return `${age} yrs`
}

export function toTitleCase(str: string | null | undefined): string {
  if (!str) return ''
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function computeTrend(sparkline?: number[]): number | undefined {
  if (!sparkline || sparkline.length < 2) return undefined
  const prev = sparkline[sparkline.length - 2]
  const curr = sparkline[sparkline.length - 1]
  if (!prev || prev === 0) return undefined
  return Math.round(((curr - prev) / prev) * 100)
}
