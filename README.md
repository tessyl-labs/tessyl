# tessyl

A full-stack Turborepo application written in Voyd.

## Workspace layout

- `apps/*` — deployable Tessyl applications
- `packages/design-tokens` — shared semantic theme values for web and Native
- `packages/tessyl-native` — the Native runtime, examples, and local playground

## Setup

The `preinstall` hook initializes the pinned Voyd submodule, installs its
dependencies, and builds its packages. Both `npm install` and `npm ci` leave a
regular clone ready to build or run without a separate Voyd setup step.

## Commands

```sh
npm install
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```
