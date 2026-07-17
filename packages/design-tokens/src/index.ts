export const tessylTheme = {
  "--ts-color-canvas": "#f7f9fa",
  "--ts-color-canvas-subtle": "#f4f6f8",
  "--ts-color-surface": "#ffffff",
  "--ts-color-surface-muted": "#f8fafc",
  "--ts-color-surface-inverse": "#0f172a",
  "--ts-color-surface-inverse-muted": "#17243a",
  "--ts-color-text": "#0f172a",
  "--ts-color-text-body": "#172033",
  "--ts-color-text-secondary": "#475569",
  "--ts-color-text-muted": "#64748b",
  "--ts-color-text-inverse": "#ffffff",
  "--ts-color-text-inverse-muted": "#cbd5e1",
  "--ts-color-border": "#dbe4e8",
  "--ts-color-border-strong": "#cbd5e1",
  "--ts-color-border-subtle": "#e2e8f0",
  "--ts-color-accent": "#059669",
  "--ts-color-accent-strong": "#047857",
  "--ts-color-accent-deep": "#0f766e",
  "--ts-color-accent-soft": "#d1fae5",
  "--ts-color-accent-highlight": "#34d399",
  "--ts-color-focus": "#6ee7b7",
  "--ts-color-focus-ring": "rgb(52 211 153 / 14%)",
  "--ts-color-positive": "#047857",
  "--ts-color-caution": "#8a5a00",
  "--ts-color-critical": "#b00020",
  "--ts-font-sans": '"Avenir Next", Avenir, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--ts-font-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--ts-radius-control": "0.75rem",
  "--ts-radius-card": "1rem",
  "--ts-radius-panel": "1.5rem",
  "--ts-shadow-control": "0 1px 2px rgb(15 23 42 / 4%)",
  "--ts-shadow-card": "0 10px 28px rgb(15 23 42 / 5%)",
  "--ts-shadow-panel": "0 20px 55px rgb(15 23 42 / 7%)",
  "--ts-motion-fast": "160ms",
} as const;

export type TessylTheme = typeof tessylTheme;
export type TessylThemeToken = keyof TessylTheme;

export const themeCssVariables = Object.entries(tessylTheme)
  .map(([name, value]) => `${name}:${value}`)
  .join(";");

export const renderThemeCss = (selector = ":root"): string => {
  const declarations = Object.entries(tessylTheme)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${declarations}\n}\n`;
};
