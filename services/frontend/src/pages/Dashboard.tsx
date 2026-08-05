import { usePushes } from '../hooks/usePushes'

export default function Dashboard() {
  const { lastMessage, connected } = usePushes()
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-neutral-500">Welcome to PMOS.</p>
      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className={connected ? 'text-green-600' : 'text-neutral-400'}>
          {connected ? '🔔 live' : '🔔 offline'}
        </span>
        {lastMessage && (
          <span className="text-neutral-500">last push {lastMessage.ts}</span>
        )}
      </div>
    </div>
  )
}
