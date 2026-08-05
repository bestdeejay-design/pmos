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
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium text-neutral-700">
            Query
          </label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes, tasks, meetings, files…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {error && <p className="w-full text-sm text-red-500">{error}</p>}
      </form>

      {history.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700">Recent</h2>
            <button
              onClick={clearHistory}
              className="text-xs text-neutral-400 underline hover:text-neutral-600"
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
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div>
          <p className="mb-3 text-sm text-neutral-500">
            {result.total} result{result.total === 1 ? '' : 's'}
            {result.semantic ? ' · semantic' : ''}
          </p>
          {result.results.length === 0 ? (
            <p className="text-neutral-500">No results.</p>
          ) : (
            <div className="space-y-2">
              {result.results.map((hit: SearchHit) => (
                <div
                  key={hit.id}
                  className="rounded-lg border border-neutral-200 bg-white p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs uppercase text-neutral-500">
                      {hit.type}
                    </span>
                    <h3 className="font-semibold">{hit.title}</h3>
                  </div>
                  {hit.snippet && (
                    <p className="mt-1 text-sm text-neutral-500">{hit.snippet}</p>
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