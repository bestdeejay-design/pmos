import { useState, useEffect, type FormEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  KeyboardSensor,
  defaultKeyboardCoordinateGetter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { tasksApi } from '../api/tasks'
import { settingsApi } from '../api/settings'
import type { Task, TaskStatus } from '../api/types'

const DEFAULT_COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'backlog', label: 'Backlog', color: 'bg-neutral-100' },
  { status: 'todo', label: 'To Do', color: 'bg-blue-50' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-yellow-50' },
  { status: 'done', label: 'Done', color: 'bg-green-50' },
]

interface KanbanColumn {
  status: TaskStatus
  label: string
  color: string
}

function NewTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await tasksApi.create({ title, priority })
      setTitle('')
      setPriority(1)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card mb-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
    >
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-sm font-medium text-muted">
          Title
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="New task…"
          className="input"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-muted">
          Priority
        </label>
        <input
          type="number"
          min={0}
          value={priority}
          onChange={e => setPriority(Number(e.target.value))}
          className="input w-24"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="btn btn-primary"
      >
        {saving ? 'Adding…' : '+ Add Task'}
      </button>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </form>
  )
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

interface SortableTaskCardProps {
  task: Task
  onDelete: (id: string) => void
  onStatusChange: (id: string, status: TaskStatus) => void
}

function SortableTaskCard({
  task,
  onDelete,
  onStatusChange,
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-line bg-panel p-3 shadow-sm"
    >
      <div
        {...attributes}
        {...listeners}
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
      >
        <p className="text-sm font-medium">{task.title}</p>
        <button
          onClick={() => onDelete(task.id)}
          className="shrink-0 text-xs text-red-400 hover:text-red-300"
          aria-label="Delete task"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">P{task.priority}</p>
      <select
        value={task.status}
        onChange={e => onStatusChange(task.id, e.target.value as TaskStatus)}
        aria-label="Task status"
        className="mt-2 w-full cursor-pointer rounded border border-line bg-panel-2 px-1.5 py-1 text-xs text-muted"
      >
        {STATUS_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface KanbanColumnProps {
  column: KanbanColumn
  tasks: Task[]
  onDelete: (id: string) => void
  onStatusChange: (id: string, status: TaskStatus) => void
}

function KanbanColumn({
  column,
  tasks,
  onDelete,
  onStatusChange,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })

  return (
    <div
      ref={setNodeRef}
      onDragOver={e => e.preventDefault()}
      data-column-status={column.status}
      className={`rounded-lg p-4 ${column.color} ${
        isOver ? 'ring-2 ring-accent' : ''
      }`}
    >
      <h2 className="mb-3 font-semibold text-ink">{column.label}</h2>
      <SortableContext
        items={tasks.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 min-h-[200px]">
          {tasks.map(task => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onDelete={onDelete}
              onStatusChange={onStatusChange}
            />
          ))}
          {tasks.length === 0 && (
            <p className="text-xs text-muted text-center py-4">Empty</p>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

function DragOverlayComponent({ task }: { task: Task | null }) {
  return (
    <DragOverlay>
      {task ? (
        <div className="rounded-md border border-line bg-panel-2 p-3 shadow-lg rotate-1 scale-105">
          <p className="text-sm font-medium">{task.title}</p>
        </div>
      ) : null}
    </DragOverlay>
  )
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [columns, setColumns] = useState<KanbanColumn[]>(DEFAULT_COLUMNS)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const loadTasks = () => {
    setLoading(true)
    tasksApi
      .list()
      .then(setTasks)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  const loadColumns = async () => {
    try {
      const settings = await settingsApi.list()
      const kanbanSetting = settings.find(s => s.key === 'kanban_columns')
      if (kanbanSetting && Array.isArray(kanbanSetting.value)) {
        const loadedColumns = kanbanSetting.value as KanbanColumn[]
        if (loadedColumns.length > 0) {
          setColumns(loadedColumns)
        }
      }
    } catch {
      // Fallback to default columns on error
    }
  }

  useEffect(() => {
    loadTasks()
    loadColumns()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: defaultKeyboardCoordinateGetter,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const taskId = event.active.id as string
    setActiveTask(tasks.find(t => t.id === taskId) ?? null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over || !over.id) return

    const taskId = active.id as string
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const targetStatus =
      columns.find(c => c.status === over.id)?.status ??
      tasks.find(t => t.id === over.id)?.status

    if (!targetStatus || task.status === targetStatus) return

    try {
      const updated = await tasksApi.update(taskId, { status: targetStatus })
      setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await tasksApi.delete(id)
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleStatusChange = async (id: string, status: TaskStatus) => {
    try {
      const updated = await tasksApi.update(id, { status })
      setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  if (loading) return <div className="animate-pulse text-muted">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <h1 className="section-title mb-6">Tasks</h1>
      <NewTaskForm onCreated={loadTasks} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map(column => (
            <KanbanColumn
              key={column.status}
              column={column}
              tasks={tasks.filter(t => t.status === column.status)}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
        <DragOverlayComponent task={activeTask} />
      </DndContext>
    </div>
  )
}
