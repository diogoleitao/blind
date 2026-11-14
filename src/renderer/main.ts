import { FitAddon } from '@xterm/addon-fit'
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  type IBufferCellPosition,
  type ILink,
  type ILinkProvider,
  type ITerminalOptions,
  Terminal,
} from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { mixColours, withOpacity } from '../core/colours'
import { defaultSettings } from '../core/config'
import type { PaletteResult } from '../core/core'
import type { KeyPress } from '../core/key-bindings'
import type { PaneRect } from '../core/layout'
import { findLinks } from '../core/links'
import type { PaneId } from '../core/state'
import { terminalInput } from '../core/terminal-keys'
import { type Colour, defaultTheme, type Theme } from '../core/themes'
import type { BlindApi, PalettePrompt, SessionView, WindowSettings } from '../shared/ipc'

declare global {
  interface Window {
    blind: BlindApi;
  }
}

// How long after output starts a Pane's scrollback is reported, so a burst of output is reported once.
const reportDelayMilliseconds = 1_000

interface PaneTerminal {
  element: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  search: SearchAddon;
  // Pending while output waits to be reported.
  reportTimer?: ReturnType<typeof setTimeout>;
}

const { blind } = window
const panesElement = document.getElementById('panes')!
const tabBar = document.getElementById('tab-bar')!
const tabsElement = document.getElementById('tabs')!
const sessionLabelPill = document.querySelector('#session-label .pill')!
const terminals = new Map<PaneId, PaneTerminal>()
let focusedPaneId: PaneId | undefined
// Both replaced by the main process's before any terminal opens.
let windowSettings: WindowSettings = {
  scrollbackLines: defaultSettings.scrollbackLines,
  sessionLabelPosition: defaultSettings.sessionLabelPosition,
  panePadding: defaultSettings.panePadding,
  paneScrollBar: defaultSettings.paneScrollBar,
  backgroundTransparency: defaultSettings.backgroundTransparency,
}
let theme: Theme = defaultTheme

// How wide a Pane's scroll bar is. xterm.js takes it from the overview ruler's width, which also keeps that much room
// for the bar beside the text while there is scrollback. The stylesheet needs it to give that room back.
const scrollBarWidth = 8
document.documentElement.style.setProperty('--scroll-bar-width', `${scrollBarWidth}px`)

// The Theme's divider colour pulled a quarter of the way towards its text colour: the dividers between Panes, the
// Bezel and the scroll bar's thumb.
function strongDivider ({ terminal, chrome }: Theme) {
  return mixColours(terminal.foreground, chrome.divider, 0.25)
}

// The terminal's options for the Theme. The terminal's background stays clear, since the page's background shows
// through, keeping the window's transparency and blur.
function terminalOptions (theme: Theme): ITerminalOptions {
  const { font, cursor, terminal } = theme
  const { cursorText, selection, selectionText, ...colours } = terminal
  const scrollBarThumb = strongDivider(theme)
  return {
    fontFamily: `${JSON.stringify(font.family)}, monospace`,
    fontSize: font.size,
    cursorStyle: cursor.style,
    cursorBlink: cursor.blink,
    overviewRuler: { width: scrollBarWidth },
    theme: {
      ...colours,
      background: '#00000000',
      cursorAccent: cursorText,
      selectionBackground: selection,
      selectionForeground: selectionText,
      scrollbarSliderBackground: scrollBarThumb,
      scrollbarSliderHoverBackground: scrollBarThumb,
      scrollbarSliderActiveBackground: scrollBarThumb,
    },
  }
}

// The page's colours, as the CSS variables the stylesheet uses, e.g. `--palette-muted-text`. The terminal's background
// is the window's, as transparent as the backgroundTransparency setting says.
function applyChromeColours (theme: Theme) {
  const { terminal, chrome } = theme
  const root = document.documentElement.style
  const opacity = 1 - windowSettings.backgroundTransparency / 100
  root.setProperty('--window-background', withOpacity(terminal.background, opacity))
  root.setProperty('--strong-divider', strongDivider(theme))
  for (const [name, colour] of Object.entries(chrome)) {
    root.setProperty(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, colour)
  }
}

