import type { HealthStatus, StorageCapabilities, StorageComposition } from "./contracts.js";
import { StorageError } from "./errors.js";

export interface StorageResourceOwner { close(): Promise<void>; }
const resourceOwners = new WeakMap<object, StorageResourceOwner>();
export const attachStorageOwner = <T extends object>(provider: T, owner: StorageResourceOwner): T => {
  resourceOwners.set(provider, owner);
  return provider;
};

export const composeStorage = (...providers: readonly StorageCapabilities[]): StorageComposition => {
  const select = <K extends keyof StorageCapabilities>(key: K): NonNullable<StorageCapabilities[K]> => {
    const values = providers.map((provider) => provider[key]).filter((value): value is NonNullable<StorageCapabilities[K]> => value !== undefined);
    if (values.length === 0) throw new StorageError("invalid_request", `Missing ${key} storage provider`, { operation: "storage.compose" });
    if (values.length > 1) throw new StorageError("conflict", `Duplicate ${key} storage providers`, { operation: "storage.compose" });
    return values[0]!;
  };

  const document = select("document");
  const search = select("search");
  const searchIndex = select("searchIndex");
  const object = select("object");
  const closable = [...new Set([document, search, searchIndex, object])];
  const owners = [...new Set(closable.map((provider) => resourceOwners.get(provider)).filter((owner): owner is StorageResourceOwner => owner !== undefined))];
  const independentlyClosable = closable.filter((provider) => !resourceOwners.has(provider));

  return Object.freeze({
    document,
    search,
    searchIndex,
    object,
    async health(options: Parameters<StorageComposition["health"]>[0]): Promise<readonly HealthStatus[]> {
      return Promise.all([
        document.health(options),
        search.health(options),
        searchIndex.health(options),
        object.health(options),
      ]);
    },
    async close(): Promise<void> {
      await Promise.allSettled([...owners.map((owner) => owner.close()), ...independentlyClosable.map((provider) => provider.close())]);
    },
  });
};
