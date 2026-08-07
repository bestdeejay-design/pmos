import { NavLink } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useTheme } from '../hooks/useTheme'

const links = [
  { to: '/', label: '🏠 Dashboard' },
  { to: '/notes', label: '📝 Notes' },
  { to: '/tasks', label: '✅ Tasks' },
  { to: '/calendar', label: '📅 Calendar' },
  { to: '/projects', label: '📁 Projects' },
  { to: '/files', label: '📎 Files' },
  { to: '/search', label: '🔍 Search' },
  { to: '/time', label: '⏱️ Время' },
  { to: '/profiles', label: '👤 Profiles' },
  { to: '/settings', label: '⚙️ Settings' },
]

const PROFILE_CHIPS: { name: string; color: string }[] = [
  { name: 'Work', color: 'var(--work)' },
  { name: 'Home', color: 'var(--home)' },
  { name: 'Family', color: 'var(--family)' },
  { name: 'Friends', color: 'var(--friends)' },
]

export default function Sidebar() {
  const { theme, toggle } = useTheme()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-5 pb-2 pt-5">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <h1 className="text-base font-extrabold tracking-wide">PMOS</h1>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `nav-link ${isActive ? 'nav-link-active bg-neutral-900' : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Profiles
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_CHIPS.map(chip => (
            <span
              key={chip.name}
              className="chip chip-active"
              style={{ '--chip-c': chip.color } as CSSProperties}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: chip.color }}
              />
              {chip.name}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={toggle}
          className="btn btn-secondary w-full"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>
    </aside>
  )
}
