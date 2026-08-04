import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Notes from '../../pages/Notes'
import { notesApi } from '../../api/notes'
import type { Note } from '../../api/types'

vi.mock('../../api/notes', () => ({
  notesApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    generateTitle: vi.fn(),
  },
}))

const mockedNotesApi = vi.mocked(notesApi)

const mockNote: Note = {
  id: '1',
  title: 'Test Note',
  bodyMd: 'Body content',
  tags: ['work'],
  profileIds: [],
  isArchived: false,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('Notes page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedNotesApi.list.mockResolvedValue([mockNote])
  })

  it('shows loading state', () => {
    mockedNotesApi.list.mockReturnValue(new Promise(() => {}))
    render(<Notes />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders notes list after load', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('Test Note')).toBeInTheDocument()
    })
  })

  it('shows note body text', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('Body content')).toBeInTheDocument()
    })
  })

  it('shows note tags', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('work')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedNotesApi.list.mockRejectedValue(new Error('Network error'))
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('shows empty state when no notes', async () => {
    mockedNotesApi.list.mockResolvedValue([])
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('Notes')).toBeInTheDocument()
    })
  })

  it('renders + New Note button', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('+ New Note')).toBeInTheDocument()
    })
  })

  it('+ New Note button opens create modal', async () => {
    render(<Notes />)
    await waitFor(() => {
      expect(screen.getByText('+ New Note')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ New Note'))
    expect(screen.getByText('New Note')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
  })
})
