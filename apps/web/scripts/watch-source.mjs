import { readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";

export function watchSource(root, onChange) {
  const watchers = new Map();
  const retryAttempts = new Map();
  const retryTimers = new Map();
  let closed = false;
  const watchTree = (directory) => {
    if (closed || !isDirectory(directory)) return;
    watchDirectory(directory);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      scheduleWatchRetry(directory, error);
      return;
    }
    entries
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => watchTree(join(directory, entry.name)));
  };
  const watchDirectory = (directory) => {
    if (closed || watchers.has(directory)) return;
    try {
      const watcher = watch(directory, (_event, filename) => {
        retryAttempts.delete(directory);
        if (!filename) {
          reconcileWatchers();
          onChange();
          return;
        }
        const path = join(directory, filename.toString());
        if (isDirectory(path)) {
          watchTree(path);
          onChange();
          return;
        }
        reconcileWatchers();
        onChange(path);
      });
      watchers.set(directory, watcher);
      watcher.on("error", (error) => handleWatcherError(directory, watcher, error));
    } catch (error) {
      scheduleWatchRetry(directory, error);
    }
  };
  const handleWatcherError = (directory, watcher, error) => {
    console.error("Source watcher failed for " + directory, error);
    watcher.close();
    if (watchers.get(directory) === watcher) watchers.delete(directory);
    scheduleWatchRetry(directory);
    onChange();
  };
  const scheduleWatchRetry = (directory, error) => {
    if (closed || retryTimers.has(directory)) return;
    const attempt = retryAttempts.get(directory) ?? 0;
    if (error && attempt === 0) {
      console.error("Unable to watch source directory " + directory, error);
    }
    retryAttempts.set(directory, attempt + 1);
    const timer = setTimeout(() => {
      retryTimers.delete(directory);
      if (isDirectory(directory)) watchDirectory(directory);
      reconcileWatchers();
    }, Math.min(100 * (2 ** attempt), 5000));
    retryTimers.set(directory, timer);
  };
  const reconcileWatchers = () => {
    if (closed) return;
    watchers.forEach((watcher, directory) => {
      if (isDirectory(directory)) return;
      watcher.close();
      watchers.delete(directory);
    });
    watchTree(root);
  };
  watchTree(root);
  return () => {
    closed = true;
    watchers.forEach((watcher) => watcher.close());
    retryTimers.forEach((timer) => clearTimeout(timer));
    watchers.clear();
    retryAttempts.clear();
    retryTimers.clear();
  };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
