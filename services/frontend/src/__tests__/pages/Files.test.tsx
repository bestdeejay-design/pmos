import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Files from '../../pages/Files'
import { filesApi } from '../../api/files'
import type { FileMeta } from '../../api/types'

vi.mock('../../api/files', () => ({
  filesApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
  },
}))

const mockedFilesApi = vi.mocked(filesApi)

const mockFile: FileMeta = {
  id: '1',
  filename: 'document.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  profileIds: [],
  storagePath: '/tmp/document.pdf',
  uploadedAt: '2025-01-01T00:00:00Z',
}

describe('Files page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFilesApi.list.mockResolvedValue([mockFile])
  })

  it('shows loading state', () => {
    mockedFilesApi.list.mockReturnValue(new Promise(() => {}))
    render(<Files />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders file name after load', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedFilesApi.list.mockRejectedValue(new Error('Network error'))
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('Files')).toBeInTheDocument()
    })
  })

  it('renders upload button', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('+ Upload File')).toBeInTheDocument()
    })
  })

  it('shows empty state when no files', async () => {
    mockedFilesApi.list.mockResolvedValue([])
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText(/no files uploaded/i)).toBeInTheDocument()
    })
  })

  it('renders table headers', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Type')).toBeInTheDocument()
      expect(screen.getByText('Size')).toBeInTheDocument()
      expect(screen.getByText('Uploaded')).toBeInTheDocument()
    })
  })

  it('renders file mime type', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('application/pdf')).toBeInTheDocument()
    })
  })

  it('renders formatted file size', async () => {
    render(<Files />)
    await waitFor(() => {
      expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    })
  })
})
