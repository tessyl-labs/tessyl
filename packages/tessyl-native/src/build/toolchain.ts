import { createHash } from "node:crypto";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { TesseraDependencyLockV1 } from "../types.js";

const ROOT_NODE_MODULES = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
const NATIVE_SDK = fileURLToPath(new URL("../../voyd/tessyl_native", import.meta.url));
const INITIAL_PACKAGES = ["@voyd-lang/sdk", "@voyd-lang/js-host", "@voyd-lang/vx-dom"] as const;
const SKIP = new Set(["node_modules", ".git"]);

type PackageInfo = { name: string; version: string; root: string; dependencies: Record<string, string> };

export type ToolchainInfo = {
  dependencyLock: TesseraDependencyLockV1;
  compilerVersion: string;
  vxRuntimeVersion: string;
};

export const inspectToolchain = async (): Promise<ToolchainInfo> => {
  const packages = new Map<string, PackageInfo>();
  const nativePackage = await readPackage(await realpath(NATIVE_SDK));
  packages.set(nativePackage.name, nativePackage);
  const queue: Array<{ name: string; from?: string }> = INITIAL_PACKAGES.map((name) => ({ name }));
  const seenRoots = new Set<string>();
  while (queue.length) {
    const request = queue.shift()!;
    const root = await resolvePackageRoot(request.name, request.from);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    if (seenRoots.size > 64) throw new Error("production dependency closure exceeds lock limit");
    const info = await readPackage(root);
    const existing = packages.get(info.name);
    if (existing && existing.root !== info.root) throw new Error(`multiple production package roots are unsupported: ${info.name}`);
    packages.set(info.name, info);
    for (const dependency of Object.keys(info.dependencies)) queue.push({ name: dependency, from: info.root });
  }
  const locked = await Promise.all([...packages.values()].sort((a, b) => a.name.localeCompare(b.name)).map(async (info) => ({
    name: info.name,
    version: info.version,
    contentHash: await hashDirectory(info.root),
  })));
  return {
    dependencyLock: { version: 1, packages: locked },
    compilerVersion: packages.get("@voyd-lang/compiler")?.version ?? "unknown",
    vxRuntimeVersion: packages.get("@voyd-lang/vx-dom")?.version ?? "unknown",
  };
};

const resolvePackageRoot = async (name: string, from?: string): Promise<string> => {
  if (!from) return realpath(join(ROOT_NODE_MODULES, ...name.split("/")));
  let directory = from;
  for (let depth = 0; depth < 16; depth += 1) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    try { await access(join(candidate, "package.json")); return await realpath(candidate); } catch { /* Continue with Node-style parent lookup. */ }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`production dependency is unavailable: ${name}`);
};

const readPackage = async (root: string): Promise<PackageInfo> => {
  const value = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  if (typeof value.name !== "string" || typeof value.version !== "string") throw new Error(`invalid package metadata: ${basename(root)}`);
  return {
    name: value.name,
    version: value.version,
    root,
    dependencies: value.dependencies && typeof value.dependencies === "object" ? value.dependencies as Record<string, string> : {},
  };
};

export const hashDirectory = async (root: string): Promise<string> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else if (entry.isSymbolicLink()) throw new Error(`package content symlink is unsupported: ${relative(root, path)}`);
      else throw new Error(`unsupported package content entry: ${relative(root, path)}`);
    }
  };
  await visit(root);
  files.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
  if (files.length > 20_000) throw new Error("package content file limit exceeded");
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of files) {
    const size = (await stat(path)).size;
    bytes += size;
    if (bytes > 256 * 1024 * 1024) throw new Error("package content byte limit exceeded");
    hash.update(relative(root, path)); hash.update("\0"); hash.update(await readFile(path)); hash.update("\0");
  }
  return hash.digest("hex");
};
