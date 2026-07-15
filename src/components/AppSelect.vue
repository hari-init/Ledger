<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'

interface Option {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: Option[]
    placeholder?: string
    disabled?: boolean
    /** popup edge alignment */
    align?: 'left' | 'right'
    /** extra classes for the trigger button */
    buttonClass?: string
  }>(),
  { placeholder: 'Select…', disabled: false, align: 'left', buttonClass: '' },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const activeIndex = ref(-1)
const root = ref<HTMLElement>()
const uid = Math.random().toString(36).slice(2, 8)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder,
)

function openMenu() {
  if (props.disabled) return
  open.value = true
  activeIndex.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  )
}
function closeMenu() {
  open.value = false
  activeIndex.value = -1
}
function toggle() {
  open.value ? closeMenu() : openMenu()
}
function choose(i: number) {
  const opt = props.options[i]
  if (!opt) return
  emit('update:modelValue', opt.value)
  closeMenu()
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      openMenu()
    }
    return
  }
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      activeIndex.value = Math.min(props.options.length - 1, activeIndex.value + 1)
      scrollActiveIntoView()
      break
    case 'ArrowUp':
      e.preventDefault()
      activeIndex.value = Math.max(0, activeIndex.value - 1)
      scrollActiveIntoView()
      break
    case 'Home':
      e.preventDefault()
      activeIndex.value = 0
      scrollActiveIntoView()
      break
    case 'End':
      e.preventDefault()
      activeIndex.value = props.options.length - 1
      scrollActiveIntoView()
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      choose(activeIndex.value)
      break
    case 'Escape':
      e.preventDefault()
      closeMenu()
      break
    case 'Tab':
      closeMenu()
      break
  }
}

async function scrollActiveIntoView() {
  await nextTick()
  root.value?.querySelector<HTMLElement>(`#${uid}-opt-${activeIndex.value}`)?.scrollIntoView({
    block: 'nearest',
  })
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) closeMenu()
}
document.addEventListener('click', onDocClick)
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="relative inline-block" :class="buttonClass.includes('w-') ? '' : 'w-full'">
    <button
      type="button"
      class="app-select-trigger"
      :class="buttonClass"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-activedescendant="open ? `${uid}-opt-${activeIndex}` : undefined"
      :disabled="disabled"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="truncate">{{ selectedLabel }}</span>
      <span class="app-select-caret" aria-hidden="true">▾</span>
    </button>

    <ul
      v-if="open"
      class="app-select-menu"
      :class="align === 'right' ? 'right-0' : 'left-0'"
      role="listbox"
    >
      <li
        v-for="(o, i) in options"
        :id="`${uid}-opt-${i}`"
        :key="o.value"
        role="option"
        :aria-selected="o.value === modelValue"
        class="app-select-option"
        :class="{
          'is-active': i === activeIndex,
          'is-selected': o.value === modelValue,
        }"
        @click="choose(i)"
        @mousemove="activeIndex = i"
      >
        {{ o.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.app-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  background: var(--paper);
  border: 1px solid var(--line);
  padding: 0.5rem 0.625rem;
  font: inherit;
  font-size: 0.875rem;
  /* match the app's native <input>/.btn (Tailwind text-sm) so heights line up */
  line-height: 1.25rem;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  outline: none;
}
.app-select-trigger:focus-visible {
  border-color: var(--accent);
}
.app-select-trigger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.app-select-caret {
  color: var(--muted);
  font-size: 10px;
  flex-shrink: 0;
}
.app-select-menu {
  position: absolute;
  z-index: 50;
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
  min-width: 100%;
  max-height: 15rem;
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.app-select-option {
  padding: 0.375rem 0.625rem;
  font-size: 0.875rem;
  color: var(--ink);
  white-space: nowrap;
  cursor: pointer;
}
.app-select-option.is-active {
  background: var(--accent-soft);
}
.app-select-option.is-selected {
  background: var(--accent);
  color: var(--paper);
}
</style>
