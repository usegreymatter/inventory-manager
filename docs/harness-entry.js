// Lifecycle: living. Real plugin contributions; shim UI, not the real Desktop.
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import plugin, { encodeCard, quickData } from '../desktop/plugin.js'
import { createHarnessContext, PALETTE_AREA, KEYBINDS_AREA, TRANSCRIPT_DIRECTIVE_AREA } from './sdk-shim.js'
import stressFixtureTemplates from '../tests/fixtures/visual-stress.json'
import { expandStressFixtures } from './stress-fixtures.mjs'
const stressFixtures = expandStressFixtures(stressFixtureTemplates)
// This entry and its controls are offline developer tools, never plugin contributions.
const params = new URLSearchParams(location.search)
const fixtureMode = params.get('data') || 'demo'
const fixture = stressFixtures[fixtureMode]
if (fixture) {
  localStorage.setItem('runway-harness.csv_data', JSON.stringify(fixture))
  localStorage.setItem('runway-harness.source', JSON.stringify('csv'))
} else if (params.has('data')) localStorage.setItem('runway-harness.source', JSON.stringify('sample'))
if (params.get('dir') === 'rtl') document.getElementById('root').dir = 'rtl'
const ctx = createHarnessContext({
  get: (key, fallback) => JSON.parse(localStorage.getItem(`runway-harness.${key}`) ?? JSON.stringify(fallback)),
  set: (key, value) => localStorage.setItem(`runway-harness.${key}`, JSON.stringify(value)),
  remove: key => localStorage.removeItem(`runway-harness.${key}`),
})
plugin.register(ctx)
const h = React.createElement
const quick = ctx.entries.find(entry => entry.area === PALETTE_AREA && entry.data.id === 'stock-runway.quick-view')
const shortcut = ctx.entries.find(entry => entry.area === KEYBINDS_AREA)
const directive = ctx.entries.find(entry => entry.area === TRANSCRIPT_DIRECTIVE_AREA)
// Capture can substitute the actual Python tool's card; otherwise use the same JS DTO.
const card = () => {
  const line = window.stockRunwayCard || encodeCard(quickData(ctx))
  const match = /^::stock-runway\{data="([A-Za-z0-9_-]+)"\}$/.exec(line)
  return match ? directive.data.render({ attrs: { data: match[1] }, streaming: false, sessionId: null }) : null
}
window.runwayCaughtErrors = []
window.runwayDialogHostReady = false
const root = createRoot(document.getElementById('root'), {
  ...(window.runwayCaptureCaughtErrors ? {
    onCaughtError: (error, info) => window.runwayCaughtErrors.push({ message: error.message, componentStack: info.componentStack }),
  } : {}),
})
// Fixed developer chrome must never cover the last real control. Reserve its
// actual wrapped height without moving the page's initial content downward.
function reserveToolbarSpace(toolbar) {
  const style = document.documentElement.style
  const update = () => style.setProperty('--stress-controls-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`)
  update()
  const observer = new ResizeObserver(update)
  observer.observe(toolbar)
  return () => { observer.disconnect(); style.removeProperty('--stress-controls-height') }
}
function Harness() {
  const toolbar = useRef(null)
  useEffect(() => reserveToolbarSpace(toolbar.current), [])
  const [statusbarVisible, setStatusbarVisible] = useState(true)
  const [simple, setSimple] = useState(false)
  const [titlebarVisible, setTitlebarVisible] = useState(true)
  // Child QuickView mount effects run before this parent effect.
  useEffect(() => {
    window.runwayDialogHostReady = titlebarVisible
    return () => { window.runwayDialogHostReady = false }
  }, [titlebarVisible])
  window.runwayShell = { setStatusbarVisible, setSimple, setTitlebarVisible }
  useEffect(() => { if (location.hash === '#popup') quick.data.run() }, [])
  return h(React.Fragment, null,
  h('nav', { ref: toolbar, className: 'stress-controls', 'aria-label': 'Developer synthetic fixtures' },
    [['demo', 'Demo data'], ['worst', 'Worst case'], ['empty', 'Empty'], ['one', 'One'], ['thousand', '1,000 rows'], ['future', 'Year 9998']].map(([id, title]) =>
      h('button', { key: id, type: 'button', 'aria-pressed': fixtureMode === id, onClick: () => {
        const url = new URL(location.href); url.searchParams.set('data', id); location.assign(url.href)
      } }, title))),
  h('div', { className: 'title-bar' }, titlebarVisible && ctx.entries.filter(e => e.area === 'titleBar.center')
    .map(e => h(React.Fragment, { key: e.id }, e.render()))),
  h('div', { className: 'harness-actions' }, h('button', { onClick: quick.data.run }, 'Stock Runway: quick view')),
  location.hash === '#card' ? h('article', { className: 'chat-card', 'aria-label': 'Assistant message' },
    h('p', null, 'Underlay runs out first, in Nov 2026; this is sample data.'), card())
    : location.hash === '#settings' ? ctx.settings[0].render() : ctx.entries.find(e => e.area === 'routes').render(),
  statusbarVisible && !simple && h('footer', { className: 'status-bar' }, ctx.entries.filter(e => e.area === 'statusBar.right').map(e => h(React.Fragment, { key: e.id }, e.render()))),
)
}
let generation = 0
const render = () => root.render(h(Harness, { key: generation }))
// Local synthetic fault injection only; this module is never installed in Desktop.
window.runwayTest = { ctx, remount: () => { window.runwayDialogHostReady = false; generation++; render() } }
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
    event.preventDefault(); shortcut.data.run()
  }
})
window.addEventListener('hashchange', render)
render()
