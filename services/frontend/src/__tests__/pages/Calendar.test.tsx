import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import Calendar from '../../pages/Calendar'
import { calendarApi } from '../../api/calendar'
import { computeDragResult } from '../../pages/calendar/WeekGrid'
import type { Meeting } from '../../api/types'

vi.mock('../../api/calendar', () => ({
  calendarApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({
      setNodeRef: () => {},
      isOver: false,
    }),
  }
})

const mockedCalendarApi = vi.mocked(calendarApi)

const mockMeeting: Meeting = {
  id: '1',
  title: 'Sprint Planning',
  startTime: '2025-06-01T10:00:00Z',
  endTime: '2025-06-01T11:00:00Z',
  allDay: false,
  description: 'Weekly planning',
  profileIds: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

/** Встреча в текущей неделе (чтобы попасть в week-грид). */
function meetingToday(hour: number, durationHours = 1): Meeting {
  const start = new Date()
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setTime(end.getTime() + durationHours * 3600000)
  return {
    id: 'grid-1',
    title: 'Grid Meeting',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    allDay: false,
    profileIds: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }
}

describe('Calendar page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCalendarApi.list.mockResolvedValue([mockMeeting])
  })

  it('shows loading state', () => {
    mockedCalendarApi.list.mockReturnValue(new Promise(() => {}))
    render(<Calendar />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders meeting title after load', async () => {
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedCalendarApi.list.mockRejectedValue(new Error('Network error'))
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeInTheDocument()
    })
  })

  it('renders + New Meeting button', async () => {
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('+ New Meeting')).toBeInTheDocument()
    })
  })

  it('shows empty state when no meetings', async () => {
    mockedCalendarApi.list.mockResolvedValue([])
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText(/no meetings scheduled/i)).toBeInTheDocument()
    })
  })

  it('+ New Meeting opens create modal', async () => {
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('+ New Meeting')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ New Meeting'))
    expect(screen.getByText('New Meeting')).toBeInTheDocument()
  })

  it('shows meeting description', async () => {
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Weekly planning')).toBeInTheDocument()
    })
  })

  it('renders meetings in week grid view', async () => {
    const meeting = meetingToday(10)
    mockedCalendarApi.list.mockResolvedValue([meeting])
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Grid Meeting')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /week view/i }))
    await waitFor(() => {
      expect(screen.getByTestId(`meeting-${meeting.id}`)).toBeInTheDocument()
    })
  })

  it('list view still works after toggling', async () => {
    const meeting = meetingToday(9)
    mockedCalendarApi.list.mockResolvedValue([meeting])
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Grid Meeting')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /week view/i }))
    await waitFor(() => {
      expect(screen.getByTestId(`meeting-${meeting.id}`)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /list view/i }))
    await waitFor(() => {
      expect(screen.queryByTestId(`meeting-${meeting.id}`)).not.toBeInTheDocument()
      expect(screen.getByText('Grid Meeting')).toBeInTheDocument()
    })
  })

  it('view toggle switches between grid and list', async () => {
    const meeting = meetingToday(9)
    mockedCalendarApi.list.mockResolvedValue([meeting])
    render(<Calendar />)
    await waitFor(() => {
      expect(screen.getByText('Grid Meeting')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /week view/i }))
    await waitFor(() => {
      expect(screen.getByTestId(`meeting-${meeting.id}`)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /list view/i }))
    await waitFor(() => {
      expect(screen.queryByTestId(`meeting-${meeting.id}`)).not.toBeInTheDocument()
    })
  })
})

describe('computeDragResult', () => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(2025, 5, 2 + i))

  function localMeeting(start: Date, end: Date): Meeting {
    return {
      id: 'm1',
      title: 'M',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      allDay: false,
      profileIds: [],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }
  }

  it('moves start/end by the vertical delta', () => {
    const meeting = localMeeting(
      new Date(2025, 5, 2, 10, 0, 0),
      new Date(2025, 5, 2, 11, 0, 0),
    )
    const result = computeDragResult([meeting], days, {
      active: { id: 'm1' },
      over: null,
      delta: { x: 0, y: 48 },
    })
    expect(result).toEqual({
      id: 'm1',
      startTime: new Date(2025, 5, 2, 11, 0, 0).toISOString(),
      endTime: new Date(2025, 5, 2, 12, 0, 0).toISOString(),
    })
  })

  it('moves a meeting to a different day via over.id', () => {
    const meeting = localMeeting(
      new Date(2025, 5, 2, 10, 0, 0),
      new Date(2025, 5, 2, 11, 0, 0),
    )
    const result = computeDragResult([meeting], days, {
      active: { id: 'm1' },
      over: { id: '2' },
      delta: { x: 0, y: 0 },
    })
    expect(result?.startTime).toBe(new Date(2025, 5, 4, 10, 0, 0).toISOString())
  })

  it('clamps resized endTime to a minimum 15-minute duration', () => {
    const meeting = localMeeting(
      new Date(2025, 5, 2, 10, 0, 0),
      new Date(2025, 5, 2, 11, 0, 0),
    )
    const result = computeDragResult([meeting], days, {
      active: { id: 'resize-m1' },
      over: null,
      delta: { x: 0, y: -96 },
    })
    expect(result?.startTime).toBe(meeting.startTime)
    expect(result?.endTime).toBe(new Date(2025, 5, 2, 10, 15, 0).toISOString())
  })

  it('extends endTime when the resize handle is dragged down', () => {
    const meeting = localMeeting(
      new Date(2025, 5, 2, 10, 0, 0),
      new Date(2025, 5, 2, 11, 0, 0),
    )
    const result = computeDragResult([meeting], days, {
      active: { id: 'resize-m1' },
      over: null,
      delta: { x: 0, y: 96 },
    })
    expect(result?.endTime).toBe(new Date(2025, 5, 2, 13, 0, 0).toISOString())
  })
})