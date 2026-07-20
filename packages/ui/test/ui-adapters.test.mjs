import assert from "node:assert/strict"
import test from "node:test"
import { Window } from "happy-dom"

const window = new Window({ url: "http://ladybug.local/" })
Object.assign(globalThis, {
  window,
  document: window.document,
  Document: window.Document,
  ShadowRoot: window.ShadowRoot,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLDialogElement: window.HTMLDialogElement,
  MutationObserver: window.MutationObserver,
  KeyboardEvent: window.KeyboardEvent,
  CSS: window.CSS,
})

const { installUiAdapters } = await import("../ui-adapters.ts")

test("adapter provides tab keyboard selection", () => {
  document.body.innerHTML = '<div role="tablist"><button role="tab">One</button><button role="tab">Two</button></div>'
  const tabs = document.querySelectorAll("button")
  let selected = ""
  tabs[1].addEventListener("click", () => { selected = "two" })
  const dispose = installUiAdapters(document)
  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  assert.equal(selected, "two")
  assert.equal(document.activeElement, tabs[1])
  dispose()
})

test("adapter wires command navigation and selection", () => {
  document.body.innerHTML = '<div data-ui="command"><input data-ui="command-input"><div data-ui="command-list"><button data-ui="command-item">First</button><button data-ui="command-item">Second</button></div></div>'
  const input = document.querySelector("input")
  let selected = false
  document.querySelectorAll("button")[0].addEventListener("click", () => { selected = true })
  const dispose = installUiAdapters(document)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  assert.match(input.getAttribute("aria-activedescendant"), /^ui-command-option-/)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(selected, true)
  dispose()
})

test("adapter reconciles a controlled command selection", async () => {
  document.body.innerHTML = '<div data-ui="command"><input data-ui="command-input"><div data-ui="command-list"><button data-ui="command-item" data-selected="true">First</button><button data-ui="command-item" data-selected="false">Second</button></div></div>'
  const input = document.querySelector("input")
  const list = document.querySelector('[data-ui="command-list"]')
  let selected = ""
  document.querySelectorAll("button")[0].addEventListener("click", () => { selected = "first" })
  const dispose = installUiAdapters(document)
  assert.equal(input.getAttribute("aria-activedescendant"), document.querySelectorAll("button")[0].id)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(selected, "first")
  list.innerHTML = '<button data-ui="command-item" data-selected="false">First</button><button data-ui="command-item" data-selected="true">Second</button>'
  await Promise.resolve()
  assert.equal(input.getAttribute("aria-activedescendant"), document.querySelectorAll("button")[1].id)
  dispose()
})

test("adapter reconciles attribute-only controlled command changes", async () => {
  document.body.innerHTML = '<div data-ui="command"><input data-ui="command-input"><div data-ui="command-list"><button data-ui="command-item" data-selected="true">First</button><button data-ui="command-item" data-selected="false">Second</button></div></div>'
  const input = document.querySelector("input")
  const items = document.querySelectorAll("button")
  let selected = ""
  items[0].addEventListener("click", () => { selected = "first" })
  items[1].addEventListener("click", () => { selected = "second" })
  const dispose = installUiAdapters(document)
  items[0].dataset.selected = "false"
  items[0].setAttribute("aria-selected", "false")
  items[1].dataset.selected = "true"
  items[1].setAttribute("aria-selected", "true")
  await Promise.resolve()
  assert.equal(input.getAttribute("aria-activedescendant"), items[1].id)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(selected, "second")
  dispose()
})

test("adapter clears command activity when controlled selection clears", async () => {
  document.body.innerHTML = '<div data-ui="command"><input data-ui="command-input"><div data-ui="command-list"><button data-ui="command-item" data-selected="true">First</button></div></div>'
  const input = document.querySelector("input")
  const item = document.querySelector("button")
  let selected = false
  item.addEventListener("click", () => { selected = true })
  const dispose = installUiAdapters(document)
  item.dataset.selected = "false"
  item.setAttribute("aria-selected", "false")
  await Promise.resolve()
  assert.equal(input.hasAttribute("aria-activedescendant"), false)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  assert.equal(selected, false)
  dispose()
})

test("adapter positions and dismisses a focused tooltip", () => {
  document.body.innerHTML = '<span data-ui="tooltip"><button data-ui="tooltip-trigger">Help</button><span data-ui="tooltip-content" data-side="top">Details</span></span>'
  const trigger = document.querySelector("button")
  const tooltip = document.querySelector('[data-ui="tooltip"]')
  const content = document.querySelector('[data-ui="tooltip-content"]')
  const dispose = installUiAdapters(document)
  trigger.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }))
  assert.equal(content.dataset.positioned, "true")
  assert.equal(content.style.bottom, "auto")
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  assert.equal(tooltip.dataset.dismissed, "true")
  dispose()
})

test("input-group addons focus either supported control", () => {
  document.body.innerHTML = '<div data-ui="input-group"><span data-ui="input-group-addon">Prefix</span><input></div><div data-ui="input-group"><span data-ui="input-group-addon">Prompt</span><textarea></textarea></div>'
  const addons = document.querySelectorAll('[data-ui="input-group-addon"]')
  const controls = document.querySelectorAll("input, textarea")
  const dispose = installUiAdapters(document)
  addons[0].click()
  assert.equal(document.activeElement, controls[0])
  addons[1].click()
  assert.equal(document.activeElement, controls[1])
  dispose()
})

test("adapter dismisses timed toasts", async () => {
  document.body.innerHTML = '<section data-ui="toast" data-duration="5"><button data-ui="toast-dismiss">Dismiss</button></section>'
  let dismissed = false
  document.querySelector("button").addEventListener("click", () => { dismissed = true })
  const dispose = installUiAdapters(document)
  await new Promise((resolve) => window.setTimeout(resolve, 15))
  assert.equal(dismissed, true)
  dispose()
})

test("changing a toast revision restarts its timeout", async () => {
  document.body.innerHTML = '<section data-ui="toast" data-duration="30" data-revision="1"><button data-ui="toast-dismiss">Dismiss</button></section>'
  const toast = document.querySelector('[data-ui="toast"]')
  let dismissed = false
  document.querySelector("button").addEventListener("click", () => { dismissed = true })
  const dispose = installUiAdapters(document)
  await new Promise((resolve) => window.setTimeout(resolve, 15))
  toast.dataset.revision = "2"
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  assert.equal(dismissed, false)
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  assert.equal(dismissed, true)
  dispose()
})

test("a replacement toast receives a fresh timer", async () => {
  document.body.innerHTML = '<section data-ui="toast" data-duration="30"><button data-ui="toast-dismiss">Dismiss</button></section>'
  let dismissed = false
  const dispose = installUiAdapters(document)
  await new Promise((resolve) => window.setTimeout(resolve, 15))
  const replacement = document.createElement("section")
  replacement.dataset.ui = "toast"
  replacement.dataset.duration = "30"
  replacement.innerHTML = '<button data-ui="toast-dismiss">Dismiss</button>'
  replacement.querySelector("button").addEventListener("click", () => { dismissed = true })
  document.querySelector('[data-ui="toast"]').replaceWith(replacement)
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  assert.equal(dismissed, false)
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  assert.equal(dismissed, true)
  dispose()
})
