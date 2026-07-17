import { createSdk } from "@voyd-lang/sdk";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileClient } from "./compile-client.mjs";
import { formatDiagnostic } from "./diagnostics.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = await createSdk().compile({
  entryPath: resolve(rootDir, "src/main.voyd"),
  optimize: true,
  runtimeDiagnostics: true,
});

if (!result.success) {
  console.error(result.diagnostics.map(formatDiagnostic).join("\n"));
  process.exit(1);
}

await compileClient();
console.log("Voyd server and client compiled successfully.");
