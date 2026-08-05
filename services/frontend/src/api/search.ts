import { apiClient } from './client'

const BASE = '/search-rag/v1'

export interface SearchQuery {
  query: string
  type?: 'note' | 'task' | 'meeting' | 'file'
  tags?: string[]
  projectId?: string
  profileIds?: string[]
  limit?: number
  offset?: number
}

export interface SearchHit {
  id: string
  type: string
  title: string
  snippet?: string
  [key: string]: unknown
}

export interface SearchResult {
  results: SearchHit[]
  semantic: boolean
  total: number
}

export const searchApi = {
  search: (query: SearchQuery) =>
    apiClient<SearchResult>(`${BASE}/search`, {
      method: 'POST',
      body: JSON.stringify(query),
    }),
}
