import { resourceProfile } from "../profiles.js";
import { TessylNativeError } from "../errors.js";

type Waiter = {
  owner: object;
  active: boolean;
  timeout: ReturnType<typeof setTimeout>;
  resolve(release: () => void): void;
  reject(error: Error): void;
};

export class RuntimeScheduler {
  readonly #profile = resourceProfile("standard-v1");
  readonly #active = new Set<object>();
  readonly #waiters: Waiter[] = [];

  acquire(owner: object): Promise<() => void> {
    if (this.#active.has(owner)) return Promise.resolve(() => this.release(owner));
    if (this.#active.size < this.#profile.maxConcurrentWorkers) {
      this.#active.add(owner);
      return Promise.resolve(() => this.release(owner));
    }
    if (this.#waiters.length >= this.#profile.maxRuntimeQueue) return Promise.reject(limitError("Runtime wait queue limit exceeded"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        owner,
        active: true,
        resolve,
        reject,
        timeout: setTimeout(() => {
          if (!waiter.active) return;
          waiter.active = false;
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(limitError("Runtime slot wait timed out"));
        }, this.#profile.runtimeQueueTimeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  cancel(owner: object): void {
    for (let index = this.#waiters.length - 1; index >= 0; index -= 1) {
      if (this.#waiters[index]?.owner === owner) {
        const waiter = this.#waiters.splice(index, 1)[0]!;
        waiter.active = false;
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("runtime slot request cancelled"));
      }
    }
    this.release(owner);
  }

  private release(owner: object): void {
    if (!this.#active.delete(owner)) return;
    while (this.#waiters.length) {
      const next = this.#waiters.shift()!;
      if (!next.active) continue;
      next.active = false;
      clearTimeout(next.timeout);
      this.#active.add(next.owner);
      next.resolve(() => this.release(next.owner));
      break;
    }
  }
}

const limitError = (message: string): TessylNativeError => new TessylNativeError({
  code: "resource_limit",
  phase: "run",
  message,
  recoverable: true,
});

export const runtimeScheduler = new RuntimeScheduler();
