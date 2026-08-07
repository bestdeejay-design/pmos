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
        className="card w-full max-w-lg rounded-xl border p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Project' : 'New Project'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Goal
            </label>
            <input
              value={goal}
              onChange={e => setGoal(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Status
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as ProjectStatus)}
              className="input"
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
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
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

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Projects</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="btn btn-primary"
        >
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="text-muted">No projects yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(project => (
            <div
              key={project.id}
              className="card rounded-lg border p-4 transition-shadow hover:shadow-md"
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
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {project.description}
                </p>
              )}
              {project.goal && (
                <p className="mt-1 text-xs text-muted">🎯 {project.goal}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setModal({ mode: 'edit', project })}
                  className="btn btn-secondary btn-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="btn btn-danger btn-sm"
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