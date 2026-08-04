import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Profiles from '../../pages/Profiles'
import { profilesApi } from '../../api/profiles'
import type { Profile } from '../../api/types'

vi.mock('../../api/profiles', () => ({
  profilesApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedProfilesApi = vi.mocked(profilesApi)

const mockProfile: Profile = {
  id: '1',
  name: 'Work',
  color: '#6366f1',
}

describe('Profiles page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedProfilesApi.list.mockResolvedValue([mockProfile])
  })

  it('shows loading state', () => {
    mockedProfilesApi.list.mockReturnValue(new Promise(() => {}))
    render(<Profiles />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders profile name after load', async () => {
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedProfilesApi.list.mockRejectedValue(new Error('Network error'))
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('Profiles')).toBeInTheDocument()
    })
  })

  it('renders + New Profile button', async () => {
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('+ New Profile')).toBeInTheDocument()
    })
  })

  it('shows profile color', async () => {
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('#6366f1')).toBeInTheDocument()
    })
  })

  it('shows empty state when no profiles', async () => {
    mockedProfilesApi.list.mockResolvedValue([])
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument()
    })
  })

  it('+ New Profile opens create modal', async () => {
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('+ New Profile')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ New Profile'))
    expect(screen.getByText('New Profile')).toBeInTheDocument()
  })
})
