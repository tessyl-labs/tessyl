import type { TesseraMetadataV1, TesseraStatus } from "../types.js";

export type NativeShell = {
  readonly content: HTMLElement;
  setStatus(status: TesseraStatus): void;
  setExpanded(expanded: boolean): void;
  showInspection(title: string, entries: readonly { label: string; text: string }[]): void;
  dispose(): void;
};

export const createNativeShell = (input: {
  container: HTMLElement;
  metadata: TesseraMetadataV1;
  expanded: boolean;
  onReset(): void;
  onRestart(): void;
  onExpandedChange(expanded: boolean): void;
  onInspectSource(): void;
  onInspectProvenance(): void;
}): NativeShell => {
  const shell = document.createElement("dialog");
  shell.show();
  shell.dataset.tessylNativeShell = "";
  shell.setAttribute("role", "region");
  shell.setAttribute("aria-label", input.metadata.accessibleName);
  shell.append(createStyles());

  const header = document.createElement("header");
  const identity = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = input.metadata.title;
  const status = document.createElement("span");
  status.dataset.tessylShellStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  identity.append(title, status);

  const actions = document.createElement("div");
  actions.dataset.tessylShellActions = "";
  const reset = actionButton("Reset", input.onReset);
  const restart = actionButton("Restart", input.onRestart);
  const expand = actionButton(input.expanded ? "Exit expanded view" : "Expanded view", () => api.setExpanded(shell.dataset.tessylExpanded !== "true"));
  const source = actionButton("Source", input.onInspectSource);
  const provenance = actionButton("Revision and provenance", input.onInspectProvenance);
  actions.append(reset, restart, expand, source, provenance);
  header.append(identity, actions);

  const content = document.createElement("div");
  content.dataset.tessylShellContent = "";
  content.setAttribute("aria-label", `${input.metadata.accessibleName} content`);
  const information = metadataDetails(input.metadata);
  shell.append(header, content, information);
  input.container.replaceChildren(shell);
  let expandedOpener: HTMLElement | null = null;
  let disposed = false;
  const inspectors = new Set<HTMLDialogElement>();

  const api: NativeShell = {
    content,
    setStatus(next) {
      shell.dataset.tessylNativeStatus = next;
      input.container.dataset.tessylNativeStatus = next;
      status.textContent = statusLabel(next);
      const recoverable = next === "failed";
      restart.hidden = !recoverable;
      reset.disabled = next === "loading" || next === "starting" || next === "unsupported" || next === "disposed";
    },
    setExpanded(next) {
      if (shell.dataset.tessylExpanded === String(next)) return;
      shell.dataset.tessylExpanded = String(next);
      expand.textContent = next ? "Exit expanded view" : "Expanded view";
      if (next) {
        const active = document.activeElement;
        expandedOpener = active instanceof HTMLElement && active !== document.body && active !== shell && shell.contains(active) ? active : expand;
        if (shell.open) shell.close();
        shell.setAttribute("role", "dialog");
        shell.setAttribute("aria-modal", "true");
        shell.showModal();
      } else {
        if (shell.open) shell.close();
        shell.setAttribute("role", "region");
        shell.removeAttribute("aria-modal");
        shell.show();
      }
      input.onExpandedChange(next);
      if (next) shell.focus({ preventScroll: true });
      else setTimeout(() => {
        if (expandedOpener?.isConnected) expandedOpener.focus({ preventScroll: true });
      // WebKit applies its native dialog-close autofocus after the cancel task.
      // Restore after that handoff so Escape consistently returns to the opener.
      }, 50);
    },
    showInspection(inspectorTitle, entries) {
      if (disposed) return;
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const inspector = document.createElement("dialog");
      inspector.setAttribute("aria-label", inspectorTitle);
      inspector.dataset.tessylNativeInspector = "";
      const heading = document.createElement("h2");
      heading.textContent = inspectorTitle;
      inspector.append(heading);
      for (const entry of entries) {
        const label = document.createElement("h3");
        label.textContent = entry.label;
        const text = document.createElement("pre");
        text.textContent = entry.text;
        inspector.append(label, text);
      }
      const close = actionButton("Close", () => inspector.close());
      inspector.append(close);
      inspectors.add(inspector);
      inspector.addEventListener("close", () => { inspectors.delete(inspector); inspector.remove(); opener?.focus({ preventScroll: true }); }, { once: true });
      document.body.append(inspector);
      inspector.showModal();
      close.focus({ preventScroll: true });
    },
    dispose() {
      disposed = true;
      for (const inspector of inspectors) {
        if (inspector.open) inspector.close();
        else inspector.remove();
      }
      inspectors.clear();
      actions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      shell.remove();
    },
  };
  shell.tabIndex = -1;
  shell.addEventListener("focus", () => {
    if (shell.dataset.tessylExpanded !== "true" && expandedOpener?.isConnected) {
      expandedOpener.focus({ preventScroll: true });
    }
  });
  shell.addEventListener("cancel", (event) => { if (shell.dataset.tessylExpanded === "true") { event.preventDefault(); api.setExpanded(false); } });
  api.setExpanded(input.expanded);
  api.setStatus("loading");
  return api;
};

