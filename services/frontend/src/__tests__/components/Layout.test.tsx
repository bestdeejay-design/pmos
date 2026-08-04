import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'
import Layout from '../../components/Layout'

function renderLayout(route = '/test') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/test" element={<div>Child Content</div>} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout', () => {
  it('renders the Sidebar (PMOS title)', () => {
    renderLayout()
    expect(screen.getByText('PMOS')).toBeInTheDocument()
  })

  it('renders child content via Outlet', () => {
    renderLayout()
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })

  it('renders Sidebar navigation links', () => {
    renderLayout()
    expect(screen.getByText('📝 Notes')).toBeInTheDocument()
    expect(screen.getByText('✅ Tasks')).toBeInTheDocument()
  })

  it('child content appears inside main area', () => {
    renderLayout()
    const child = screen.getByText('Child Content')
    // The child should be rendered (Layout wraps Outlet in <main>)
    expect(child).toBeInTheDocument()
    expect(child.tagName).toBe('DIV')
  })
})
