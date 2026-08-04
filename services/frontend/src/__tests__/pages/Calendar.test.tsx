import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Calendar from '../../pages/Calendar'
import { calendarApi } from '../../api/calendar'
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
})
