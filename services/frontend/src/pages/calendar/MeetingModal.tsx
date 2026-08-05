import { useEffect, useState, type FormEvent } from 'react'
import { calendarApi } from '../../api/calendar'
import type { Meeting, Reminder } from '../../api/types'

function toLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16)
}

export function MeetingModal({
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
  const [remindMin, setRemindMin] = useState(0)
  const [existing, setExisting] = useState<Reminder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
      if (remindMin > 0) {
        const remindAt = new Date(
          new Date(meeting.startTime).getTime() - remindMin * 60_000,
        ).toISOString()
        await calendarApi.createReminder(meeting.id, { remindAt, channel: 'push' })
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
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Remind me before (minutes)
            </label>
            <input
              type="number"
              min={0}
              step={5}
              value={remindMin}
              onChange={e => setRemindMin(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
            {existing.length > 0 && (
              <p className="mt-1 text-xs text-neutral-400">
                Existing reminder:{' '}
                {new Date(existing[0].remindAt).toLocaleString()}
              </p>
            )}
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