import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Tasks from '../../pages/Tasks'
import { tasksApi } from '../../api/tasks'
import type { Task } from '../../api/types'

vi.mock('../../api/tasks', () => ({
  tasksApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedTasksApi = vi.mocked(tasksApi)

const mockTask: Task = {
  id: '1',
  title: 'Test Task',
  status: 'todo',
  priority: 1,
  profileIds: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('Tasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTasksApi.list.mockResolvedValue([mockTask])
  })

  it('shows loading state', () => {
    mockedTasksApi.list.mockReturnValue(new Promise(() => {}))
    render(<Tasks />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders task title after load', async () => {
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedTasksApi.list.mockRejectedValue(new Error('Network error'))
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })
  })

  it('renders kanban column headers', async () => {
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeInTheDocument()
      expect(screen.getByText('To Do')).toBeInTheDocument()
      expect(screen.getByText('In Progress')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
    })
  })

  it('renders the task form', async () => {
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/new task/i)).toBeInTheDocument()
      expect(screen.getByText('+ Add Task')).toBeInTheDocument()
    })
  })

  it('shows empty column text when no tasks in column', async () => {
    mockedTasksApi.list.mockResolvedValue([])
    render(<Tasks />)
    await waitFor(() => {
      const empties = screen.getAllByText('Empty')
      expect(empties.length).toBeGreaterThan(0)
    })
  })

  it('task priority is displayed', async () => {
    render(<Tasks />)
    await waitFor(() => {
      expect(screen.getByText('P1')).toBeInTheDocument()
    })
  })
})
