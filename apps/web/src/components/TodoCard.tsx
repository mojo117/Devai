import { useMemo } from 'react'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface TodoCardProps {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '\u25CB',
  in_progress: '\u25D4',
  completed: '\u2714',
}

const STATUS_CLASS: Record<TodoItem['status'], string> = {
  pending: 'todo-pending',
  in_progress: 'todo-in-progress',
  completed: 'todo-completed',
}

export function TodoCard({ todos }: TodoCardProps) {
  const completed = useMemo(() => todos.filter((t) => t.status === 'completed').length, [todos])
  const allDone = completed === todos.length && todos.length > 0

  if (todos.length === 0) return null

  if (allDone) {
    return (
      <div className="todo-card todo-card-done">
        <span className="todo-summary">{STATUS_ICON.completed} {completed}/{todos.length} Aufgaben erledigt</span>
      </div>
    )
  }

  return (
    <div className="todo-card">
      <div className="todo-header">Chapo's Aufgaben</div>
      <ul className="todo-list">
        {todos.map((todo, i) => (
          <li key={i} className={STATUS_CLASS[todo.status]}>
            <span className="todo-icon">{STATUS_ICON[todo.status]}</span>
            <span className={todo.status === 'completed' ? 'todo-text-done' : 'todo-text'}>
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
      <div className="todo-progress">{completed}/{todos.length} erledigt</div>
    </div>
  )
}