// Open terminals take the Theme at once; a new font changes how many rows and columns fit.
function applyTheme (next: Theme) {
  theme = next
  applyChromeColours(theme)
  for (const pane of terminals.values()) {
    Object.assign(pane.terminal.options, terminalOptions(theme))
    pane.fit.fit()
  }
}

// Puts a Pane's element at its rectangle, with a divider along each edge it shares with another Pane.
function place (element: HTMLDivElement, rect: PaneRect) {
  Object.assign(element.style, {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  })
  element.classList.toggle('divided-left', rect.x > 0)
  element.classList.toggle('divided-top', rect.y > 0)
}

// The terminal sits inside the Pane's element, so the fit leaves room for the Pane's dividers. The element is placed
// before the terminal opens, so the Shell starts at the Pane's size.
function openPane (rect: PaneRect): PaneTerminal {
  const { paneId } = rect
  const element = document.createElement('div')
  element.className = 'pane'
  place(element, rect)
  const terminalElement = document.createElement('div')
  terminalElement.className = 'terminal'
  element.append(terminalElement)
  panesElement.append(element)
  // Option types macOS's special characters, e.g. `€` for Option+Shift+2, rather than sending Meta sequences.
  const terminal = new Terminal({
    allowTransparency: true,
    ...terminalOptions(theme),
    scrollback: windowSettings.scrollbackLines,
    macOptionIsMeta: false,
    // The search addon highlights matches with decorations, which xterm.js still counts as proposed API.
    allowProposedApi: true,
    // Links a program prints with OSC 8, which the terminal only offers when they're http(s) URLs.
    linkHandler: { activate: (event, uri) => openLinkOnCmdClick(paneId, event, uri) },
  })
  const fit = new FitAddon()
  const serialize = new SerializeAddon()
  const search = new SearchAddon()
  terminal.loadAddon(fit)
  terminal.loadAddon(serialize)
  terminal.loadAddon(search)
  terminal.registerLinkProvider(linkProvider(paneId, terminal))
  terminal.attachCustomKeyEventHandler((event) => {
    const input = terminalInput(keyPress(event))
    if (input === undefined) return true
    if (event.type === 'keydown') terminal.input(input)
    return false
  })
  search.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (findingPaneId === paneId) showFindResults(resultIndex, resultCount)
  })
  terminal.open(terminalElement)
  fit.fit()
  terminal.onData((data) => blind.writeToPane(paneId, data))
  terminal.onResize((size) => blind.resizePane(paneId, size))
  element.addEventListener('mousedown', () => blind.focusPane(paneId))
  blind.attachPane(paneId, { cols: terminal.cols, rows: terminal.rows })
  return { element, terminal, fit, serialize, search }
}

// A browser key event as the `KeyPress` core decides on.
function keyPress ({ key, code, metaKey, shiftKey, altKey, ctrlKey }: KeyboardEvent): KeyPress {
  return { key, code, meta: metaKey, shift: shiftKey, alt: altKey, control: ctrlKey }
}

// A plain click on a link is left to selecting text.
function openLinkOnCmdClick (paneId: PaneId, event: MouseEvent, text: string) {
  if (event.metaKey) blind.openLink(paneId, text)
}

// The text of the buffer line at `y`, one-based, joined with the lines it wraps onto and from, and each of its
// characters' first and last cell. A wide character's two cells hold one character.
function wrappedLine (terminal: Terminal, y: number) {
  const buffer = terminal.buffer.active
  let first = y - 1
  while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1
  let text = ''
  const cells: { start: IBufferCellPosition; end: IBufferCellPosition }[] = []
  for (let row = first; row === first || buffer.getLine(row)?.isWrapped; row += 1) {
    const line = buffer.getLine(row)
    if (!line) break
    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue
      const characters = cell.getChars() || ' '
      text += characters
      for (let unit = 0; unit < characters.length; unit += 1) {
        cells.push({ start: { x: x + 1, y: row + 1 }, end: { x: x + cell.getWidth(), y: row + 1 } })
      }
    }
  }
  return { text, cells }
}

