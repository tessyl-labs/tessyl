# tessyl

A full-stack Turborepo application written in Voyd.

## Workspace layout

- `apps/*` — deployable Tessyl applications
- `packages/design-tokens` — shared semantic theme values for web and Native
- `packages/tessyl-native` — the Native runtime, examples, and local playground

## Setup

The `preinstall` hook automatically initializes the pinned Voyd submodule, so
both `npm install` and `npm ci` work from a regular clone.

## Commands

```sh
npm install
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```
