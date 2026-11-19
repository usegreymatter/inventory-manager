// Lifecycle: living. Harness-only SDK mapping; never loaded by Hermes.
import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
const h = React.createElement
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar'
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcriptDirectives'
export const TITLEBAR_AREAS = { center: 'titleBar.center', left: 'titleBar.left', right: 'titleBar.right' }
export const atom = initial => {
  let value = initial
  const listeners = new Set()
  return { get: () => value, set: next => { value = next; listeners.forEach(listener => listener()) },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
}
export const useValue = store => useSyncExternalStore(store.subscribe, store.get, store.get)
// Testable collection of the same contribution payloads the SDK receives.
export function createHarnessContext(storage) {
  const entries = [], settings = []
  return { entries, settings, storage, register: entry => entries.push(entry), registerSettingsPage: page => settings.push(page) }
}
const DialogContext = createContext(null)
export const Dialog = ({ open, onOpenChange, children }) => h(DialogContext.Provider, { value: { open, onOpenChange } }, open ? children : null)
export const DialogContent = ({ children, style }) => {
  const { onOpenChange } = useContext(DialogContext)
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return h('dialog', { ref, style, 'aria-labelledby': 'quick-title', 'aria-describedby': 'quick-description',
    onCancel: event => { event.preventDefault(); onOpenChange(false) } },
    h('button', { className: 'dialog-close', 'aria-label': 'Close', onClick: () => onOpenChange(false) }, '×'), children)
}
export const DialogHeader = ({ children }) => h('header', null, children)
export const DialogTitle = ({ children }) => h('h2', { id: 'quick-title' }, children)
export const DialogDescription = ({ children }) => h('p', { id: 'quick-description' }, children)
export const host = { navigate: path => { window.location.hash = path } }
export const Button = ({ children, variant, size, ...props }) => {
  // Fault only the page's product rows, never the independently wrapped quick view or status bar.
  if (globalThis.runwayHarnessRenderFailure && props['aria-label']?.includes(' · L · '))
    throw Error('Synthetic render failure: PRIVATE must never be shown')
  return h('button', props, children)
}
export const Badge = ({ children, variant }) => h('strong', { className: 'badge', 'data-variant': variant }, children)
export const StatusDot = ({ tone }) => h('span', { className: `dot ${tone}`, 'aria-hidden': true })
export const EmptyState = ({ title, description }) => h('section', null, h('h2', null, title), h('p', null, description))
export const SegmentedControl = ({ options, value, onChange }) => h('div', { role: 'group', 'aria-label': 'Data source', className: 'segments' }, options.map(option =>
  h('button', { key: option.id, type: 'button', 'aria-pressed': value === option.id, onClick: () => onChange(option.id) }, option.label)))
const SelectContext = createContext(null)
export const Select = ({ value, onValueChange, children }) => {
  // The host exposes the trigger as the control. Our native select must inherit
  // that trigger's name, including aria-labelledby's link to the visible label.
  const trigger = React.Children.toArray(children).find(child => child.type === SelectTrigger)
  const naming = { 'aria-label': trigger?.props['aria-label'], 'aria-labelledby': trigger?.props['aria-labelledby'] }
  return h(SelectContext.Provider, { value: { value, onValueChange, naming } }, children)
}
export const SelectTrigger = ({ children, 'aria-label': label, 'aria-labelledby': labelledBy, ...props }) => h('span', props, children)
export const SelectValue = () => null
export const SelectContent = ({ children }) => {
  const { value, onValueChange, naming } = useContext(SelectContext)
  return h('select', { value, onChange: e => onValueChange(e.target.value), ...naming }, children)
}
export const SelectItem = ({ value, children }) => h('option', { value }, children)
