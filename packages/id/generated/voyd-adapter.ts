import { defineVoydPackageAdapter } from "@voyd-lang/package-adapter";
import type { VoydPackageAdapterInvocationContext } from "@voyd-lang/package-adapter";
import { contract } from "./contract.js";

export type AdapterImplementation = {
  readonly "tessyl:id/generator@1": {
    readonly "id": (this: VoydPackageAdapterInvocationContext) => Promise<string> | string;
    readonly "word_id": (this: VoydPackageAdapterInvocationContext, arg0: number) => Promise<string> | string;
  };
};

export const defineAdapter = (implementation: AdapterImplementation) =>
  defineVoydPackageAdapter(contract, implementation);
