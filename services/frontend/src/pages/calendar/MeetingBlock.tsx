import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Meeting } from '../../api/types'
import {
  HOUR_HEIGHT,
  durationMinutes,
  minutesSinceMidnight,
  timeLabel,
} from './week'

interface MeetingBlockProps {
  meeting: Meeting
  onEdit: (meeting: Meeting) => void
  onDelete: (id: string) => void
}

export function MeetingBlock({ meeting, onEdit, onDelete }: MeetingBlockProps) {
  const start = new Date(meeting.startTime)
  const dur = durationMinutes(meeting)
  const top = (minutesSinceMidnight(start) / 60) * HOUR_HEIGHT
  const height = Math.max((dur / 60) * HOUR_HEIGHT, 18)

  const drag = useDraggable({ id: meeting.id })
  const resize = useDraggable({ id: `resize-${meeting.id}` })

  return (
    <div
      ref={drag.setNodeRef}
      data-testid={`meeting-${meeting.id}`}
      style={{
        top,
        height,
        transform: CSS.Transform.toString(drag.transform),
        opacity: drag.isDragging ? 0.6 : 1,
        zIndex: drag.isDragging ? 20 : 10,
      }}
      className="absolute inset-x-1 overflow-hidden rounded-md border border-blue-200 bg-blue-50 shadow-sm"
    >
      <div
        {...drag.attributes}
        {...drag.listeners}
        className="cursor-grab p-1.5 active:cursor-grabbing"
      >
        <div className="flex items-center justify-between gap-1">
          <p className="truncate text-xs font-semibold text-blue-900">{meeting.title}</p>
          <span className="flex shrink-0 gap-0.5">
            <button
              type="button"
              onClick={() => onEdit(meeting)}
              aria-label={`Edit ${meeting.title}`}
              className="rounded px-1 text-[10px] text-blue-600 hover:bg-blue-100"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => onDelete(meeting.id)}
              aria-label={`Delete ${meeting.title}`}
              className="rounded px-1 text-[10px] text-red-500 hover:bg-red-50"
            >
              ✕
            </button>
          </span>
        </div>
        <p className="text-[10px] text-blue-600">
          {timeLabel(start)}–{timeLabel(new Date(meeting.endTime))}
        </p>
      </div>
      <div
        ref={resize.setNodeRef}
        {...resize.attributes}
        {...resize.listeners}
        data-testid={`resize-${meeting.id}`}
        aria-label="Resize meeting"
        style={{ transform: CSS.Transform.toString(resize.transform) }}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-blue-200 hover:bg-blue-300"
      />
    </div>
  )
}