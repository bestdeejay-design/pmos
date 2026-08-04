import { useState, useEffect, type FormEvent } from 'react'
import { settingsApi } from '../api/settings'
import type { Setting } from '../api/types'

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; setting: Setting }

function SettingModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Setting | null
  onClose: () => void
  onSaved: () => void
}) {
  const [key, setKey] = useState(initial?.key ?? '')
  const [valueText, setValueText] = useState(
    initial ? JSON.stringify(initial.value, null, 2) : '{}',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    let value: Record<string, unknown>
    try {
      value = JSON.parse(valueText) as Record<string, unknown>
    } catch {
      setError('Value must be valid JSON')
      setSaving(false)
      return
    }
    try {
      if (initial) {
        await settingsApi.update(initial.key, value)
      } else {
        await settingsApi.upsert({ key, value })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setting')
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
          {initial ? 'Edit Setting' : 'New Setting'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Key
            </label>
            <input
              value={key}
              onChange={e => setKey(e.target.value)}
              required
              disabled={initial !== null}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none disabled:bg-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Value (JSON)
            </label>
            <textarea
              value={valueText}
              onChange={e => setValueText(e.target.value)}
              required
              rows={6}
              spellCheck={false}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
            />
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

export default function Settings() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsDegraded, setModelsDegraded] = useState(false)

  const load = () => {
    setLoading(true)
    settingsApi
      .list()
      .then(setSettings)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    settingsApi
      .ollamaModels()
      .then(res => {
        setModels(res.models)
        setModelsDegraded(res.degraded)
      })
      .catch(() => {
        setModels([])
        setModelsDegraded(true)
      })
  }, [])

  const handleDelete = async (key: string) => {
    try {
      await settingsApi.delete(key)
      setSettings(prev => prev.filter(s => s.key !== key))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          + Add Setting
        </button>
      </div>

      {settings.length === 0 ? (
        <p className="text-neutral-500">No settings configured.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {settings.map(setting => (
                <tr key={setting.key} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{setting.key}</td>
                  <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-neutral-500">
                    {JSON.stringify(setting.value)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', setting })}
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(setting.key)}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Ollama Models</h2>
        {modelsDegraded ? (
          <p className="text-sm text-neutral-500">
            Ollama is unavailable — running in degraded mode.
          </p>
        ) : models.length === 0 ? (
          <p className="text-sm text-neutral-500">No models available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map(model => (
              <span
                key={model}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
              >
                {model}
              </span>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <SettingModal
          initial={modal.mode === 'edit' ? modal.setting : null}
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