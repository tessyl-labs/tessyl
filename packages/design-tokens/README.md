# Tessyl design tokens

`@tessyl/design-tokens` is the shared semantic theme source for the Tessyl web
application and the sandboxed Tessyl Native renderer.

- Import `@tessyl/design-tokens/theme.css` from trusted application styles.
- Import `themeCssVariables` from `@tessyl/design-tokens` when constructing a
  sandboxed renderer document that cannot inherit host CSS.

Run `npm run build --workspace=@tessyl/design-tokens` after changing tokens. The
build generates `theme.css` from the typed token map so CSS and TypeScript
consumers stay synchronized.
