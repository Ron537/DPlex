import { useState, useCallback } from 'react'

type DropPosition = 'above' | 'below'

interface ReorderableState {
  draggedId: string | null
  dragOverId: string | null
  dropPosition: DropPosition
}

interface ReorderableHandlers {
  onDragStart: (id: string) => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  /** Container-level handler for drops in empty space. */
  onContainerDragOver: (e: React.DragEvent, items: { id: string }[]) => void
  onContainerDrop: (e: React.DragEvent) => void
}

interface ReorderableResult extends ReorderableState {
  handlers: ReorderableHandlers
  isDragging: (id: string) => boolean
  dragOverPosition: (id: string) => DropPosition | null
}

/**
 * Generic drag-and-drop reordering hook.
 * Extracts common DnD logic for sortable lists.
 */
export function useReorderable(
  onReorder: (draggedId: string, targetId: string, position: DropPosition) => void
): ReorderableResult {
  const [state, setState] = useState<ReorderableState>({
    draggedId: null,
    dragOverId: null,
    dropPosition: 'above'
  })

  const onDragStart = useCallback((id: string) => {
    setState((prev) => ({ ...prev, draggedId: id }))
  }, [])

  const onDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const clientY = e.clientY
    setState((prev) => {
      if (!prev.draggedId || id === prev.draggedId) return prev
      const midY = rect.top + rect.height / 2
      const position: DropPosition = clientY < midY ? 'above' : 'below'
      return { ...prev, dragOverId: id, dropPosition: position }
    })
  }, [])

  const onDrop = useCallback(
    (targetId: string) => {
      if (state.draggedId && state.draggedId !== targetId) {
        onReorder(state.draggedId, targetId, state.dropPosition)
      }
      setState({ draggedId: null, dragOverId: null, dropPosition: 'above' })
    },
    [state.draggedId, state.dropPosition, onReorder]
  )

  const onDragEnd = useCallback(() => {
    setState({ draggedId: null, dragOverId: null, dropPosition: 'above' })
  }, [])

  const onContainerDragOver = useCallback(
    (e: React.DragEvent, items: { id: string }[]) => {
      if (!state.draggedId || items.length === 0) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // If cursor is in empty space, snap to first or last item
      const target = e.target as HTMLElement
      if (target.closest('[data-reorderable-id]')) return
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (e.clientY < midY) {
        const firstId = items[0].id
        if (firstId !== state.draggedId) {
          setState((prev) => ({ ...prev, dragOverId: firstId, dropPosition: 'above' }))
        }
      } else {
        const lastId = items[items.length - 1].id
        if (lastId !== state.draggedId) {
          setState((prev) => ({ ...prev, dragOverId: lastId, dropPosition: 'below' }))
        }
      }
    },
    [state.draggedId]
  )

  const onContainerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (state.dragOverId && state.draggedId && state.draggedId !== state.dragOverId) {
        onReorder(state.draggedId, state.dragOverId, state.dropPosition)
      }
      setState({ draggedId: null, dragOverId: null, dropPosition: 'above' })
    },
    [state.draggedId, state.dragOverId, state.dropPosition, onReorder]
  )

  const isDragging = useCallback(
    (id: string) => state.draggedId === id,
    [state.draggedId]
  )

  const dragOverPosition = useCallback(
    (id: string): DropPosition | null =>
      state.dragOverId === id ? state.dropPosition : null,
    [state.dragOverId, state.dropPosition]
  )

  return {
    ...state,
    handlers: {
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd,
      onContainerDragOver,
      onContainerDrop
    },
    isDragging,
    dragOverPosition
  }
}
