import { useState, useEffect } from 'react'
import { timesheetStats } from '../api/time-tracking'
import type { TimesheetStats } from '../api/types'
import { formatDayLabel, formatDuration } from './timestats/format'

type Period = 'today' | 'week' | 'month' | 'custom'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Произвольный' },
]

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

function startOfWeek(d: Date): Date {
  const r = startOfDay(d)
  const day = r.getDay()
  const daysSinceMonday = (day + 6) % 7
  r.setDate(r.getDate() - daysSinceMonday)
  return r
}

function startOfMonth(d: Date): Date {
  const r = startOfDay(d)
  r.setDate(1)
  return r
}

function computeRange(
  period: Period,
  customFrom: string | null,
  customTo: string | null,
): { from?: string; to?: string } {
  const now = new Date()
  switch (period) {
    case 'today':
      return {
        from: startOfDay(now).toISOString(),
        to: endOfDay(now).toISOString(),
      }
    case 'week': {
      const from = startOfWeek(now)
      const last = new Date(from)
      last.setDate(last.getDate() + 6)
      return { from: from.toISOString(), to: endOfDay(last).toISOString() }
    }
    case 'month': {
      const from = startOfMonth(now)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: from.toISOString(), to: endOfDay(last).toISOString() }
    }
    case 'custom': {
      const range: { from?: string; to?: string } = {}
      if (customFrom) range.from = new Date(`${customFrom}T00:00:00`).toISOString()
      if (customTo) range.to = new Date(`${customTo}T23:59:59`).toISOString()
      return range
    }
  }
}

export default function TimeStats() {
  const [period, setPeriod] = useState<Period>('today')
  const [customFrom, setCustomFrom] = useState<string | null>(null)
  const [customTo, setCustomTo] = useState<string | null>(null)
  const [stats, setStats] = useState<TimesheetStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    const range = computeRange(period, customFrom, customTo)
    timesheetStats
      .getStats(range)
      .then(setStats)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [period, customFrom, customTo])

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>
  if (!stats) return null

  const maxPerDay = Math.max(...stats.perDay.map(d => d.total), 1)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="section-title">Time Stats</h1>
        <div className="flex overflow-hidden rounded-lg border border-line">
          {PERIODS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={`px-3 py-1.5 text-sm ${
                period === value
                  ? 'bg-accent text-white'
                  : 'bg-panel-2 text-ink hover:bg-panel'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="card mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              От
            </label>
            <input
              type="date"
              value={customFrom ?? ''}
              onChange={e => setCustomFrom(e.target.value || null)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              До
            </label>
            <input
              type="date"
              value={customTo ?? ''}
              onChange={e => setCustomTo(e.target.value || null)}
              className="input"
            />
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card rounded-lg border p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            За период
          </p>
          <p className="mt-1 text-2xl font-extrabold text-accent">
            {formatDuration(stats.total)}
          </p>
        </div>
        <div className="card rounded-lg border p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Сегодня
          </p>
          <p className="mt-1 text-2xl font-extrabold text-accent">
            {formatDuration(stats.todayTotal)}
          </p>
        </div>
        <div className="card rounded-lg border p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Неделя
          </p>
          <p className="mt-1 text-2xl font-extrabold text-accent">
            {formatDuration(stats.weekTotal)}
          </p>
        </div>
      </div>

      <div className="card mb-6 rounded-lg border p-4">
        <h2 className="mb-4 font-semibold">По дням</h2>
        {stats.perDay.length === 0 ? (
          <p className="text-sm text-muted">Нет данных за период.</p>
        ) : (
          <div className="flex items-end gap-2">
            {stats.perDay.map(day => (
              <div
                key={day.date}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <div className="flex h-32 w-full items-end">
                  <div
                    title={`${day.date}: ${formatDuration(day.total)}`}
                    className="w-full rounded-t bg-accent"
                    style={{
                      height: `${Math.round((day.total / maxPerDay) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted">
                  {formatDayLabel(day.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">По задачам</h2>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">Задача</th>
                <th className="pb-2 text-right font-medium">Время</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTask.map(row => (
                <tr key={row.taskId} className="border-b border-line">
                  <td className="py-2 text-sm">{row.taskTitle ?? '—'}</td>
                  <td className="py-2 text-right text-sm">
                    {formatDuration(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">По проектам</h2>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">Проект</th>
                <th className="pb-2 text-right font-medium">Время</th>
              </tr>
            </thead>
            <tbody>
              {stats.byProject.map(row => (
                <tr key={row.projectId} className="border-b border-line">
                  <td className="py-2 text-sm">{row.projectName ?? '—'}</td>
                  <td className="py-2 text-right text-sm">
                    {formatDuration(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}