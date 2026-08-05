import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Search from '../../pages/Search'
import { searchApi } from '../../api/search'

vi.mock('../../api/search', () => ({
  searchApi: {
    search: vi.fn(),
  },
}))

const mockedSearchApi = vi.mocked(searchApi)

describe('Search page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockedSearchApi.search.mockResolvedValue({
      results: [{ id: '1', type: 'note', title: 'Buy milk', snippet: 'Need milk…' }],
      semantic: false,
      total: 1,
    })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders page heading', () => {
    render(<Search />)
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
  })

  it('performs search on submit and shows results', async () => {
    render(<Search />)
    const input = screen.getByPlaceholderText(/note|task|meeting|file/i)
    fireEvent.change(input, { target: { value: 'milk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => {
      expect(mockedSearchApi.search).toHaveBeenCalledWith({ query: 'milk' })
    })
    await waitFor(() => {
      expect(screen.getByText('Buy milk')).toBeInTheDocument()
    })
  })

  it('stores query in localStorage history', async () => {
    render(<Search />)
    const input = screen.getByPlaceholderText(/note|task|meeting|file/i)
    fireEvent.change(input, { target: { value: 'grocery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => {
      expect(mockedSearchApi.search).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('grocery')).toBeInTheDocument()
    })
    const stored = JSON.parse(
      localStorage.getItem('pmos_search_history') ?? '[]',
    )
    expect(stored).toContain('grocery')
  })

  it('shows error on API failure', async () => {
    mockedSearchApi.search.mockRejectedValue(new Error('Search failed'))
    render(<Search />)
    const input = screen.getByPlaceholderText(/note|task|meeting|file/i)
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => {
      expect(screen.getByText(/search failed/i)).toBeInTheDocument()
    })
  })

  it('clear removes recent history', async () => {
    localStorage.setItem('pmos_search_history', JSON.stringify(['alpha', 'beta']))
    render(<Search />)
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Clear'))
    await waitFor(() => {
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    })
  })
})