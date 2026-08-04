import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Settings from '../../pages/Settings'
import { settingsApi } from '../../api/settings'
import type { Setting } from '../../api/types'

vi.mock('../../api/settings', () => ({
  settingsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    ollamaModels: vi.fn(),
  },
}))

const mockedSettingsApi = vi.mocked(settingsApi)

const mockSetting: Setting = {
  key: 'theme',
  value: { dark: true },
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSettingsApi.list.mockResolvedValue([mockSetting])
    mockedSettingsApi.ollamaModels.mockResolvedValue({
      models: ['llama3'],
      degraded: false,
    })
  })

  it('shows loading state', () => {
    mockedSettingsApi.list.mockReturnValue(new Promise(() => {}))
    mockedSettingsApi.ollamaModels.mockReturnValue(new Promise(() => {}))
    render(<Settings />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders setting key after load', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('theme')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    mockedSettingsApi.list.mockRejectedValue(new Error('Network error'))
    mockedSettingsApi.ollamaModels.mockRejectedValue(new Error('Network error'))
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('renders page heading', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  it('renders + Add Setting button', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('+ Add Setting')).toBeInTheDocument()
    })
  })

  it('shows empty state when no settings', async () => {
    mockedSettingsApi.list.mockResolvedValue([])
    mockedSettingsApi.ollamaModels.mockResolvedValue({
      models: [],
      degraded: true,
    })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/no settings configured/i)).toBeInTheDocument()
    })
  })

  it('renders Ollama models panel', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Ollama Models')).toBeInTheDocument()
    })
  })

  it('shows Ollama model name', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('llama3')).toBeInTheDocument()
    })
  })

  it('shows degraded mode when Ollama unavailable', async () => {
    mockedSettingsApi.ollamaModels.mockResolvedValue({
      models: [],
      degraded: true,
    })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/degraded mode/i)).toBeInTheDocument()
    })
  })

  it('+ Add Setting opens create modal', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('+ Add Setting')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('+ Add Setting'))
    expect(screen.getByText('New Setting')).toBeInTheDocument()
  })
})
