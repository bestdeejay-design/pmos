export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `${h} ч ${m} мин`
}

export function formatDayLabel(date: string): string {
  const [, month, day] = date.split('T')[0].split('-')
  return `${day}.${month}`
}
