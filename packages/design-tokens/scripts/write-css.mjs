import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderThemeCss } from "../dist/index.js";

await writeFile(fileURLToPath(new URL("../theme.css", import.meta.url)), renderThemeCss(), "utf8");
