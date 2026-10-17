# @driftwall/contracts

Shared, dependency-free contracts used by both the macOS app (`app/`) and the
hosted backend (`backend/`).

- `dwpkg.ts` — canonical TypeScript types for the `.dwpkg` wallpaper manifest.
- `dwpkg.manifest.schema.json` — JSON Schema (draft-07) mirroring those types.

Consumers import via the workspace package:

```ts
import { type DwpkgManifest, manifestSchema } from '@driftwall/contracts';
```

Validation is performed by the consumer (the app uses `ajv` against
`manifestSchema`) so this package stays framework- and runtime-agnostic.
