import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import TimeStats from '../../pages/TimeStats'
import { timesheetStats } from '../../api/time-tracking'
import type { TimesheetStats } from '../../api/types'

vi.mock('../../api/time-tracking', () => ({
  timesheetApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  timesheetStats: {
    getStats: vi.fn(),
  },
}))

const mockedTimesheetStats = vi.mocked(timesheetStats)

const mockStats: TimesheetStats = {
  total: 5400,
  todayTotal: 1800,
  weekTotal: 7200,
  perDay: [
    { date: '2026-08-03', total: 3600 },
    { date: '2026-08-04', total: 1800 },
  ],
  byTask: [
    { taskId: 't1', taskTitle: 'Write docs', total: 3600 },
    { taskId: 't2', taskTitle: 'Fix bug', total: 900 },
  ],
  byProject: [{ projectId: 'p1', projectName: 'PMOS', total: 2700 }],
}

describe('TimeStats page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTimesheetStats.getStats.mockResolvedValue(mockStats)
  })

  it('shows loading state', () => {
    mockedTimesheetStats.getStats.mockReturnValue(new Promise(() => {}))
    render(<TimeStats />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders totals after load', async () => {
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText('1 ч 30 мин')).toBeInTheDocument()
      expect(screen.getByText('0 ч 30 мин')).toBeInTheDocument()
      expect(screen.getByText('2 ч 0 мин')).toBeInTheDocument()
    })
  })

  it('renders task and project names from stats', async () => {
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText('Write docs')).toBeInTheDocument()
      expect(screen.getByText('Fix bug')).toBeInTheDocument()
      expect(screen.getByText('PMOS')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedTimesheetStats.getStats.mockRejectedValue(new Error('Network error'))
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText('Time Stats')).toBeInTheDocument()
    })
  })

  it('renders day bars with date labels', async () => {
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText('03.08')).toBeInTheDocument()
      expect(screen.getByText('04.08')).toBeInTheDocument()
    })
  })

  it('fetches stats with a computed range for today period', async () => {
    render(<TimeStats />)
    await waitFor(() => {
      expect(mockedTimesheetStats.getStats).toHaveBeenCalledTimes(1)
    })
    const params = mockedTimesheetStats.getStats.mock.calls[0]?.[0]
    expect(params?.from).toBeDefined()
    expect(params?.to).toBeDefined()
  })

  it('shows empty state when perDay is empty', async () => {
    mockedTimesheetStats.getStats.mockResolvedValue({
      ...mockStats,
      perDay: [],
    })
    render(<TimeStats />)
    await waitFor(() => {
      expect(screen.getByText(/нет данных за период/i)).toBeInTheDocument()
    })
  })
})
