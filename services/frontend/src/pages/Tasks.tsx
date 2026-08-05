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
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-sm font-medium text-neutral-700">
          Title
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="New task…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">
          Priority
        </label>
        <input
          type="number"
          min={0}
          value={priority}
          onChange={e => setPriority(Number(e.target.value))}
          className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {saving ? 'Adding…' : '+ Add Task'}
      </button>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </form>
  )
}

interface SortableTaskCardProps {
  task: Task
  onDelete: (id: string) => void
}

function SortableTaskCard({ task, onDelete }: SortableTaskCardProps) {
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
      className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm"
    >
      <div
        {...attributes}
        {...listeners}
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
      >
        <p className="text-sm font-medium">{task.title}</p>
        <button
          onClick={() => onDelete(task.id)}
          className="shrink-0 text-xs text-red-500 hover:text-red-700"
          aria-label="Delete task"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">P{task.priority}</p>
    </div>
  )
}

interface KanbanColumnProps {
  column: KanbanColumn
  tasks: Task[]
  onDelete: (id: string) => void
}

function KanbanColumn({ column, tasks, onDelete }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })

  return (
    <div
      ref={setNodeRef}
      onDragOver={e => e.preventDefault()}
      data-column-status={column.status}
      className={`rounded-lg p-4 ${column.color} ${
        isOver ? 'ring-2 ring-neutral-400' : ''
      }`}
    >
      <h2 className="mb-3 font-semibold">{column.label}</h2>
      <SortableContext
        items={tasks.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 min-h-[200px]">
          {tasks.map(task => (
            <SortableTaskCard key={task.id} task={task} onDelete={onDelete} />
          ))}
          {tasks.length === 0 && (
            <p className="text-xs text-neutral-400 text-center py-4">Empty</p>
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
        <div className="rounded-md border border-neutral-300 bg-white p-3 shadow-lg rotate-1 scale-105">
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

  if (loading) return <div className="animate-pulse text-neutral-400">Loading…</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Tasks</h1>
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
            />
          ))}
        </div>
        <DragOverlayComponent task={activeTask} />
      </DndContext>
    </div>
  )
}