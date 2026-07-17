# tessyl

A full-stack Turborepo application written in Voyd.

## Workspace layout

- `apps/*` — deployable Voyd applications
- `packages/*` — shared Voyd packages

The workspace is ready for the Voyd app initializer; no application has been
generated yet.

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
