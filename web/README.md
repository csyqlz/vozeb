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

## WebDAV synchronization

WebDAV is configured only in the admin console. The frontend never receives the
real WebDAV URL, username, or password; logged-in users sync through the system
proxy when the admin enables WebDAV.

After WebDAV is enabled, each logged-in browser silently syncs local canvas
projects, user assets, workbench records, and local media cache while idle. The
same account and browser auto-sync at most once every six hours. Admins can also
run a manual sync for the current browser from the WebDAV settings panel.

WebDAV does not replace server-side generation result storage. Image and video
server copies are still controlled by the admin “download to server” switches,
and the display fallback order remains local cache, remote result URL, then
server copy.
