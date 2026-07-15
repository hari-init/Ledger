import { liveQuery } from 'dexie'
import { ref, onUnmounted, type Ref } from 'vue'

/** Subscribe a Vue ref to a Dexie live query. Re-runs on any table change. */
export function useLiveQuery<T>(querier: () => T | Promise<T>, initial: T): Ref<T> {
  const r = ref(initial) as Ref<T>
  const sub = liveQuery(querier).subscribe({
    next: (v) => (r.value = v),
    error: (e) => console.error('liveQuery error', e),
  })
  onUnmounted(() => sub.unsubscribe())
  return r
}
