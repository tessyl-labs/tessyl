# @tessyl/ui

Production-oriented UI primitives written entirely in Voyd. Components emit typed VX messages and use Tailwind utility classes backed by semantic CSS variables.

## Theme setup

Import the package Tailwind entry once from an application stylesheet:

```css
@import "@tessyl/ui/tailwind.css";
@source "./**/*.voyd";
```

The component layer maps palette roles such as `--ui-palette-background`, `--ui-palette-surface`, and `--ui-palette-gold` onto stable component semantics such as `--ui-primary`, `--ui-card`, and `--ui-ring`. Change the palette roles in `theme.css` or override them in an application scope; component source never depends on palette-specific Tailwind utilities.

The included theme uses cool porcelain and graphite neutrals with restrained metallic-gold actions. Set `data-theme="dark"` on `html` to activate its obsidian dark palette. `data-ui-theme="library"` remains available as an explicit application scope and follows the same light/dark switch.

Noto Sans is bundled through `@fontsource/noto-sans` and selected by the semantic `--ui-font-sans` token. Override that token in an application scope to change the typeface without editing the Tailwind mapping or component source.

Shape, elevation, and motion are semantic too: override `--ui-radius-control`, `--ui-radius-card`, `--ui-radius-panel`, the matching `--ui-shadow-*` tokens, and `--ui-motion-fast` without editing component code. The defaults use restrained radii for a more compact, editorial appearance.

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

`Alert` composes `AlertTitle` and `AlertDescription` with an optional `Icon`. Its `Default`, `Information`, `Success`, `Warning`, and `Destructive` variants use the same semantic color tokens as toasts and other status components.

Icons are pure Voyd wrappers around Lucide-derived SVG path data stored in `IconName`. They render as inline CSS masks, inherit `currentColor`, and do not require React or a runtime icon dependency.

Add `command_shortcut_trigger_attr()` to the existing button that opens `CommandDialog`; the adapter maps `Command+K`/`Ctrl+K` to that same typed trigger. `CommandInput` includes an `aria-keyshortcuts` contract and a visible `⌘ K` keycap hint; override `shortcut_label` when an application needs a different display label.

`Button`, `Card`, and `CardButton` accept `loading` and `loading_label`. Busy buttons and interactive cards are disabled automatically, while static cards receive the same accessible busy metadata and a stable loading overlay. `LoadingIndicator` is exported for custom compositions, and button-based wrappers forward the same loading options.

Button sizes use exact shared heights so variants, icons, and loading states align predictably: `ExtraSmall` is 28px, `Small` is 36px, `Default` is 40px, and `Large` is 44px. The matching icon sizes are 28px, 36px, and 40px squares.

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