// URLs, and paths to files or folders that exist, on the line and the lines it wraps with, opened by Cmd+click.
function linkProvider (paneId: PaneId, terminal: Terminal): ILinkProvider {
  return {
    provideLinks (y, callback) {
      const { text, cells } = wrappedLine(terminal, y)
      const links = findLinks(text)
        .map((link) => ({ text: link.text, range: { start: cells[link.start].start, end: cells[link.end - 1].end } }))
        .filter(({ range }) => range.start.y <= y && y <= range.end.y)
      if (links.length === 0) return callback(undefined)
      blind.openableLinks(paneId, links.map((link) => link.text)).then((openable) => {
        callback(
          links
            .filter((_, index) => openable[index])
            .map((link) => {
              const provided: ILink = {
                ...link,
                decorations: { underline: cmdHeld, pointerCursor: cmdHeld },
                activate: (event, text) => openLinkOnCmdClick(paneId, event, text),
                hover: () => {
                  hoveredLink = provided
                },
                leave: () => {
                  if (hoveredLink === provided) hoveredLink = undefined
                },
              }
              return provided
            })
        )
      })
    },
  }
}

// Whether Cmd is held, so a link shows its underline and hand cursor only while Cmd+click would open it.
let cmdHeld = false
// The link under the mouse. Once hovered, the terminal watches its decorations for changes.
let hoveredLink: ILink | undefined

function holdCmd (held: boolean) {
  if (held === cmdHeld) return
  cmdHeld = held
  if (hoveredLink?.decorations) Object.assign(hoveredLink.decorations, { underline: held, pointerCursor: held })
}

// Pressing or letting go of Cmd alone is a key event; a mouse move catches up with a Cmd changed while the window
// wasn't listening.
window.addEventListener('keydown', (event) => holdCmd(event.metaKey), true)
window.addEventListener('keyup', (event) => holdCmd(event.metaKey), true)
window.addEventListener('mousemove', (event) => holdCmd(event.metaKey), true)
window.addEventListener('blur', () => holdCmd(false))

// The Pane's terminal clears its scrollback and screen, keeping the line the cursor is on, usually the Shell's prompt.
// A full-screen program's screen is left alone, since clearing would only blank the program's screen while its
// scrollback stays out of reach. Either way the terminal reports what it holds, so Restore brings back no more.
function clearScrollback (paneId: PaneId) {
  const pane = terminals.get(paneId)
  if (!pane) return
  if (pane.terminal.buffer.active.type === 'normal') pane.terminal.clear()
  reportScrollback(paneId, pane)
}

// The text field taking typing, e.g. the Command Palette's or the find bar's; absent while a terminal takes it.
function focusedField () {
  return document.activeElement instanceof HTMLInputElement ? document.activeElement : undefined
}

// Copies what is selected in the focused text field, or else in the focused Pane's terminal. Nothing selected leaves
// the clipboard as it was.
function copySelection () {
  const field = focusedField()
  const selected = field
    ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
    : focusedPaneId && terminals.get(focusedPaneId)?.terminal.getSelection()
  if (selected) blind.copyText(selected)
}

