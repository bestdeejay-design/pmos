import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'
import Sidebar from '../../components/Sidebar'

function renderSidebar(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  it('renders all 8 navigation links', () => {
    renderSidebar()
    expect(screen.getByText('🏠 Dashboard')).toBeInTheDocument()
    expect(screen.getByText('📝 Notes')).toBeInTheDocument()
    expect(screen.getByText('✅ Tasks')).toBeInTheDocument()
    expect(screen.getByText('📅 Calendar')).toBeInTheDocument()
    expect(screen.getByText('📁 Projects')).toBeInTheDocument()
    expect(screen.getByText('📎 Files')).toBeInTheDocument()
    expect(screen.getByText('👤 Profiles')).toBeInTheDocument()
    expect(screen.getByText('⚙️ Settings')).toBeInTheDocument()
  })

  it('renders the PMOS title', () => {
    renderSidebar()
    expect(screen.getByText('PMOS')).toBeInTheDocument()
  })

  it('Notes link points to /notes', () => {
    renderSidebar()
    const link = screen.getByText('📝 Notes')
    expect(link).toHaveAttribute('href', '/notes')
  })

  it('Dashboard link points to /', () => {
    renderSidebar()
    const link = screen.getByText('🏠 Dashboard')
    expect(link).toHaveAttribute('href', '/')
  })

  it('active link has bg-neutral-900 class', () => {
    renderSidebar('/notes')
    const link = screen.getByText('📝 Notes')
    // NavLink applies className callback; active route gets bg-neutral-900
    expect(link.className).toContain('bg-neutral-900')
  })

  it('inactive link does NOT have bg-neutral-900 class', () => {
    renderSidebar('/notes')
    const link = screen.getByText('✅ Tasks')
    expect(link.className).not.toContain('bg-neutral-900')
  })
})
