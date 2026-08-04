import { useState, useEffect, type FormEvent } from 'react'
import { projectsApi } from '../api/projects'
import type { Project, ProjectStatus } from '../api/types'

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'archived', 'completed']

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: 'bg-green-100 text-green-700',
  archived: 'bg-neutral-200 text-neutral-600',
  completed: 'bg-blue-100 text-blue-700',
}

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; project: Project }

function ProjectModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Project | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      name,
      description: description || undefined,
      goal: goal || undefined,
      status,
    }
    try {
      if (initial) {
        await projectsApi.update(initial.id, payload)
      } else {
        await projectsApi.create(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Project' : 'New Project'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Goal
            </label>
            <input
              value={goal}
              onChange={e => setGoal(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Status
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as ProjectStatus)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

  const load = () => {
    setLoading(true)
    projectsApi
      .list()
      .then(setProjects)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    try {
      await projectsApi.delete(id)
      setProjects(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="text-neutral-500">No projects yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(project => (
            <div
              key={project.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{project.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[project.status]}`}
                >
                  {project.status}
                </span>
              </div>
              {project.description && (
                <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                  {project.description}
                </p>
              )}
              {project.goal && (
                <p className="mt-1 text-xs text-neutral-400">🎯 {project.goal}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setModal({ mode: 'edit', project })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ProjectModal
          initial={modal.mode === 'edit' ? modal.project : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </div>
  )
}