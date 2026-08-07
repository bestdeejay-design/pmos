import { useMemo } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { Meeting } from '../../api/types'
import { MeetingBlock } from './MeetingBlock'
import {
  DAY_LABELS,
  DAY_MIN,
  HOUR_HEIGHT,
  MIN_DURATION_MS,
  dayIndexOf,
  durationMinutes,
  hourLabel,
  minutesSinceMidnight,
  startOfWeek,
} from './week'

interface DragResult {
  id: string
  startTime: string
  endTime: string
}

interface DragEventLike {
  active: { id: string | number }
  over: { id: string | number } | null
  delta: { x: number; y: number }
}

export function computeDragResult(
  meetings: Meeting[],
  days: Date[],
  event: DragEventLike,
): DragResult | null {
  const { active, over, delta } = event
  const id = String(active.id)

  if (id.startsWith('resize-')) {
    const meetingId = id.slice('resize-'.length)
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) return null
    const deltaMin = Math.round((delta.y / HOUR_HEIGHT) * 60 / DAY_MIN) * DAY_MIN
    const newEndMs = new Date(meeting.endTime).getTime() + deltaMin * 60000
    const minEndMs = new Date(meeting.startTime).getTime() + MIN_DURATION_MS
    return {
      id: meetingId,
      startTime: meeting.startTime,
      endTime: new Date(Math.max(newEndMs, minEndMs)).toISOString(),
    }
  }

  const meeting = meetings.find(m => m.id === id)
  if (!meeting) return null
  const deltaMin = Math.round((delta.y / HOUR_HEIGHT) * 60 / DAY_MIN) * DAY_MIN
  const newStart = new Date(meeting.startTime)
  newStart.setTime(newStart.getTime() + deltaMin * 60000)
  if (over && typeof over.id === 'string' && /^\d$/.test(over.id)) {
    const target = days[Number(over.id)]
    newStart.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
  }
  const durMs = durationMinutes(meeting) * 60000
  return {
    id,
    startTime: newStart.toISOString(),
    endTime: new Date(newStart.getTime() + durMs).toISOString(),
  }
}

function HourLines() {
  return (
    <>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-line"
          style={{ top: h * HOUR_HEIGHT }}
        />
      ))}
    </>
  )
}

function TimeGutter() {
  return (
    <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute right-1 -translate-y-1/2 text-[10px] text-muted"
          style={{ top: h * HOUR_HEIGHT }}
        >
          {hourLabel(h)}
        </div>
      ))}
    </div>
  )
}

interface DayColumnProps {
  dayIndex: number
  date: Date
  meetings: Meeting[]
  onEdit: (meeting: Meeting) => void
  onDelete: (id: string) => void
}

function DayColumn({ dayIndex, date, meetings, onEdit, onDelete }: DayColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: String(dayIndex) })
  const isToday = date.toDateString() === new Date().toDateString()

  return (
    <div
      ref={setNodeRef}
      data-day={dayIndex}
      className={`relative min-w-0 border-l border-line ${
        isOver ? 'bg-accent/10' : ''
      }`}
      style={{ height: 24 * HOUR_HEIGHT }}
    >
      <HourLines />
      {isToday && (
        <div
          className="pointer-events-none absolute inset-x-0 h-0.5 bg-accent"
          style={{ top: (minutesSinceMidnight(new Date()) / 60) * HOUR_HEIGHT }}
        />
      )}
      {meetings.map(m => (
        <MeetingBlock key={m.id} meeting={m} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}

interface WeekGridProps {
  weekStart: Date
  meetings: Meeting[]
  onUpdate: (id: string, patch: { startTime: string; endTime: string }) => void
  onEdit: (meeting: Meeting) => void
  onDelete: (id: string) => void
}

export default function WeekGrid({
  weekStart,
  meetings,
  onUpdate,
  onEdit,
  onDelete,
}: WeekGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const days = useMemo(() => {
    const start = startOfWeek(weekStart)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  const byDay = useMemo(() => {
    const start = startOfWeek(weekStart)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const buckets: Meeting[][] = Array.from({ length: 7 }, () => [])
    for (const m of meetings) {
      const t = new Date(m.startTime)
      if (t.getTime() < start.getTime() || t.getTime() >= end.getTime()) continue
      buckets[dayIndexOf(t)].push(m)
    }
    for (const bucket of buckets) {
      bucket.sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      )
    }
    return buckets
  }, [meetings, weekStart])

  const handleDragEnd = (event: DragEndEvent) => {
    const result = computeDragResult(meetings, days, event)
    if (result) {
      onUpdate(result.id, { startTime: result.startTime, endTime: result.endTime })
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line">
            <div />
            {days.map((d, i) => (
              <div key={i} className="px-1 py-2 text-center">
                <p className="text-xs font-semibold text-ink">{DAY_LABELS[i]}</p>
                <p className="text-xs text-muted">{d.getDate()}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            <TimeGutter />
            {days.map((d, i) => (
              <DayColumn
                key={i}
                dayIndex={i}
                date={d}
                meetings={byDay[i]}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}