// Into a text field the text goes on one line, replacing what is selected there, as typing it would; the terminal
// takes it as a paste, which programs that ask can tell from typing.
function paste (text: string) {
  const field = focusedField()
  if (!field) {
    if (focusedPaneId) terminals.get(focusedPaneId)?.terminal.paste(text)
    return
  }
  field.setRangeText(text.replace(/\r?\n/g, ' '), field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end')
  field.dispatchEvent(new Event('input'))
}

const findBar = document.getElementById('find')!
const findInput = document.getElementById('find-input') as HTMLInputElement
const findCount = document.getElementById('find-count')!
// The Pane the find bar searches; absent while it's closed.
let findingPaneId: PaneId | undefined

// Every match outlined, the current one selected as well.
function searchOptions ({ terminal }: Theme): ISearchOptions {
  const opaque = (colour: Colour) => colour.slice(0, 7)
  return {
    decorations: {
      matchBorder: opaque(terminal.yellow),
      matchOverviewRuler: opaque(terminal.yellow),
      activeMatchBorder: opaque(terminal.cursor),
      activeMatchColorOverviewRuler: opaque(terminal.cursor),
    },
  }
}

// Without an index, there were more matches than are highlighted.
function showFindResults (resultIndex: number, resultCount: number) {
  if (findInput.value === '') findCount.textContent = ''
  else if (resultCount === 0) findCount.textContent = 'No matches'
  else if (resultIndex === -1) findCount.textContent = `${resultCount}+ matches`
  else findCount.textContent = `${resultIndex + 1} of ${resultCount}`
}

// Opening again, e.g. by Cmd+F while it's open, selects what was searched for, so typing replaces it.
function openFind (paneId: PaneId) {
  if (findingPaneId !== undefined && findingPaneId !== paneId) closeFind()
  findingPaneId = paneId
  findBar.hidden = false
  findInput.focus()
  findInput.select()
}

// The Pane's terminal takes the keyboard back unless the Pane went.
function closeFind () {
  if (findingPaneId === undefined) return
  const pane = terminals.get(findingPaneId)
  findingPaneId = undefined
  findBar.hidden = true
  findCount.textContent = ''
  pane?.search.clearDecorations()
  pane?.terminal.focus()
}

// Typing searches on from the current match, keeping it while it still matches.
function find (direction: 'next' | 'previous', incremental = false) {
  const pane = findingPaneId && terminals.get(findingPaneId)
  if (!pane) return
  if (findInput.value === '') {
    pane.search.clearDecorations()
    showFindResults(-1, 0)
    return
  }
  const options = { ...searchOptions(theme), incremental }
  if (direction === 'next') pane.search.findNext(findInput.value, options)
  else pane.search.findPrevious(findInput.value, options)
}

findInput.addEventListener('input', () => find('next', true))
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFind()
  else if (event.key === 'Enter') find(event.shiftKey ? 'previous' : 'next')
  else return
  event.preventDefault()
})

// A full-screen program's screen and the modes it set belong to a process that won't be there after Restore.
function reportScrollback (paneId: PaneId, pane: PaneTerminal) {
  clearTimeout(pane.reportTimer)
  pane.reportTimer = undefined
  const scrollback = pane.serialize.serialize({
    scrollback: windowSettings.scrollbackLines,
    excludeAltBuffer: true,
    excludeModes: true,
  })
  blind.reportScrollback(paneId, scrollback)
}

// Open terminals keep their scrollback up to the new number of lines from now on. The Session's label moves at once,
// leaving the Tab bar's height, and so the Panes' space, as it was. The background takes the new transparency at once.
// Padding the Panes, or not, hiding their scroll bars, or not, and having scrollback, or not, change the space their
// terminals have, which the stylesheet works out.
function applyWindowSettings (settings: WindowSettings) {
  windowSettings = settings
  for (const pane of terminals.values()) pane.terminal.options.scrollback = settings.scrollbackLines
  tabBar.classList.toggle('label-above', settings.sessionLabelPosition === 'aboveTabs')
  applyChromeColours(theme)
  document.body.classList.toggle('padded-panes', settings.panePadding === 'padded')
  document.body.classList.toggle('scroll-bar-hidden', settings.paneScrollBar === 'none')
  document.body.classList.toggle('has-scrollback', settings.scrollbackLines > 0)
  for (const pane of terminals.values()) pane.fit.fit()
}

