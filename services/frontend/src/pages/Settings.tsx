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
        className="card w-full max-w-lg rounded-xl border p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-bold">
          {initial ? 'Edit Setting' : 'New Setting'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Key
            </label>
            <input
              value={key}
              onChange={e => setKey(e.target.value)}
              required
              disabled={initial !== null}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              Value (JSON)
            </label>
            <textarea
              value={valueText}
              onChange={e => setValueText(e.target.value)}
              required
              rows={6}
              spellCheck={false}
              className="input font-mono text-xs"
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

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Settings</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="btn btn-primary"
        >
          + Add Setting
        </button>
      </div>

      {settings.length === 0 ? (
        <p className="text-muted">No settings configured.</p>
      ) : (
        <div className="card overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-panel-2 text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {settings.map(setting => (
                <tr key={setting.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-medium">{setting.key}</td>
                  <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-muted">
                    {JSON.stringify(setting.value)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', setting })}
                        className="btn btn-secondary btn-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(setting.key)}
                        className="btn btn-danger btn-sm"
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

      <div className="card mt-8 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Ollama Models</h2>
        {modelsDegraded ? (
          <p className="text-sm text-muted">
            Ollama is unavailable — running in degraded mode.
          </p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted">No models available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map(model => (
              <span key={model} className="tag">
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