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
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Profile' : 'New Profile'}
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
              Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-neutral-300"
              />
              <span className="text-sm text-neutral-500">{color}</span>
            </div>
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

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

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

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Profiles</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          + New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <p className="text-neutral-500">No profiles yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map(profile => (
            <div
              key={profile.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-8 w-8 shrink-0 rounded-full"
                  style={{ backgroundColor: profile.color }}
                />
                <div>
                  <h2 className="font-semibold">{profile.name}</h2>
                  <p className="text-xs text-neutral-400">{profile.color}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setModal({ mode: 'edit', profile })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(profile.id)}
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