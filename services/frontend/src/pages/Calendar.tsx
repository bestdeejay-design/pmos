import { useState, useEffect, type FormEvent } from 'react'
import { calendarApi } from '../api/calendar'
import type { Meeting } from '../api/types'

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; meeting: Meeting }

function toLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16)
}

function MeetingModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Meeting | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [startTime, setStartTime] = useState(
    initial ? toLocalInput(initial.startTime) : '',
  )
  const [endTime, setEndTime] = useState(
    initial ? toLocalInput(initial.endTime) : '',
  )
  const [allDay, setAllDay] = useState(initial?.allDay ?? false)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      title,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      allDay,
      description: description || undefined,
    }
    try {
      if (initial) {
        await calendarApi.update(initial.id, payload)
      } else {
        await calendarApi.create(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save meeting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Meeting' : 'New Meeting'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Title
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Start
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                End
              </label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
              className="h-4 w-4"
            />
            All day
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function formatRange(meeting: Meeting): string {
  const start = new Date(meeting.startTime)
  const end = new Date(meeting.endTime)
  const date = start.toLocaleDateString()
  if (meeting.allDay) return `${date} · all day`
  return `${date} · ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function Calendar() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

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

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  const sorted = [...meetings].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          + New Meeting
        </button>
      </div>

      {sorted.length === 0 ? (
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