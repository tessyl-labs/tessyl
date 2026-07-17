# web

This is a server-rendered Voyd application with a hydrated VX editor.

This project uses Voyd source packages from `/Users/drewy/code/voyd`. Running
`npm install` links the complete local Voyd dependency set automatically.


## Architecture

- `src/main.voyd` owns HTTP routes and server startup.
- `src/server` owns persistence, HTTP responses, and the server-only document
  shell (including the page chrome outside the hydrated editor).
- `src/app` owns the shared model, update logic, and hydrated markup. The
  server and browser both call the same `view` for that interactive region.
- `src/client.voyd` is the browser Program entrypoint.
- `src/client.ts` is the generic Wasm hydration bridge.

Code inside `#article-editor` must render identically on the server and client.
The outer document, metadata, navigation, and hydration bootstrap are only
rendered by the server because the browser does not update them. Move markup
into `src/app/ui.voyd` and inside the hydration root if it must be interactive.
Server rendering automatically releases closure-backed event handlers after it
builds the HTML. The development bridge reports hydration differences without
preventing recovery.

## Commands

- `npm run dev` rebuilds both Wasm entrypoints and restarts the server when
  Voyd, TypeScript, or CSS sources change.
- `npm run build` builds browser assets and compile-checks both entrypoints.
- `npm start` runs the production server.
- `npm run voyd:check` compile-checks the server and browser modules.
- `npm run typecheck` checks the TypeScript bridge.

Set `HOST`/`VOYD_WEB_HOST` and `PORT`/`VOYD_WEB_PORT` to configure the listener.
