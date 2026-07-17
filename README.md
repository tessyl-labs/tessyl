# tessyl

A full-stack Turborepo application written in Voyd.

## Workspace layout

- `apps/*` — deployable Voyd applications
- `packages/*` — shared Voyd packages

The workspace is ready for the Voyd app initializer; no application has been
generated yet.

## Setup

Clone with submodules so the pinned Voyd source is available:

```sh
git clone --recurse-submodules <repository-url>
```

For an existing checkout, run `git submodule update --init --recursive` once.
The `preinstall` hook keeps the submodule synchronized to the revision pinned
by Tessyl.

## Commands

```sh
npm install
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```
