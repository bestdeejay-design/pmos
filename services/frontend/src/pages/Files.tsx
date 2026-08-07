import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { filesApi } from '../api/files'
import type { FileMeta } from '../api/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Files() {
  const [files, setFiles] = useState<FileMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true)
    filesApi
      .list()
      .then(setFiles)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await filesApi.upload(file)
      if (fileInputRef.current) fileInputRef.current.value = ''
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (file: FileMeta) => {
    try {
      const blob = await filesApi.download(file.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await filesApi.delete(id)
      setFiles(prev => prev.filter(f => f.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="section-title">Files</h1>
        <label className="btn btn-primary cursor-pointer">
          {uploading ? 'Uploading…' : '+ Upload File'}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {error && <div className="mb-4 text-red-500">Error: {error}</div>}

      {files.length === 0 ? (
        <p className="text-muted">No files uploaded.</p>
      ) : (
        <div className="card overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-panel-2 text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr key={file.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-medium">{file.filename}</td>
                  <td className="px-4 py-2 text-muted">{file.mimeType}</td>
                  <td className="px-4 py-2 text-muted">
                    {formatSize(file.size)}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleDownload(file)}
                        className="btn btn-secondary btn-sm"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(file.id)}
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
    </div>
  )
}