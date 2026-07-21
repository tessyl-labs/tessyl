import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const output = resolve(root, "demo/generated/main.wasm")
const adaptersOutput = resolve(root, "demo/generated/voyd-adapters.ts")

export async function compileVoyd() {
  const bytes = await run(["--emit-wasm", "--opt-level", "balanced", "./src/showcase/main.voyd"])
  await mkdir(resolve(root, "demo/generated"), { recursive: true })
  await writeFile(output, bytes)
  await run(["generate", "registry", "./src/showcase/main.voyd", "--out", adaptersOutput])
}

function run(args) {
  const cli = resolve(root, "../../.voyd-source/apps/cli/bin/voyd.js")
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--preserve-symlinks --preserve-symlinks-main"].filter(Boolean).join(" "), VOYD_DEV: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.once("error", reject)
    child.once("close", (code) => code === 0 ? resolveRun(Buffer.concat(stdout)) : reject(new Error(Buffer.concat(stderr).toString("utf8") || `voyd exited with ${code}`)))
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await compileVoyd()
}