export const renderUnsupportedShell = (container: HTMLElement, title: string): void => {
  const shell = createNativeShell({
    container,
    metadata: { version: 1, title, accessibleName: title, purpose: title, revision: "unsupported" },
    expanded: false,
    onReset: () => undefined,
    onRestart: () => undefined,
    onExpandedChange: () => undefined,
    onInspectSource: () => undefined,
    onInspectProvenance: () => undefined,
  });
  const message = document.createElement("p");
  message.textContent = "This interactive is not supported by this version of Tessyl Native.";
  shell.content.replaceChildren(message);
  shell.setStatus("unsupported");
};

const actionButton = (label: string, activate: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", activate);
  return button;
};

const metadataDetails = (metadata: TesseraMetadataV1): HTMLElement => {
  const details = document.createElement("details");
  details.dataset.tessylShellInformation = "";
  const summary = document.createElement("summary");
  summary.textContent = "Caption, assumptions, and accessibility information";
  const purpose = document.createElement("p");
  purpose.textContent = metadata.caption ?? metadata.purpose;
  details.append(summary, purpose);
  appendList(details, "Instructions", metadata.instructions);
  appendList(details, "Assumptions", metadata.assumptions);
  appendList(details, "Limitations", metadata.limitations);
  appendList(details, "Authors", metadata.authors);
  appendList(details, "Reviewers", metadata.reviewers);
  if (metadata.unitsPolicy) {
    const units = document.createElement("p");
    units.textContent = `Units policy: ${metadata.unitsPolicy}`;
    details.append(units);
  }
  appendList(details, "Citations", metadata.citations?.map((citation) => [citation.title, citation.dataset, citation.license, citation.url].filter(Boolean).join(" — ")));
  const revision = document.createElement("p");
  revision.textContent = `Revision ${metadata.revision}`;
  details.append(revision);
  return details;
};

const appendList = (parent: HTMLElement, heading: string, values?: readonly string[]): void => {
  if (!values?.length) return;
  const title = document.createElement("strong");
  title.textContent = heading;
  const list = document.createElement("ul");
  values.forEach((value) => { const item = document.createElement("li"); item.textContent = value; list.append(item); });
  parent.append(title, list);
};

const statusLabel = (status: TesseraStatus): string => ({
  loading: "Loading",
  initialized: "Ready",
  starting: "Starting",
  running: "Running",
  paused: "Paused",
  failed: "Failed — restart available",
  unsupported: "Unsupported",
  disposed: "Disposed",
})[status];

const createStyles = (): HTMLStyleElement => {
  const style = document.createElement("style");
  style.textContent = `[data-tessyl-native-shell]{position:static;display:grid;width:auto;height:auto;margin:0;padding:0;gap:.75rem;max-width:100%;border:1px solid #cbd5e1;border-radius:1rem;background:#fff;color:#0f172a;box-shadow:0 8px 30px rgb(15 23 42/.08);overflow:hidden;font:14px/1.45 system-ui,sans-serif}[data-tessyl-native-shell]::backdrop{background:rgb(15 23 42/.72)}[data-tessyl-native-shell]>header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem;border-bottom:1px solid #e2e8f0;background:#f8fafc}[data-tessyl-native-shell]>header>div:first-child{display:grid;gap:.1rem}[data-tessyl-shell-status]{color:#475569;font-size:.78rem}[data-tessyl-shell-actions]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.35rem}[data-tessyl-shell-actions] button{min-height:2rem;padding:.35rem .6rem;border:1px solid #94a3b8;border-radius:.5rem;background:#fff;color:#0f172a;font:inherit;cursor:pointer}[data-tessyl-shell-actions] button:focus-visible,summary:focus-visible{outline:3px solid #0ea5e9;outline-offset:2px}[data-tessyl-shell-content]{min-height:8rem}[data-tessyl-fallback] [aria-label="Particle data"],[data-tessyl-fallback] [aria-label="Scene data"]{max-height:14rem;overflow:auto}[data-tessyl-shell-information]{margin:0 .75rem .75rem;padding:.65rem .75rem;border-radius:.65rem;background:#f8fafc}[data-tessyl-shell-information] summary{cursor:pointer;font-weight:700}[data-tessyl-expanded="true"]{position:fixed;inset:1rem;width:calc(100vw - 2rem);max-width:none;max-height:calc(100vh - 2rem);overflow:auto}[data-tessyl-expanded="true"] [data-tessyl-shell-content]{min-height:60vh}@media(max-width:40rem){[data-tessyl-native-shell]>header{align-items:flex-start;flex-direction:column}[data-tessyl-shell-actions]{justify-content:flex-start}}@media(prefers-reduced-motion:reduce){[data-tessyl-native-shell]{scroll-behavior:auto}}`;
  return style;
};
