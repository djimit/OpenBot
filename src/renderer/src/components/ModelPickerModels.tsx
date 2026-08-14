import { useMemo, useState, type ReactNode } from 'react'
import type { BackendInfo, ModelInfo } from '../../../shared/types'
import { formatContext } from '../lib/format'
import { IconCheck, IconChevronDown, IconChevronRight, IconSearch } from './Icons'

/**
 * Slugs of the form `<provider>/<model>` carry a real grouping — pi returns one
 * group per machine or cluster it can reach, opencode one per upstream vendor.
 * Split on the FIRST slash only: model names legitimately contain more.
 */
function splitSlug(id: string): { provider: string | null; name: string } {
  const at = id.indexOf('/')
  if (at <= 0 || at === id.length - 1) return { provider: null, name: id }
  return { provider: id.slice(0, at), name: id.slice(at + 1) }
}

interface Group {
  key: string
  label: string | null
  items: ModelInfo[]
}

function groupModels(models: ModelInfo[], query: string): Group[] {
  const needle = query.trim().toLowerCase()
  const matched = needle
    ? models.filter((m) => {
        const { provider, name } = splitSlug(m.id)
        // Searching a provider name should reveal everything under it.
        return (
          name.toLowerCase().includes(needle) ||
          (provider ?? '').toLowerCase().includes(needle) ||
          (m.label ?? '').toLowerCase().includes(needle)
        )
      })
    : models

  const order: string[] = []
  const byProvider = new Map<string, ModelInfo[]>()
  for (const model of matched) {
    const key = splitSlug(model.id).provider ?? ''
    if (!byProvider.has(key)) {
      byProvider.set(key, [])
      order.push(key)
    }
    byProvider.get(key)?.push(model)
  }
  return order.map((key) => ({ key: key || 'ungrouped', label: key || null, items: byProvider.get(key) ?? [] }))
}

function ModelRow({
  model,
  selected,
  indented,
  onPick
}: {
  model: ModelInfo
  selected: boolean
  indented: boolean
  onPick: () => void
}): ReactNode {
  const { name } = splitSlug(model.id)
  const context = formatContext(model.contextWindow)
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`ob-menu-item ob-menu-model${indented ? ' is-indented' : ''}`}
      title={context ? `${model.label || name} · ${context}` : model.label || name}
      onClick={onPick}
    >
      <span className="ob-menu-label">{model.label || name}</span>
      {model.supportsVision ? <span className="ob-menu-tag">vision</span> : null}
      {selected ? <IconCheck size={12} /> : null}
    </button>
  )
}

/** Level two: models within one agent, grouped by their upstream provider. */
export function ModelMenu({
  backend,
  backendId,
  modelId,
  onPick
}: {
  backend: BackendInfo
  backendId: string
  modelId: string
  onPick: (modelId: string) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupModels(backend.models, query), [backend.models, query])

  // Only the group holding the current model starts open; searching opens all.
  const selectedGroup = splitSlug(modelId).provider ?? 'ungrouped'
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searching = query.trim().length > 0

  const isOpen = (g: Group): boolean => {
    if (searching) return true
    if (g.key in collapsed) return !collapsed[g.key]
    return groups.length === 1 || g.key === selectedGroup
  }

  const grouped = groups.length > 1 || (groups[0]?.label ?? null) !== null

  return (
    <>
      {backend.models.length > 6 ? (
        <div className="ob-menu-search">
          <IconSearch size={12} />
          <input
            type="text"
            value={query}
            autoFocus
            placeholder="Search models or providers"
            aria-label="Search models or providers"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}

      {backend.models.length === 0 ? (
        <p className="ob-menu-empty">No models reported yet.</p>
      ) : null}
      {searching && groups.length === 0 ? <p className="ob-menu-empty">No match.</p> : null}

      {groups.map((group) =>
        !grouped || !group.label ? (
          group.items.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              indented={false}
              selected={backend.id === backendId && model.id === modelId}
              onPick={() => onPick(model.id)}
            />
          ))
        ) : (
          <div key={group.key}>
            <button
              type="button"
              className="ob-menu-item ob-menu-group"
              aria-expanded={isOpen(group)}
              onClick={() => setCollapsed((c) => ({ ...c, [group.key]: isOpen(group) }))}
            >
              {isOpen(group) ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              <span className="ob-menu-label">{group.label}</span>
              <span className="ob-menu-count">{group.items.length}</span>
            </button>
            {isOpen(group)
              ? group.items.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    indented
                    selected={backend.id === backendId && model.id === modelId}
                    onPick={() => onPick(model.id)}
                  />
                ))
              : null}
          </div>
        )
      )}
    </>
  )
}
