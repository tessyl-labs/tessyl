import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const css = await readFile(new URL("../renderer.css", import.meta.url), "utf8");
const output = `// Generated from renderer.css. Run npm run generate:styles after editing CSS.\nexport const TFM_RENDERER_CSS = ${JSON.stringify(css)};\n`;

await writeFile(new URL("../src/renderer-styles.ts", import.meta.url), output);
