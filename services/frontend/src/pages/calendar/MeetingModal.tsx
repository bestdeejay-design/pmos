import { useEffect, useState, type FormEvent } from 'react'
import { calendarApi } from '../../api/calendar'
import type { Meeting, MeetingConflict, Reminder } from '../../api/types'

function toLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16)
}

export function MeetingModal({
  initial,
  onClose,
  onSaved,
  onRefresh,
}: {
  initial: Meeting | null
  onClose: () => void
  onSaved: () => void
  onRefresh?: () => void
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
  const [remindMin, setRemindMin] = useState(0)
  const [existing, setExisting] = useState<Reminder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<MeetingConflict[]>([])

  useEffect(() => {
    setWarnings([])
    let cancelled = false
    if (!initial) return
    calendarApi
      .listReminders(initial.id)
      .then(rows => {
        if (!cancelled) setExisting(rows)
      })
      .catch(() => {
        if (!cancelled) setExisting([])
      })
    return () => {
      cancelled = true
    }
  }, [initial])

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
      const meeting = initial
        ? await calendarApi.update(initial.id, payload)
        : await calendarApi.create(payload)
      const conflicts = meeting.warnings ?? []
      setWarnings(conflicts)
      if (remindMin > 0) {
        const remindAt = new Date(
          new Date(meeting.startTime).getTime() - remindMin * 60_000,
        ).toISOString()
        await calendarApi.createReminder(meeting.id, { remindAt, channel: 'push' })
      }
      if (conflicts.length > 0) {
        onRefresh?.()
      } else {
        onSaved()
      }
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
        className="card w-full max-w-lg rounded-xl border p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Meeting' : 'New Meeting'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Title
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">
                Start
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                required
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">
                End
              </label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                required
                className="input"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            All day
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Remind me before (minutes)
            </label>
            <input
              type="number"
              min={0}
              step={5}
              value={remindMin}
              onChange={e => setRemindMin(Number(e.target.value) || 0)}
              className="input"
            />
            {existing.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                Existing reminder:{' '}
                {new Date(existing[0].remindAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        {warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">
              {initial ? 'Updated, but overlaps:' : 'Saved, but overlaps:'}
            </p>
            <ul className="mt-1 list-inside list-disc">
              {warnings.map(w => (
                <li key={w.id}>
                  {w.title}{' '}
                  <span className="text-amber-700">
                    ({new Date(w.startTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    –{' '}
                    {new Date(w.endTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}