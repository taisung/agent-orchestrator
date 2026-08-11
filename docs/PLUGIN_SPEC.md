# AO Plugin Spec (historical extension design)

> The personal distribution no longer ships the marketplace, installer, updater, or scaffolder described below.
> Retained built-ins still implement these core interfaces. Explicit npm/local descriptors must already be
> installed or built and are an advanced compatibility seam, not a supported marketplace workflow.

This document defines the runtime contract and packaging requirements for Agent Orchestrator plugins.

## Runtime Contract

Plugins are standard Node.js modules that export a `PluginModule`:

```ts
export interface PluginModule<T = unknown> {
  manifest: PluginManifest;
  create(config?: Record<string, unknown>): T;
  detect?(): boolean;
}
```

Minimum manifest shape:

```ts
export interface PluginManifest {
  name: string;
  slot: PluginSlot;
  description: string;
  version: string;
}
```

AO accepts either a direct named export or a default export that satisfies this shape.

## Supported Slots

Current core slot types:

- `runtime`
- `agent`
- `workspace`
- `tracker`
- `scm`
- `notifier`
- `terminal`

The manifest `slot` determines where AO registers the plugin and which config surface can reference it.

## Packaging Requirements

Published plugins should:

- ship built JavaScript, not raw TypeScript-only entrypoints
- export an ESM entrypoint through `exports` or `main`
- declare a semver dependency on `@aoagents/ao-core`
- keep side effects out of module top-level code where possible

Recommended package shape:

```json
{
  "name": "@aoagents/ao-plugin-example",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"]
}
```

## Config Descriptors

Project config enables plugins through `plugins:` entries:

```yaml
plugins:
  - name: custom-runtime
    source: npm
    package: "@example/ao-plugin-runtime-custom"
  - name: local-notifier
    source: local
    path: /absolute/path/to/plugin/dist/index.js
```

Descriptor fields:

- `name`: logical plugin name shown in CLI UX
- `source`: `npm` or `local`
- `package`: an independently installed package name for `source: npm`
- `path`: local filesystem path for `source: local`
- `enabled`: optional flag, defaults to `true`

AO does not install these dependencies. The npm package must already resolve from the checkout, and a local
entrypoint must already be built. `source: registry` is rejected.

## Distribution Boundary

The personal distribution ships only its retained built-ins. It has no marketplace catalog, managed plugin store,
installer, updater, or scaffolder. Explicit descriptors are a compatibility seam for manually managed extensions.

The `terminal` interface remains for source compatibility, but no terminal plugin or CLI consumer is bundled.
