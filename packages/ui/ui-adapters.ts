/** Browser behavior for pure-Voyd primitives that need DOM-only capabilities. */
export function installUiAdapters(root: Document | HTMLElement | ShadowRoot = document): () => void {
  let commandSequence = 0
  const toastTimers = new Map<Element, { timer: number; duration: number; revision: string }>()
  const ownerDocument = root.nodeType === 9 ? root as Document : root.ownerDocument
  const view = ownerDocument?.defaultView ?? globalThis.window

  const syncDialog = (dialog: HTMLDialogElement) => {
    const shouldOpen = dialog.dataset.open === "true"
    if (shouldOpen && !dialog.open && dialog.isConnected) dialog.showModal()
    if (!shouldOpen && dialog.open) dialog.close()
  }

  const syncCommand = (command: HTMLElement) => {
    const input = command.querySelector<HTMLInputElement>('[data-ui="command-input"]')
    const list = command.querySelector<HTMLElement>('[data-ui="command-list"]')
    if (!input || !list) return
    const suffix = String(++commandSequence)
    if (!list.id) list.id = `ui-command-list-${suffix}`
    input.setAttribute("role", "combobox")
    input.setAttribute("aria-autocomplete", "list")
    input.setAttribute("aria-expanded", "true")
    input.setAttribute("aria-controls", list.id)
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-ui="command-item"]'))
    for (const item of items) if (!item.id) item.id = `ui-command-option-${++commandSequence}`
    const selected = items.find((item) => item.dataset.selected === "true")
    if (selected) input.setAttribute("aria-activedescendant", selected.id)
    else input.removeAttribute("aria-activedescendant")
    const activeId = input.getAttribute("aria-activedescendant")
    if (activeId && !list.querySelector(`#${CSS.escape(activeId)}`)) input.removeAttribute("aria-activedescendant")
  }

  const syncToast = (toast: HTMLElement) => {
    const duration = Number(toast.dataset.duration)
    const revision = toast.dataset.revision ?? ""
    const current = toastTimers.get(toast)
    if (current?.duration === duration && current.revision === revision) return
    if (current) window.clearTimeout(current.timer)
    if (!Number.isFinite(duration) || duration <= 0) {
      toastTimers.delete(toast)
      return
    }
    const timer = window.setTimeout(() => {
      toast.querySelector<HTMLButtonElement>('[data-ui="toast-dismiss"]')?.click()
      toastTimers.delete(toast)
    }, duration)
    toastTimers.set(toast, { timer, duration, revision })
  }

  const positionTooltip = (tooltip: HTMLElement) => {
    if (!view) return
    const trigger = tooltip.querySelector<HTMLElement>('[data-ui="tooltip-trigger"]')
    const content = tooltip.querySelector<HTMLElement>('[data-ui="tooltip-content"]')
    if (!trigger || !content) return
    content.style.position = "fixed"
    content.style.left = "0px"
    content.style.top = "0px"
    content.style.right = "auto"
    content.style.bottom = "auto"
    content.style.transform = "none"
    content.style.maxWidth = `${Math.max(0, view.innerWidth - 16)}px`
    const triggerRect = trigger.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const gap = 8
    const margin = 8
    let side = content.dataset.side ?? "top"
    let left = triggerRect.left + (triggerRect.width - contentRect.width) / 2
    let top = triggerRect.top - contentRect.height - gap

    if (side === "bottom") top = triggerRect.bottom + gap
    if (side === "left") {
      left = triggerRect.left - contentRect.width - gap
      top = triggerRect.top + (triggerRect.height - contentRect.height) / 2
    }
    if (side === "right") {
      left = triggerRect.right + gap
      top = triggerRect.top + (triggerRect.height - contentRect.height) / 2
    }
    if (side === "top" && top < margin) {
      side = "bottom"
      top = triggerRect.bottom + gap
    } else if (side === "bottom" && top + contentRect.height > view.innerHeight - margin) {
      side = "top"
      top = triggerRect.top - contentRect.height - gap
    } else if (side === "left" && left < margin) {
      side = "right"
      left = triggerRect.right + gap
    } else if (side === "right" && left + contentRect.width > view.innerWidth - margin) {
      side = "left"
      left = triggerRect.left - contentRect.width - gap
    }

    content.style.left = `${Math.max(margin, Math.min(left, view.innerWidth - contentRect.width - margin))}px`
    content.style.top = `${Math.max(margin, Math.min(top, view.innerHeight - contentRect.height - margin))}px`
    content.dataset.placement = side
    content.dataset.positioned = "true"
  }

  const syncTree = (scope: ParentNode) => {
    scope.querySelectorAll<HTMLDialogElement>('dialog[data-ui="dialog"]').forEach(syncDialog)
    scope.querySelectorAll<HTMLElement>('[data-ui="command"]').forEach(syncCommand)
    scope.querySelectorAll<HTMLElement>('[data-ui="toast"]').forEach(syncToast)
    scope.querySelectorAll<HTMLElement>('[data-ui="tooltip"]').forEach((tooltip) => {
      if (tooltip.matches(":hover") || tooltip.contains(tooltip.ownerDocument.activeElement)) positionTooltip(tooltip)
    })
    if (scope instanceof HTMLDialogElement && scope.dataset.ui === "dialog") syncDialog(scope)
    if (scope instanceof HTMLElement && scope.dataset.ui === "command") syncCommand(scope)
    if (scope instanceof HTMLElement && scope.dataset.ui === "toast") syncToast(scope)
    if (scope instanceof HTMLElement && scope.dataset.ui === "tooltip" && (scope.matches(":hover") || scope.contains(scope.ownerDocument.activeElement))) positionTooltip(scope)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLDialogElement) syncDialog(record.target)
      if (record.type === "attributes" && record.target instanceof HTMLElement && record.target.dataset.ui === "toast") syncToast(record.target)
      if (record.type === "attributes" && record.target instanceof HTMLElement && record.target.dataset.ui === "command-item") {
        const command = record.target.closest<HTMLElement>('[data-ui="command"]')
        if (command) syncCommand(command)
      }
      if (record.type === "childList" && record.target instanceof Element) {
        const command = record.target.closest<HTMLElement>('[data-ui="command"]')
        if (command) syncCommand(command)
      }
      for (const node of record.addedNodes) if (node instanceof HTMLElement) syncTree(node)
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const removedToasts = node.dataset.ui === "toast" ? [node] : Array.from(node.querySelectorAll<HTMLElement>('[data-ui="toast"]'))
        for (const toast of removedToasts) {
          const timer = toastTimers.get(toast)
          if (timer !== undefined) window.clearTimeout(timer.timer)
          toastTimers.delete(toast)
        }
      }
    }
  })

  const commandItems = (input: HTMLInputElement) => {
    const command = input.closest<HTMLElement>('[data-ui="command"]')
    return command ? Array.from(command.querySelectorAll<HTMLButtonElement>('[data-ui="command-item"]:not(:disabled)')) : []
  }

  const activateCommandItem = (input: HTMLInputElement, item: HTMLButtonElement) => {
    const items = commandItems(input)
    for (const candidate of items) {
      const active = candidate === item
      candidate.dataset.selected = String(active)
      candidate.setAttribute("aria-selected", String(active))
    }
    if (!item.id) item.id = `ui-command-option-${++commandSequence}`
    input.setAttribute("aria-activedescendant", item.id)
    item.scrollIntoView({ block: "nearest" })
  }

  const onCommandShortcut = (event: KeyboardEvent) => {
    if (!event.repeat && event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      const commandDialog = root.querySelector<HTMLElement>('[data-command-dialog="true"]')
      const commandTrigger = root.querySelector<HTMLElement>('[data-command-shortcut-trigger="true"]')
      if (commandDialog || commandTrigger) {
        event.preventDefault()
        if (commandDialog?.dataset.open === "true") commandDialog.querySelector<HTMLInputElement>('[data-ui="command-input"]')?.focus()
        else commandTrigger?.click()
        return
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    if (event.key === "Escape") {
      const tooltip = target.closest<HTMLElement>('[data-ui="tooltip"]')
      if (tooltip) {
        tooltip.dataset.dismissed = "true"
        return
      }
    }

    if (target.matches('[role="tab"]') && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const list = target.closest('[role="tablist"]')
      if (!list) return
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'))
      const current = tabs.indexOf(target)
      if (current < 0 || tabs.length === 0) return
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length
      event.preventDefault()
      tabs[next]?.focus()
      tabs[next]?.click()
      return
    }

    if (!(target instanceof HTMLInputElement) || target.dataset.ui !== "command-input") return
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"].includes(event.key)) return
    const items = commandItems(target)
    const activeId = target.getAttribute("aria-activedescendant")
    const current = items.findIndex((item) => item.id === activeId)
    if (event.key === "Escape") {
      target.removeAttribute("aria-activedescendant")
      return
    }
    if (event.key === "Enter") {
      if (current >= 0) {
        event.preventDefault()
        items[current]?.click()
      }
      return
    }
    if (items.length === 0) return
    event.preventDefault()
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length : (current <= 0 ? items.length : current) - 1
    const item = items[next]
    if (item) activateCommandItem(target, item)
  }

  const onTooltipOpen = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const tooltip = target.closest<HTMLElement>('[data-ui="tooltip"]')
    if (!tooltip) return
    tooltip.removeAttribute("data-dismissed")
    positionTooltip(tooltip)
  }

  const onInputGroupAddonClick = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const addon = target.closest<HTMLElement>('[data-ui="input-group-addon"]')
    if (!addon || target.closest("button")) return
    addon.closest<HTMLElement>('[data-ui="input-group"]')?.querySelector<HTMLElement>("input, textarea")?.focus()
  }

  const positionOpenTooltips = () => {
    root.querySelectorAll<HTMLElement>('[data-ui="tooltip"]').forEach((tooltip) => {
      if (tooltip.matches(":hover") || tooltip.contains(tooltip.ownerDocument.activeElement)) positionTooltip(tooltip)
    })
  }

  root.addEventListener("keydown", onKeyDown as EventListener)
  ownerDocument?.addEventListener("keydown", onCommandShortcut)
  root.addEventListener("focusin", onTooltipOpen)
  root.addEventListener("pointerover", onTooltipOpen)
  root.addEventListener("click", onInputGroupAddonClick)
  view?.addEventListener("resize", positionOpenTooltips)
  view?.addEventListener("scroll", positionOpenTooltips, true)
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-open", "data-duration", "data-revision", "data-selected"] })
  syncTree(root)

  return () => {
    root.removeEventListener("keydown", onKeyDown as EventListener)
    ownerDocument?.removeEventListener("keydown", onCommandShortcut)
    root.removeEventListener("focusin", onTooltipOpen)
    root.removeEventListener("pointerover", onTooltipOpen)
    root.removeEventListener("click", onInputGroupAddonClick)
    view?.removeEventListener("resize", positionOpenTooltips)
    view?.removeEventListener("scroll", positionOpenTooltips, true)
    observer.disconnect()
    for (const { timer } of toastTimers.values()) window.clearTimeout(timer)
    toastTimers.clear()
  }
}
