import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runVoyd } from "./run-voyd.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entryPath = resolve(rootDir, "src/client.voyd");
const outPath = resolve(rootDir, "src/generated/client.wasm");

export async function compileClient({ verbose = true } = {}) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, await runVoyd(["--emit-wasm", "--opt", entryPath], { cwd: rootDir }));
  if (verbose) console.log("compiled " + entryPath + " -> " + outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await compileClient();
}
