import { useState, useEffect, type FormEvent } from 'react'
import { profilesApi } from '../api/profiles'
import type { Profile } from '../api/types'

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; profile: Profile }

function ProfileModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Profile | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? '#6366f1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (initial) {
        await profilesApi.update(initial.id, { name, color })
      } else {
        await profilesApi.create({ name, color })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-md rounded-xl border p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Profile' : 'New Profile'}
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
              Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-line bg-surface"
              />
              <span className="text-sm text-muted">{color}</span>
            </div>
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

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const load = () => {
    setLoading(true)
    profilesApi
      .list()
      .then(setProfiles)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    try {
      await profilesApi.delete(id)
      setProfiles(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await profilesApi.activate(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate')
    }
  }

  const handleHide = async (id: string) => {
    try {
      await profilesApi.hide(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to hide')
    }
  }

  const handleUnhide = async (id: string) => {
    try {
      await profilesApi.unhide(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unhide')
    }
  }

  const visibleProfiles = showHidden ? profiles : profiles.filter(p => !p.hidden)

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Profiles</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={e => setShowHidden(e.target.checked)}
              className="rounded border-line accent-[var(--accent)]"
            />
            Show hidden
          </label>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="btn btn-primary"
          >
            + New Profile
          </button>
        </div>
      </div>

      {visibleProfiles.length === 0 ? (
        <p className="text-muted">
          {showHidden ? 'No profiles yet.' : 'No visible profiles. Check "Show hidden" to see hidden profiles.'}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleProfiles.map(profile => (
            <div
              key={profile.id}
              className="card flex items-center justify-between gap-3 rounded-lg border p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-8 w-8 shrink-0 rounded-full"
                  style={{ backgroundColor: profile.color }}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{profile.name}</h2>
                    {profile.isActive && (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Active
                      </span>
                    )}
                    {profile.hidden && (
                      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{profile.color}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {!profile.isActive && (
                  <button
                    onClick={() => handleActivate(profile.id)}
                    className="btn btn-secondary btn-sm"
                    title="Set as active"
                  >
                    Activate
                  </button>
                )}
                {profile.hidden ? (
                  <button
                    onClick={() => handleUnhide(profile.id)}
                    className="btn btn-secondary btn-sm"
                    title="Unhide profile"
                  >
                    Unhide
                  </button>
                ) : (
                  <button
                    onClick={() => handleHide(profile.id)}
                    className="btn btn-secondary btn-sm"
                    title="Hide profile"
                  >
                    Hide
                  </button>
                )}
                <button
                  onClick={() => setModal({ mode: 'edit', profile })}
                  className="btn btn-secondary btn-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(profile.id)}
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
        <ProfileModal
          initial={modal.mode === 'edit' ? modal.profile : null}
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