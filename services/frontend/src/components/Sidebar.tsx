import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: '🏠 Dashboard' },
  { to: '/notes', label: '📝 Notes' },
  { to: '/tasks', label: '✅ Tasks' },
  { to: '/calendar', label: '📅 Calendar' },
  { to: '/projects', label: '📁 Projects' },
  { to: '/files', label: '📎 Files' },
  { to: '/profiles', label: '👤 Profiles' },
  { to: '/settings', label: '⚙️ Settings' },
]

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
      <h1 className="mb-6 text-lg font-bold tracking-tight">PMOS</h1>
      <nav className="flex flex-col gap-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
