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
    activate: vi.fn(),
    hide: vi.fn(),
    unhide: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedProfilesApi = vi.mocked(profilesApi)

const mockProfile: Profile = {
  id: '1',
  name: 'Work',
  color: '#6366f1',
  isActive: false,
  hidden: false,
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
      expect(screen.getByText(/no visible profiles/i)).toBeInTheDocument()
    })
  })

  it('shows "No profiles yet" when show-hidden is on', async () => {
    mockedProfilesApi.list.mockResolvedValue([])
    render(<Profiles />)
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => {
      expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument()
    })
  })

  it('hides hidden profiles by default and reveals them with toggle', async () => {
    mockedProfilesApi.list.mockResolvedValue([
      mockProfile,
      { ...mockProfile, id: '2', name: 'Home', hidden: true },
    ])
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
    })
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })

  it('marks the active profile with an Active badge', async () => {
    mockedProfilesApi.list.mockResolvedValue([
      mockProfile,
      { ...mockProfile, id: '2', name: 'Home', isActive: true },
    ])
    render(<Profiles />)
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
  })

  it('activate calls activate API and reloads', async () => {
    mockedProfilesApi.activate.mockResolvedValue({ ...mockProfile, isActive: true })
    mockedProfilesApi.list.mockResolvedValue([mockProfile])
    render(<Profiles />)
    const button = await screen.findByText('Activate')
    fireEvent.click(button)
    await waitFor(() => {
      expect(mockedProfilesApi.activate).toHaveBeenCalledWith('1')
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
