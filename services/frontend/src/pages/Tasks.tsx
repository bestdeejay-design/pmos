import { useState, useEffect, type FormEvent } from 'react'
import { tasksApi } from '../api/tasks'
import type { Task, TaskStatus } from '../api/types'

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'backlog', label: 'Backlog', color: 'bg-neutral-100' },
  { status: 'todo', label: 'To Do', color: 'bg-blue-50' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-yellow-50' },
  { status: 'done', label: 'Done', color: 'bg-green-50' },
]

const STATUS_OPTIONS: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'archived',
]

function NewTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await tasksApi.create({ title, priority })
      setTitle('')
      setPriority(1)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-sm font-medium text-neutral-700">
          Title
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="New task…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">
          Priority
        </label>
        <input
          type="number"
          min={0}
          value={priority}
          onChange={e => setPriority(Number(e.target.value))}
          className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {saving ? 'Adding…' : '+ Add Task'}
      </button>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </form>
  )
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    tasksApi
      .list()
      .then(setTasks)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleStatusChange = async (task: Task, status: TaskStatus) => {
    try {
      const updated = await tasksApi.update(task.id, { status })
      setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await tasksApi.delete(id)
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Tasks</h1>
      <NewTaskForm onCreated={load} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map(col => (
          <div key={col.status} className={`rounded-lg p-4 ${col.color}`}>
            <h2 className="mb-3 font-semibold">{col.label}</h2>
            <div className="space-y-2">
              {tasks
                .filter(t => t.status === col.status)
                .map(task => (
                  <div
                    key={task.id}
                    className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{task.title}</p>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="shrink-0 text-xs text-red-500 hover:text-red-700"
                        aria-label="Delete task"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">P{task.priority}</p>
                    <select
                      value={task.status}
                      onChange={e =>
                        handleStatusChange(task, e.target.value as TaskStatus)
                      }
                      className="mt-2 w-full rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none"
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              {tasks.filter(t => t.status === col.status).length === 0 && (
                <p className="text-xs text-neutral-400">Empty</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}