function writeToTerminal (paneId: PaneId, data: string) {
  const pane = terminals.get(paneId)
  if (!pane) return
  pane.terminal.write(data)
  pane.reportTimer ??= setTimeout(() => reportScrollback(paneId, pane), reportDelayMilliseconds)
}

// A pill holding the text, which it cuts short with an ellipsis when there's no room.
function pill (text: string) {
  const element = document.createElement('span')
  element.className = 'pill'
  element.textContent = text
  return element
}

// Shown once the Session's view arrives.
function renderTabBar (view: SessionView) {
  tabBar.hidden = false
  sessionLabelPill.textContent = view.sessionLabel
  tabsElement.replaceChildren(
    ...view.tabs.map((tab) => {
      const element = document.createElement('div')
      element.className = 'tab'
      element.classList.toggle('focused', tab.id === view.focusedTabId)
      element.append(pill(tab.title))
      return element
    })
  )
}

const sessionBanner = document.getElementById('session-banner')!
// How long the Session Banner shows in full before its fade, which the stylesheet times.
const sessionBannerHoldMilliseconds = 250
// Pending while the Session Banner shows in full.
let sessionBannerTimer: ReturnType<typeof setTimeout> | undefined

// Shows the Session Banner at once, then fades it out. Showing it again, by another cycle press, starts it over.
function showSessionBanner (label: string) {
  clearTimeout(sessionBannerTimer)
  sessionBanner.textContent = label
  sessionBanner.classList.remove('fading')
  sessionBanner.hidden = false
  sessionBannerTimer = setTimeout(() => sessionBanner.classList.add('fading'), sessionBannerHoldMilliseconds)
}

function hideSessionBanner () {
  clearTimeout(sessionBannerTimer)
  sessionBanner.hidden = true
  sessionBanner.classList.remove('fading')
}

sessionBanner.addEventListener('transitionend', hideSessionBanner)
// Cycling away hides this window, and it keeps no banner for when it's shown again.
window.addEventListener('blur', hideSessionBanner)

// Every Pane's terminal stays open, hidden but laid out, so switching Tabs keeps its scrollback and size.
function render (view: SessionView) {
  renderTabBar(view)
  const panes = view.tabs.flatMap((tab) => tab.panes.map((rect) => ({ tab, rect })))
  const paneIds = new Set(panes.map(({ rect }) => rect.paneId))
  for (const [paneId, pane] of terminals) {
    if (paneIds.has(paneId)) continue
    clearTimeout(pane.reportTimer)
    pane.terminal.dispose()
    pane.element.remove()
    terminals.delete(paneId)
  }
  const focusedTab = view.tabs.find((tab) => tab.id === view.focusedTabId)
  for (const { tab, rect } of panes) {
    const pane = terminals.get(rect.paneId) ?? openPane(rect)
    terminals.set(rect.paneId, pane)
    place(pane.element, rect)
    pane.element.classList.toggle('hidden', tab !== focusedTab)
  }
  // Splits, closed Panes, and the Tab bar appearing or disappearing all change the space the Panes have.
  for (const pane of terminals.values()) pane.fit.fit()
  if (focusedTab && focusedTab.focusedPaneId !== focusedPaneId) {
    // The find bar searches the focused Pane only.
    closeFind()
    focusedPaneId = focusedTab.focusedPaneId
    terminals.get(focusedPaneId)?.terminal.focus()
  }
}

const palette = document.getElementById('palette')!
const paletteInput = document.getElementById('palette-input') as HTMLInputElement
const paletteList = document.getElementById('palette-results')!
let paletteResults: PaletteResult[] = []
let selectedResult = 0
// Counts searches, so that results arriving after a newer search's are dropped.
let searchCount = 0
// Settles once the latest search's results are shown, so Enter never chooses from a list typing has outdated.
let latestSearch = Promise.resolve()
// Set while the palette asks for a name or title instead of searching.
let prompt: PalettePrompt | undefined
// Set while the palette lists the Themes or the menu bar icons instead of searching, each selected one previewed.
let picking: 'theme' | 'menuBarIcon' | undefined
// The choice the next results select, once: the one in effect when the palette started listing them.
let choiceToSelect: string | undefined

