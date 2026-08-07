import { useState, useEffect, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { notesApi } from '../api/notes'
import type { Note } from '../api/types'

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; note: Note }

function NoteModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Note | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [bodyMd, setBodyMd] = useState(initial?.bodyMd ?? '')
  const [tagsText, setTagsText] = useState(initial?.tags.join(', ') ?? '')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const tags = tagsText
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    try {
      if (initial) {
        await notesApi.update(initial.id, { title, bodyMd, tags })
      } else {
        await notesApi.create({ title, bodyMd, tags })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note')
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
          {initial ? 'Edit Note' : 'New Note'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Title
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="input"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="mb-1 block text-sm font-medium text-muted">
              Body (Markdown)
            </label>
            <button
              type="button"
              onClick={() => setPreview(p => !p)}
              className="text-sm text-muted underline hover:text-ink"
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="min-h-[120px] rounded-lg border border-line bg-surface px-3 py-2 text-sm prose prose-sm max-w-none">
              <ReactMarkdown>{bodyMd}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              value={bodyMd}
              onChange={e => setBodyMd(e.target.value)}
              required
              rows={5}
              className="input"
            />
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Tags (comma-separated)
            </label>
            <input
              value={tagsText}
              onChange={e => setTagsText(e.target.value)}
              placeholder="work, ideas, inbox"
              className="input"
            />
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

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

  const load = () => {
    setLoading(true)
    notesApi
      .list()
      .then(setNotes)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    try {
      await notesApi.delete(id)
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleArchive = async (note: Note) => {
    try {
      const updated = await notesApi.update(note.id, { isArchived: !note.isArchived })
      setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    }
  }

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Notes</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="btn btn-primary"
        >
          + New Note
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-muted">No notes yet.</p>
      ) : (
        <div className="grid gap-4">
          {notes.map(note => (
            <div
              key={note.id}
              className="card rounded-lg border p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold">{note.title}</h2>
                  <div className="mt-1 max-h-24 overflow-hidden text-sm text-muted prose prose-sm max-w-none">
                    <ReactMarkdown>{note.bodyMd}</ReactMarkdown>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setModal({ mode: 'edit', note })}
                    className="btn btn-secondary btn-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleArchive(note)}
                    className="btn btn-secondary btn-sm"
                  >
                    {note.isArchived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="btn btn-danger btn-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {note.tags.map(tag => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
                {note.isArchived && (
                  <span className="badge">archived</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <NoteModal
          initial={modal.mode === 'edit' ? modal.note : null}
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
