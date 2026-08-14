import type { ReactNode } from 'react'
import { store, useAppState } from '../state'
import { ComputerFrame } from './ComputerFrame'
import { IconClose } from './Icons'
import { TodoList } from './TodoList'
import './RightRail.css'

/** Side panel: what the agent is doing, and what it has left to do. */
export function RightRail(): ReactNode {
  const { todos } = useAppState()

  return (
    <aside className="ob-rail" aria-label="Activity">
      <div className="ob-rail-head">
        <span className="ob-rail-head-title">Activity</span>
        <button type="button" className="ob-icon-btn" aria-label="Hide the side panel" onClick={() => store.toggleRail()}>
          <IconClose size={12} />
        </button>
      </div>
      <div className="ob-rail-scroll">
        <ComputerFrame />
        <TodoList todos={todos} />
      </div>
    </aside>
  )
}
