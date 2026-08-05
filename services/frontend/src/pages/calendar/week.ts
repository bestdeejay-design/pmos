import type { Meeting } from '../../api/types'

export const HOUR_HEIGHT = 48
export const DAY_MIN = 15
export const MIN_DURATION_MS = 15 * 60 * 1000
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Понедельник текущей недели (00:00). */
export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const mondayOffset = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - mondayOffset)
  return d
}

export function dayIndexOf(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function durationMinutes(meeting: Meeting): number {
  return Math.max(
    0,
    (new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime()) / 60000,
  )
}

export function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}