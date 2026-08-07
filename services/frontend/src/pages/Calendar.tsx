import { useState, useEffect } from 'react'
import { calendarApi } from '../api/calendar'
import type { Meeting, Reminder } from '../api/types'
import WeekGrid from './calendar/WeekGrid'
import { MeetingModal } from './calendar/MeetingModal'
import { startOfWeek } from './calendar/week'

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; meeting: Meeting }

type ViewMode = 'week' | 'list'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function formatRange(meeting: Meeting): string {
  const start = new Date(meeting.startTime)
  const end = new Date(meeting.endTime)
  const date = start.toLocaleDateString()
  if (meeting.allDay) return `${date} · all day`
  return `${date} · ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${fmt(weekStart)} – ${fmt(end)}, ${weekStart.getFullYear()}`
}

export default function Calendar() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [reminders, setReminders] = useState<Record<string, Reminder>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))

  const load = () => {
    setLoading(true)
    calendarApi
      .list()
      .then(rows => {
        setMeetings(rows)
        return Promise.all(
          rows.map(async m => {
            try {
              const rs = await calendarApi.listReminders(m.id)
              return rs.length > 0 ? ([m.id, rs[0]] as const) : null
            } catch {
              return null
            }
          }),
        )
      })
      .then(pairs => {
        setReminders(Object.fromEntries(pairs.filter(Boolean) as [string, Reminder][]))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    try {
      await calendarApi.delete(id)
      setMeetings(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleUpdate = async (
    id: string,
    patch: { startTime: string; endTime: string },
  ) => {
    try {
      const updated = await calendarApi.update(id, patch)
      setMeetings(prev => prev.map(m => (m.id === updated.id ? updated : m)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update meeting')
    }
  }

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  const sorted = [...meetings].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="section-title">Calendar</h1>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-sm ${
                view === 'week'
                  ? 'bg-accent text-white'
                  : 'bg-panel-2 text-ink hover:bg-panel'
              }`}
            >
              Week view
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-sm ${
                view === 'list'
                  ? 'bg-accent text-white'
                  : 'bg-panel-2 text-ink hover:bg-panel'
              }`}
            >
              List view
            </button>
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="btn btn-primary"
          >
            + New Meeting
          </button>
        </div>
      </div>

      {view === 'week' ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekStart(d => new Date(d.getTime() - WEEK_MS))}
              className="btn btn-secondary btn-sm"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="btn btn-secondary btn-sm"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(d => new Date(d.getTime() + WEEK_MS))}
              className="btn btn-secondary btn-sm"
            >
              Next →
            </button>
            <span className="text-sm text-muted">
              {formatWeekRange(weekStart)}
            </span>
          </div>
          <WeekGrid
            weekStart={weekStart}
            meetings={meetings}
            onUpdate={handleUpdate}
            onEdit={m => setModal({ mode: 'edit', meeting: m })}
            onDelete={handleDelete}
          />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-muted">No meetings scheduled.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map(meeting => (
            <div
              key={meeting.id}
              className="card flex items-start justify-between gap-4 rounded-lg border p-4 transition-shadow hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{meeting.title}</h2>
                  {reminders[meeting.id] && (
                    <span title="Reminder set">🔔</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {formatRange(meeting)}
                </p>
                {meeting.description && (
                  <p className="mt-1 line-clamp-1 text-sm text-muted">
                    {meeting.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setModal({ mode: 'edit', meeting })}
                  className="btn btn-secondary btn-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(meeting.id)}
                  className="btn btn-danger btn-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <MeetingModal
          initial={modal.mode === 'edit' ? modal.meeting : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
          onRefresh={() => {
            load()
          }}
        />
      )}
    </div>
  )
}