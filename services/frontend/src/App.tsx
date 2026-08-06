import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Notes from './pages/Notes'
import Tasks from './pages/Tasks'
import Calendar from './pages/Calendar'
import Projects from './pages/Projects'
import Files from './pages/Files'
import Profiles from './pages/Profiles'
import Settings from './pages/Settings'
import Search from './pages/Search'
import TimeStats from './pages/TimeStats'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="notes" element={<Notes />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="projects" element={<Projects />} />
        <Route path="files" element={<Files />} />
        <Route path="profiles" element={<Profiles />} />
        <Route path="settings" element={<Settings />} />
        <Route path="search" element={<Search />} />
        <Route path="time" element={<TimeStats />} />
      </Route>
    </Routes>
  )
}
