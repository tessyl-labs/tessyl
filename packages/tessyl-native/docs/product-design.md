# Tessyl Native product design

## Summary

Tessyl is a knowledge-management system designed to present information more
powerfully than a static document can. Tessyl Native lets an article include a
small interactive application—a **Tessera**—written in Voyd.

Tesserae make a concept explorable. They can be charts, calculators,
simulations, animations, diagrams, or other focused tools that help a reader
understand, verify, or apply the surrounding material.

## Goals

- Make interactive explanation a normal part of authoring an article.
- Let authors build useful interactions without web-platform expertise.
- Give readers fast, consistent, accessible applications that feel native to
  Tessyl.
- Preserve the trustworthiness and readability of an article when an
  application fails or is unavailable.
- Treat every Tessera as untrusted code, regardless of its author or review
  status.
- Create one framework that can serve public, personal, team, and enterprise
  knowledge bases.

## Non-goals

- Hosting arbitrary websites or JavaScript applications.
- Providing general browser, network, storage, or DOM access.
- Replacing full scientific notebooks, IDEs, or general application platforms.
- Allowing a Tessera to modify its containing article or impersonate Tessyl UI.
- Guaranteeing uninterrupted execution of arbitrarily expensive computations.

## Users and jobs

### Article authors

Authors want to turn an explanation into an experience: adjust a parameter,
inspect a relationship, run a bounded simulation, or test an equation. They
should work with typed components and domain-friendly primitives rather than
HTML, CSS, browser APIs, or sandbox details.

### Readers

Readers want an interaction that starts quickly, explains itself, works with a
keyboard and assistive technology, and cannot destabilize the article. They
should always have a useful static fallback.

### Reviewers and domain experts

Reviewers need to inspect source, inputs, data provenance, and the exact
revision embedded by an article. Updating a Tessera must not silently change
previously reviewed articles.

### Tessyl administrators

Administrators need predictable capability and resource policies. Enterprise
data access must be mediated by Tessyl and scoped to a declared purpose; a
Tessera never receives general credentials.

## Product principles

1. **Explanation before spectacle.** Every interaction should support a clear
   learning or decision-making goal.
2. **Native by default.** Layout, typography, controls, charts, errors, and
   accessibility come from Tessyl Native.
3. **Safe failure.** A crashed, timed-out, or unsupported Tessera degrades to a
   static explanation without breaking the article.
4. **Immutable publication.** Articles pin an approved Tessera revision.
5. **Visible provenance.** Readers and reviewers can inspect source, revision,
   data sources, and relevant assumptions.
6. **Least authority.** An application receives only capabilities explicitly
   supplied by its runtime profile.
7. **Portable knowledge.** The article remains useful in exports, search
   previews, and environments where interactive execution is unavailable.

## Core experience

An author adds or edits Voyd source in the article editor, previews the
interaction, selects a default state for its fallback, supplies a caption, and
submits it for the same review process as the surrounding article. Publishing
creates an immutable Tessera revision and pins the article embed to it.

On an article page, a fallback appears immediately. It is a revision-bound,
non-interactive native frame captured from the reviewed default state—not
contributor HTML. The interactive runtime is loaded lazily when the Tessera
approaches the viewport. A standard frame offers reset, expanded view, source,
revision, and provenance controls without letting the application reproduce or
alter those controls.

The shell Reset control always returns the entire Tessera to its published
initial state by starting a fresh runtime. Application-authored reset controls
are reserved for clearly labelled, domain-specific partial resets.

## Feature scope

### Initial release

- Voyd model-view-update applications.
- Native layout, text, controls, tables, metrics, equations, and common charts.
- Bounded timers, animation frames, container-size observation, and links to
  Tessyl articles.
- Immutable source and compiled revisions.
- Static fallbacks and recoverable timeout/crash states.
- Source and revision inspection.
- Keyboard, screen-reader, reduced-motion, and responsive-layout support.
- No arbitrary network, persistent storage, clipboard reads, browser
  navigation, or cross-application communication.

### Later possibilities

- Typed per-embed inputs.
- Pinned datasets and approved read-only data capabilities.
- Shareable parameter states.
- Collaborative or persistent state with an explicit application model.
- Enterprise capability profiles backed by scoped Tessyl services.
- Additional visualization primitives and accessible sonification.

These features should extend the capability and protocol model rather than add
escape hatches.

## Tessyl integration contract

Tessyl Native produces and runs a validated, versioned `TesseraArtifact`. The
artifact contains the runtime manifest, compiled Wasm, dependency lock, source
bundle, and static fallback defined by the Native architecture.

Native exposes two deliberately separate developer surfaces:

- The **Tessera Author SDK** is the pinned Voyd package
  `pkg::tessyl_native`. It is available to untrusted Tessera source and contains
  only the supported application model, components, and capabilities.
- The **Tessyl Integration SDK** is the private TypeScript package
  `@tessyl/native`. Only trusted Tessyl code installs it. Its single facade
  compiles artifacts and initializes, runs, and disposes isolated Tessera
  instances.

Tessyl must use the integration facade rather than constructing Voyd hosts, VX
runtimes, Workers, renderers, protocol brokers, or watchdogs itself.

Tessyl—not Tessyl Native—owns the content model around that artifact: Tessera
identity, ownership, revisions, review state, provenance, article embeds,
captions, presentation settings, permissions, and persistence. Tessyl must bind
an approved artifact immutably to a published revision and pass only approved
artifacts to the Native runtime.

Article-owned presentation settings may control bounded layout, such as height
or expanded-view availability, but cannot alter the artifact's capability or
resource profile. The fallback uses the restricted static Native schema and is
rendered by trusted Tessyl code in articles and exports.

## Quality bar

A publishable Tessera should:

- Make its purpose clear without trial and error.
- Label inputs, outputs, units, axes, assumptions, and error states.
- Produce meaningful output for its documented input range.
- Remain usable with keyboard navigation and at narrow widths.
- Respect reduced-motion preferences.
- Include a useful fallback and provenance.
- Stay within the standard resource profile on supported browsers.

## Success measures

- Readers engage with Tesserae without increased article abandonment or error
  rates.
- Authors can produce common calculators and charts without writing host code.
- The percentage of published Tesserae with accessibility or provenance issues
  declines over time.
- Timeouts, rejected frames, and runtime crashes are rare, isolated, and
  recoverable.
- Interactive articles remain useful in static exports and no-script sessions.
