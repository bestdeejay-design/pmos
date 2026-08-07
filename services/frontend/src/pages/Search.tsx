import { useState, useEffect, type FormEvent } from 'react'
import { searchApi, type SearchResult, type SearchHit } from '../api/search'

const HISTORY_KEY = 'pmos_search_history'
const MAX_HISTORY = 10

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed.filter(q => typeof q === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {
    // localStorage unavailable — ignore
  }
}

export default function Search() {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const runSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await searchApi.search({ query: trimmed })
      setResult(res)
      const next = [trimmed, ...history.filter(h => h !== trimmed)]
      const capped = next.slice(0, MAX_HISTORY)
      setHistory(capped)
      saveHistory(capped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    runSearch(query)
  }

  const clearHistory = () => {
    setHistory([])
    saveHistory([])
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Search</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="card mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium text-muted">
            Query
          </label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes, tasks, meetings, files…"
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn btn-primary"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {error && <p className="w-full text-sm text-red-500">{error}</p>}
      </form>

      {history.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Recent</h2>
            <button
              onClick={clearHistory}
              className="text-xs text-muted underline hover:text-ink"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map(q => (
              <button
                key={q}
                onClick={() => {
                  setQuery(q)
                  runSearch(q)
                }}
                className="chip"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div>
          <p className="mb-3 text-sm text-muted">
            {result.total} result{result.total === 1 ? '' : 's'}
            {result.semantic ? ' · semantic' : ''}
          </p>
          {result.results.length === 0 ? (
            <p className="text-muted">No results.</p>
          ) : (
            <div className="space-y-2">
              {result.results.map((hit: SearchHit) => (
                <div
                  key={hit.id}
                  className="card rounded-lg border p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="badge uppercase">{hit.type}</span>
                    <h3 className="font-semibold">{hit.title}</h3>
                  </div>
                  {hit.snippet && (
                    <p className="mt-1 text-sm text-muted">{hit.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}