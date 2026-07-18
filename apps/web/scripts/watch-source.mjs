import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function watchSource(root, onChange, { intervalMs = 750 } = {}) {
  let previous = snapshot(root);
  let scanning = false;
  const timer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    try {
      const before = previous;
      const next = snapshot(root);
      const paths = new Set([...before.keys(), ...next.keys()]);
      previous = next;
      for (const path of paths) {
        if (previousValue(before, path) !== previousValue(next, path)) onChange(path);
      }
    } finally {
      scanning = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function snapshot(root) {
  const files = new Map();
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = statSync(path);
        files.set(path, `${stat.mtimeMs}:${stat.size}`);
      } catch {
        // A file changed between directory enumeration and stat; the next poll
        // will observe its stable state.
      }
    }
  }
  return files;
}

function previousValue(values, path) {
  return values.get(path);
}