const promptPlaceholders: Record<PalettePrompt['type'], string> = {
  askSessionName: 'Session name',
  askTabTitle: 'Tab title, or empty to follow the running program',
}

const resultKinds: Record<PaletteResult['type'], string> = {
  session: 'Session',
  tab: 'Tab',
  pane: 'Pane',
  action: 'Action',
  theme: 'Theme',
  menuBarIcon: 'Menu Bar Icon',
}

// Whether the result is the Current Session, Current Tab or Current Pane, which can be selected but not chosen.
function isCurrent (result: PaletteResult) {
  return 'current' in result && result.current
}

// What kind of result it is, e.g. `Tab`, or `Current Tab` for the Current Tab.
function resultKind (result: PaletteResult) {
  return isCurrent(result) ? `Current ${resultKinds[result.type]}` : resultKinds[result.type]
}

// What places a result: a Closed Session's mark, a Tab's Session, or a Pane's working directory and Session.
function resultDetail (result: PaletteResult) {
  if (result.type === 'session') return result.closed ? 'Closed' : ''
  if (result.type === 'tab') return result.sessionLabel
  if (result.type === 'pane') return `${result.workingDirectory} · ${result.sessionLabel}`
  return ''
}

// How deep the result sits in the nested view; undefined outside it.
function levelOf (result: PaletteResult | undefined) {
  return result && 'level' in result ? result.level : undefined
}

function renderPalette () {
  paletteList.replaceChildren(
    ...paletteResults.map((result, index) => {
      const level = levelOf(result)
      const element = document.createElement('li')
      element.className = 'result'
      element.classList.toggle('selected', index === selectedResult)
      element.classList.toggle('current', isCurrent(result))
      element.classList.toggle('top-level', level === 0)
      element.classList.toggle('parent', level === 0 && Boolean(levelOf(paletteResults[index + 1])))
      if (level) element.classList.add(`level-${level}`)
      // A nested Tab or Pane shows its title alone under its Session or Tab.
      const label = document.createElement('span')
      label.textContent = level ? `↳ ${result.label}` : result.label
      const detail = document.createElement('span')
      detail.className = 'detail'
      detail.textContent = level ? '' : resultDetail(result)
      const kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = resultKind(result)
      element.append(label, detail, kind)
      element.addEventListener('mousedown', () => chooseResult(index))
      return element
    })
  )
  paletteList.children[selectedResult]?.scrollIntoView({ block: 'nearest' })
}

// The Theme's name or the menu bar icon a result is; absent for any other result.
function choiceOf (result: PaletteResult) {
  if (result.type === 'theme') return result.name
  if (result.type === 'menuBarIcon') return result.icon
  return undefined
}

// Puts the selected Theme or menu bar icon in effect while the palette lists them.
function previewSelectedChoice () {
  const result = paletteResults[selectedResult]
  if (picking === 'theme' && result?.type === 'theme') blind.previewTheme(result.name)
  if (picking === 'menuBarIcon' && result?.type === 'menuBarIcon') blind.previewMenuBarIcon(result.icon)
}

const pickerSearches = {
  theme: blind.searchThemes,
  menuBarIcon: blind.searchMenuBarIcons,
}

function searchPalette () {
  searchCount += 1
  const search = searchCount
  const searching = picking ? pickerSearches[picking] : blind.searchPalette
  latestSearch = searching(paletteInput.value).then((results) => {
    if (search !== searchCount) return
    paletteResults = results
    selectedResult = Math.max(
      0,
      results.findIndex((result) => choiceToSelect !== undefined && choiceOf(result) === choiceToSelect)
    )
    choiceToSelect = undefined
    renderPalette()
    previewSelectedChoice()
  })
}

function openPalette () {
  prompt = undefined
  picking = undefined
  palette.hidden = false
  paletteInput.placeholder = ''
  paletteInput.value = ''
  paletteInput.focus()
  searchPalette()
}

