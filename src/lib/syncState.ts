import { reactive } from 'vue'

/**
 * Sync progress lives at module level, not in the Sync page component,
 * so an in-flight sync keeps its log and busy flag when the user
 * navigates between tabs.
 */
export const syncState = reactive<{
  busy: boolean
  lines: string[]
}>({
  busy: false,
  lines: [],
})

export function syncLog(s: string) {
  syncState.lines.push(
    `${new Date().toLocaleTimeString('en-CA', { hour12: false })}  ${s}`,
  )
  if (syncState.lines.length > 200) syncState.lines.splice(0, syncState.lines.length - 200)
}
