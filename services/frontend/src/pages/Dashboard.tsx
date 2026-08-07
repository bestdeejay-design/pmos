import { usePushes } from '../hooks/usePushes'

export default function Dashboard() {
  const { lastMessage, connected } = usePushes()
  return (
    <div>
      <h1 className="section-title mb-1">Dashboard</h1>
      <p className="section-sub">Welcome to PMOS.</p>
      <div className="card rounded-lg border p-4">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? 'bg-green-500' : 'bg-neutral-500'
            }`}
          />
          <span className={connected ? 'text-green-500' : 'text-muted'}>
            {connected ? 'live' : 'offline'}
          </span>
          {lastMessage && (
            <span className="text-muted">last push {lastMessage.ts}</span>
          )}
        </div>
      </div>
    </div>
  )
}