// Offers the suggestion selected, so typing replaces it and Enter accepts it. A search still in flight is dropped.
function openPrompt (asked: PalettePrompt) {
  prompt = asked
  picking = undefined
  searchCount += 1
  paletteResults = []
  renderPalette()
  palette.hidden = false
  paletteInput.placeholder = promptPlaceholders[asked.type]
  paletteInput.value = asked.suggestion
  paletteInput.focus()
  paletteInput.select()
}

const pickerPlaceholders = {
  theme: 'Theme',
  menuBarIcon: 'Menu bar icon',
}

// Lists the Themes or the menu bar icons with the one in effect selected. Choosing one keeps it; dismissing restores
// the one from before.
function openPicker (kind: NonNullable<typeof picking>, inEffect: string) {
  prompt = undefined
  picking = kind
  choiceToSelect = inEffect
  palette.hidden = false
  paletteInput.placeholder = pickerPlaceholders[kind]
  paletteInput.value = ''
  paletteInput.focus()
  searchPalette()
}

// The focused Pane's terminal takes the keyboard back.
function closePalette () {
  if (palette.hidden) return
  palette.hidden = true
  prompt = undefined
  picking = undefined
  if (focusedPaneId) terminals.get(focusedPaneId)?.terminal.focus()
}

// Closing without a choice, by Escape or by clicking away. Choosing closes the palette first, so a blur that follows
// isn't taken for one.
function dismissPalette () {
  if (palette.hidden) return
  closePalette()
  blind.dismissPalette()
}

// The typed text answers the prompt that was showing; `closePalette` clears it.
function answerPrompt (shown: PalettePrompt) {
  const answer = paletteInput.value
  closePalette()
  blind.answerPalettePrompt(shown, answer)
}

// Does nothing once the palette has closed, e.g. by Escape while Enter waited for a search. Choosing where the user
// already is does nothing either, and leaves the palette open.
function chooseResult (index: number) {
  const result = paletteResults[index]
  if (palette.hidden || !result || isCurrent(result)) return
  closePalette()
  blind.choosePaletteResult(result)
}

function moveSelection (offset: number) {
  const count = paletteResults.length
  if (count === 0) return
  selectedResult = (selectedResult + offset + count) % count
  renderPalette()
  previewSelectedChoice()
}

paletteInput.addEventListener('input', () => {
  if (!prompt) searchPalette()
})
paletteInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dismissPalette()
  else if (event.key === 'Enter' && prompt) answerPrompt(prompt)
  else if (prompt) return
  else if (event.key === 'ArrowDown') moveSelection(1)
  else if (event.key === 'ArrowUp') moveSelection(-1)
  else if (event.key === 'Enter') latestSearch.then(() => chooseResult(selectedResult))
  else return
  event.preventDefault()
})
// Clicks inside the palette keep the input focused; clicking a Pane, or the app hiding, closes the palette.
palette.addEventListener('mousedown', (event) => {
  if (event.target !== paletteInput) event.preventDefault()
})
paletteInput.addEventListener('blur', dismissPalette)

applyChromeColours(theme)
blind.onWindowSettings(applyWindowSettings)
blind.onShowSessionBanner(showSessionBanner)
blind.onTheme(applyTheme)
blind.onOpenPalette(openPalette)
blind.onPickTheme(() => openPicker('theme', theme.name))
blind.onPickMenuBarIcon((icon) => openPicker('menuBarIcon', icon))
blind.onPalettePrompt(openPrompt)
blind.onPaneData(writeToTerminal)
blind.onFlushScrollback(() => terminals.forEach((pane, paneId) => reportScrollback(paneId, pane)))
blind.onSessionView(render)
blind.onFindInPane(openFind)
blind.onClearScrollback(clearScrollback)
blind.onCopy(copySelection)
blind.onPaste(paste)
window.addEventListener('resize', () => {
  for (const pane of terminals.values()) pane.fit.fit()
})
