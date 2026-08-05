import { useState, useEffect } from 'react'
import { calendarApi } from '../api/calendar'
import type { Meeting } from '../api/types'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))

  const load = () => {
    setLoading(true)
    calendarApi
      .list()
      .then(setMeetings)
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

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  const sorted = [...meetings].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-300">
            <button
              type="button"
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-sm ${
                view === 'week'
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              Week view
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-sm ${
                view === 'list'
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              List view
            </button>
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
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
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(d => new Date(d.getTime() + WEEK_MS))}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Next →
            </button>
            <span className="text-sm text-neutral-500">
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
        <p className="text-neutral-500">No meetings scheduled.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map(meeting => (
            <div
              key={meeting.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="min-w-0">
                <h2 className="font-semibold">{meeting.title}</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  {formatRange(meeting)}
                </p>
                {meeting.description && (
                  <p className="mt-1 line-clamp-1 text-sm text-neutral-400">
                    {meeting.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setModal({ mode: 'edit', meeting })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(meeting.id)}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
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
        />
      )}
    </div>
  )
}