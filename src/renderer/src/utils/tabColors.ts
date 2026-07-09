/**
 * Fixed palette offered by the tab context menu's "Tab color" picker. Stored
 * as raw hex on `EditorTab.color` so the choice is theme-independent and
 * survives workspace serialization untouched. Values are drawn from the DPlex
 * accent ramp so they read clearly against both the dark and light chrome.
 */
export interface TabColorOption {
  id: string
  label: string
  value: string
}

export const TAB_COLORS: TabColorOption[] = [
  { id: 'red', label: 'Red', value: '#F87171' },
  { id: 'orange', label: 'Orange', value: '#FB923C' },
  { id: 'amber', label: 'Amber', value: '#F59E0B' },
  { id: 'green', label: 'Green', value: '#34D399' },
  { id: 'cyan', label: 'Cyan', value: '#22D3EE' },
  { id: 'blue', label: 'Blue', value: '#60A5FA' },
  { id: 'violet', label: 'Violet', value: '#A78BFA' },
  { id: 'pink', label: 'Pink', value: '#F472B6' }
]
