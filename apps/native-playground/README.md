# Tessyl Native playground

This standalone Vite app is the development host for `@tessyl/native`. It owns
the demo gallery and compiles the calculator, chart, and simulation sources
from `packages/tessyl-native/examples` into browser-loadable artifacts.

It intentionally has no dependency on `apps/web` or the Tessyl product UI.

From the repository root, use the package entry point:

```sh
npm run dev --workspace=@tessyl/native
```

Then open `http://127.0.0.1:3001/showcase`.

The package development command builds `@tessyl/native` before starting the
playground. Changes to example `.voyd` and `tessera.json` files trigger artifact
recompilation and a full browser reload.

## Presentation behavior

The gallery demonstrates the current bounded presentation contract: fluid
container width, `compact`/`standard`/`tall` iframe heights, and expanded view.
The integration API does not currently expose an aspect-ratio or fit mode.
