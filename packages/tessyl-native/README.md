# Tessyl Native

Tessyl Native is Tessyl's internal framework for compiling and running small
interactive article applications. An application built with the framework is
called a **Tessera** (plural: **Tesserae**).

Only Tessyl installs `@tessyl/native`. Tessera authors use the Voyd package
`pkg::tessyl_native`, which the restricted Native compiler supplies and pins;
they do not install or call the TypeScript package.

This package contains the implemented v1 author SDK, compiler facade, isolated
browser runtime, renderer, examples, and test suites. Its documents
define the product and technical contracts those components satisfy:

- [Product design](./docs/product-design.md) explains why Tesserae exist, the
  intended author and reader experiences, product principles, and release scope.
- [Tessera Author SDK](./docs/tessera-author-sdk.md) is the one-stop guide for
  developers who author Tesserae in Voyd. It defines the lifecycle, components,
  capabilities, limits, testing, and publishing workflow.
- [Tessyl Integration SDK](./docs/tessyl-integration-sdk.md) defines the single
  TypeScript facade Tessyl uses to compile, initialize, run, and dispose
  Tesserae.
- [Architecture and security](./docs/architecture.md) is the implementation
  guide for Tessyl Native maintainers. It defines trust boundaries, artifact
  production, runtime isolation, protocol validation, resource controls, and
  the security test plan.

The documented v1 surface is implemented and tested in this package. Sections
explicitly labeled as future work remain design guidance; any intentional
implementation deviation should update these documents in the same change.

## Run the examples locally

From the repository root, start the package development server:

```sh
npm run dev --workspace=@tessyl/native
```

Open `http://127.0.0.1:3001/showcase`. The command builds the package and starts
the package-local Vite harness under `playground/`. It is intentionally kept
inside `@tessyl/native`: it exists to exercise package changes and examples,
not as a separately deployed Tessyl application. The playground recompiles and
reloads when calculator, chart, or simulation source under `examples/` changes.
Set `TESSYL_PLAYGROUND_HOST` or `TESSYL_PLAYGROUND_PORT` to configure the listener.
