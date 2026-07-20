# @tessyl/ui

Production-oriented UI primitives written entirely in Voyd. Components emit typed VX messages and use Tailwind utility classes backed by semantic CSS variables.

## Theme setup

Import the package Tailwind entry once from an application stylesheet:

```css
@import "@tessyl/ui/tailwind.css";
@source "./**/*.voyd";
```

The component layer maps semantic variables such as `--ui-primary`, `--ui-card`, and `--ui-ring` to `@tessyl/design-tokens`. Change those mappings in `theme.css`, override them in an application scope, or set `data-ui-theme="library"` on an ancestor to use the included editorial theme. Component source never depends on palette-specific Tailwind utilities.

Shape, elevation, and motion are semantic too: override `--ui-radius-control`, `--ui-radius-card`, `--ui-radius-panel`, the matching `--ui-shadow-*` tokens, and `--ui-motion-fast` without editing component code.

## Voyd usage

```voyd
use pkg::ui::{ Button, ButtonVariant, Card, CardContent }

<Card>
  <CardContent>
    <Button variant={ButtonVariant::Default {}} on_press={Msg::Save {}}>
      Save
    </Button>
  </CardContent>
</Card>
```

Interactive primitives remain controlled by the owning VX model. Install the small DOM adapter once to provide native modal top-layer behavior, keyboard tab/command navigation, and optional toast timeouts:

```ts
import { installUiAdapters } from "@tessyl/ui/ui-adapters"

const disposeUiAdapters = installUiAdapters()
```

The dialog adapter calls the native `showModal()` API, which provides modal focus containment, background inertness, Escape handling, and focus restoration. It also provides tabs and command keyboard behavior, collision-aware fixed tooltip positioning and Escape dismissal, and toast timeout lifecycle. Without the adapter, the components still render semantic, controlled markup; `dialog_subscription(open:, on_key_down:)` is available as a Voyd-only Escape fallback.

For a timed toast that reuses an existing `id`, increment its optional `revision`; the adapter treats that as a new presentation and restarts the timeout.

Every `CommandDialog` requires an application-unique `id_prefix` so its title and description relationships remain unambiguous even when several closed dialogs are mounted.

`class` extends component defaults. When utilities would conflict, use `replace_class` on the primary primitives (`Button`, `Card`, `CardButton`, `Input`, `Textarea`, and `DialogContent`) to replace the default class set intentionally. `extra_attrs` on those form/action surfaces forwards application-owned attributes and event handlers.

## Development

```bash
npm run dev -w @tessyl/ui
npm test -w @tessyl/ui
npm run build -w @tessyl/ui
```

The development app demonstrates every exported component family and its interactive states.
