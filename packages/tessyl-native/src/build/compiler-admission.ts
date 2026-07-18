import { TessylNativeError } from "../errors.js";

type Waiter = {
  active: boolean;
  resolve: (release: () => void) => void;
  reject: (error: TessylNativeError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class CompilerAdmission {
  #active = 0;
  readonly #queue: Waiter[] = [];

  acquire(maxConcurrent: number, maxQueue: number, timeoutMs: number): Promise<() => void> {
    if (this.#active < maxConcurrent) {
      this.#active += 1;
      return Promise.resolve(this.#release());
    }
    if (this.#queue.length >= maxQueue) return Promise.reject(limitError("Compiler queue limit exceeded"));

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        active: true,
        resolve,
        reject,
        timeout: setTimeout(() => {
          if (!waiter.active) return;
          waiter.active = false;
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(limitError("Compiler queue wait timed out"));
        }, timeoutMs),
      };
      this.#queue.push(waiter);
    });
  }

  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      while (this.#queue.length) {
        const waiter = this.#queue.shift()!;
        if (!waiter.active) continue;
        waiter.active = false;
        clearTimeout(waiter.timeout);
        this.#active += 1;
        waiter.resolve(this.#release());
        break;
      }
    };
  }
}

const limitError = (message: string): TessylNativeError => new TessylNativeError({
  code: "resource_limit",
  phase: "compile",
  message,
  recoverable: true,
});

export const compilerAdmission = new CompilerAdmission();
