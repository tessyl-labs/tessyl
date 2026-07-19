import { renderHtml, type TfmResolvedResource, type TfmResourceRequest } from "@tessyl/tfm";
import example from "../../examples/showcase.tfm?raw";
import videoFixture from "../fixtures/demo-video.webm.base64?raw";

const source = document.querySelector<HTMLTextAreaElement>("#source")!;
const preview = document.querySelector<HTMLIFrameElement>("#preview")!;
const diagnostics = document.querySelector<HTMLElement>("#diagnostics")!;
const renderStatus = document.querySelector<HTMLElement>("#render-status")!;
let previewReady = false;

const videoBytes = Uint8Array.from(atob(videoFixture.trim()), (character) => character.charCodeAt(0));
const videoUrl = URL.createObjectURL(new Blob([videoBytes], { type: "video/webm" }));
window.addEventListener("pagehide", () => URL.revokeObjectURL(videoUrl), { once: true });

const resources: Readonly<Record<string, TfmResolvedResource>> = {
  dsr_01NABC: {
    label: "Planet comparison",
    columns: ["Planet", "Orbital period", "Relative mass"],
    rows: [["Mercury", "88 days", "0.055"], ["Earth", "365 days", "1.000"], ["Mars", "687 days", "0.107"]],
  },
  asr_video_01JABC: { url: videoUrl, label: "Authorized video preview" },
  asr_audio_01KABC: { url: "/fixtures/demo.wav", label: "Authorized audio preview" },
  asr_text_01LABC: { url: "/fixtures/transcript.txt", label: "Open local transcript fixture" },
  tsr_01MABC: { url: "/fixtures/app.html", label: "Sandboxed Tessera fixture" },
};

const resolveResource = ({ id }: TfmResourceRequest): TfmResolvedResource | undefined => resources[id];

const render = (): void => {
  if (!previewReady || !preview.contentDocument) return;
  const result = renderHtml(source.value, { title: "TFM workbench preview", resolveResource });
  renderStatus.textContent = result.success ? "Rendered safely" : "Fix source errors";
  diagnostics.hidden = result.diagnostics.length === 0;
  diagnostics.textContent = result.diagnostics.map(({ severity, code, message, span }) =>
    `${severity.toUpperCase()} ${code} · ${span.startLine}:${span.startColumn}\n${message}`).join("\n\n");
  preview.contentDocument.open();
  preview.contentDocument.write(result.success
    ? result.html
    : "<!doctype html><title>Invalid TFM</title><p>The TFM source has validation errors.</p>");
  preview.contentDocument.close();
};

let pending: number | undefined;
source.value = example;
const initializePreview = (): void => {
  previewReady = true;
  render();
};
if (preview.contentDocument?.readyState === "complete") initializePreview();
else preview.addEventListener("load", initializePreview, { once: true });
source.addEventListener("input", () => {
  window.clearTimeout(pending);
  pending = window.setTimeout(render, 120);
});
