# Tessyl Native playground

This package-local Vite harness owns the demo gallery and compiles the
calculator, chart, and simulation sources from `../examples` into
browser-loadable artifacts. It is not a workspace application or deployable
Tessyl product surface.

From the repository root, use the package entry point:

```sh
npm run dev --workspace=@tessyl/native
```

Then open `http://127.0.0.1:3001/showcase`.

The package development command builds `@tessyl/native` before starting this
harness. Changes to example `.voyd` and `tessera.json` files trigger artifact
recompilation and a full browser reload.

## Presentation behavior

The gallery demonstrates the current bounded presentation contract: fluid
container width, `compact`/`standard`/`tall` iframe heights, and expanded view.
The integration API does not currently expose an aspect-ratio or fit mode.
