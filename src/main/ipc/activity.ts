import type { ActivityItem, AgentTask } from '../../shared/types'
import { clearActivity, listActivity, markActivityRead } from '../store/activity'
import { listTasks } from '../store/tasks'
import { cancelBackgroundTask, startBackgroundTask } from '../tasks'
import { CHANNELS } from './channels'
import { emptyArray, handle, handleVoid, nullResult } from './handler'
import { asId, asString } from './validate'

export function registerActivityIpc(): void {
  handle<ActivityItem[]>(CHANNELS.activityList, () => listActivity(), emptyArray)
  handleVoid(CHANNELS.activityMarkRead, ([id]) => markActivityRead(id === undefined ? undefined : asId(id)))
  handleVoid(CHANNELS.activityClear, () => clearActivity())

  handle<AgentTask[]>(CHANNELS.tasksList, () => listTasks(), emptyArray)
  handle<AgentTask | null>(CHANNELS.tasksCreate, ([botId, prompt, title]) => {
    const id = asId(botId)
    const body = asString(prompt, 100_000).trim()
    const label = title === undefined ? body.slice(0, 80) : asString(title, 200).trim()
    return startBackgroundTask(id, body, label)
  }, nullResult)
  handle<AgentTask | null>(
    CHANNELS.tasksCancel,
    ([taskId]) => cancelBackgroundTask(asId(taskId)),
    nullResult
  )
}
