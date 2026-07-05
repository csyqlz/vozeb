# web

VOZEB application source files for the user workbenches, canvas, admin console,
API routes, authentication, storage, and generation task polling.

Run local development:

```bash
pnpm install
pnpm dev
```

Build for a low-memory server:

```bash
NEXT_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=1024 pnpm build
pnpm start:standalone
```
