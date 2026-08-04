import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Projects from '../../pages/Projects'
import { projectsApi } from '../../api/projects'
import type { Project } from '../../api/types'

vi.mock('../../api/projects', () => ({
  projectsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedProjectsApi = vi.mocked(projectsApi)

const mockProject: Project = {
  id: '1',
  name: 'My Project',
  description: 'Project description',
  goal: 'Ship it',
  status: 'active',
  profileIds: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('Projects page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedProjectsApi.list.mockResolvedValue([mockProject])
  })

  it('shows loading state', () => {
    mockedProjectsApi.list.mockReturnValue(new Promise(() => {}))
    render(<Projects />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders project name after load', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('My Project')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedProjectsApi.list.mockRejectedValue(new Error('Network error'))
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument()
    })
  })

  it('renders + New Project button', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('+ New Project')).toBeInTheDocument()
    })
  })

  it('shows project description', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('Project description')).toBeInTheDocument()
    })
  })

  it('shows project status badge', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument()
    })
  })

  it('shows empty state when no projects', async () => {
    mockedProjectsApi.list.mockResolvedValue([])
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument()
    })
  })

  it('+ New Project opens create modal', async () => {
    render(<Projects />)
    await waitFor(() => {
      expect(screen.getByText('+ New Project')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ New Project'))
    expect(screen.getByText('New Project')).toBeInTheDocument()
  })
})
