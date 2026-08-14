# Bot VM supervisor and daemon contract

This is the trust boundary between OpenBOT's desktop coordinator and a bot's
dedicated virtual machine. The endpoint is not a cosmetic screen preference:
when a bot targets a VM, OpenBOT must not silently execute that bot's files,
commands, or agent CLI on the host.

The repository contains the hardened desktop client, a bundled guest daemon
(`out/main/vmDaemon.js` plus its generated chunks), and a local Apple
Virtualization.framework supervisor. The managed path provisions one
lightweight Linux VM per bot through Apple's open-source `container` runtime,
with a persistent workspace and an Openbox/X11 desktop. It does not use Docker
or a shared host kernel. External supervisors can provide a hardware VM, private
tunnel, and a different screen/input implementation through the same contract.
Until an endpoint advertises a capability, OpenBOT removes the matching tools
and refuses direct attempts to call them.

## Binding and authentication

```ts
type ComputerTarget =
  | { kind: 'local' }
  | { kind: 'browser'; botId: string }
  | {
      kind: 'vm'
      vmId: string
      endpoint: string
      token?: string      // write-only renderer input
      hasToken?: boolean  // renderer-safe status
      capabilities?: string[]
      managed?: 'apple-vm'
    }
```

- `endpoint` must be a bare `http` or `https` loopback origin, such as
  `http://127.0.0.1:8790`. Paths, query strings, fragments, embedded
  credentials, redirects, and non-loopback hosts are rejected.
- The supervisor is responsible for exposing the guest daemon over that local
  origin (for example through a private socket/tunnel).
- OpenBOT sends `X-OpenBOT-VM-ID: <vmId>` on every request and
  `Authorization: Bearer <token>` on every request. A per-VM token is required.
- Tokens are encrypted with Electron `safeStorage` (Keychain on macOS) and are
  never returned to the renderer or written into a bot document.
- The managed VM receives only `SHA-256(token)`, never the bearer token.
  Reading guest arguments, environment, or `/proc` therefore does not yield
  a credential that can authenticate to the daemon. External supervisors may
  pass a raw token and should protect it from guest workloads equivalently.
- Responses are JSON, bounded to 24 MiB, and remain under request timeout and
  user-cancellation control until the complete body has been consumed.

## Required HTTP API

| Method | Path | Request body | Response |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true, detail?: string, capabilities?: string[] }` |
| `GET` | `/active_app` | — | `{ app: string }` |
| `GET` | `/screenshot` | — | `{ image: string, width: number, height: number, scale: number }` |
| `POST` | `/click` | `{ x, y, button, clickCount }` | `{ ok: true }` |
| `POST` | `/move` | `{ x, y }` | `{ ok: true }` |
| `POST` | `/type` | `{ text }` | `{ ok: true }` |
| `POST` | `/key` | `{ combo }` | `{ ok: true }` |
| `POST` | `/scroll` | `{ x, y, dx, dy }` | `{ ok: true }` |
| `POST` | `/drag` | `{ from: [x, y], to: [x, y] }` | `{ ok: true }` |
| `POST` | `/open_app` | `{ name }` | `{ ok: true }` |
| `POST` | `/navigate` | `{ url }` | `{ ok: true }` |
| `POST` | `/box/tool` | `VmBoxToolRequest` | `VmBoxToolResponse` |
| `POST` | `/lifecycle/start` | `{}` | `{ ok: true }` (external supervisors) |
| `POST` | `/lifecycle/suspend` | `{}` | `{ ok: true }` (external supervisors) |
| `POST` | `/lifecycle/destroy` | `{}` | `{ ok: true }` (external supervisors) |

`/health` is accepted only when it explicitly returns `ok: true`. A random
service listening on the configured port is not treated as a VM daemon.

### Capabilities

The daemon may report:

- `box-exec-v1` — bot processes and commands execute in the VM.
- `box-files-v1` — bot filesystem operations are rooted in the VM.
- `computer-v1` — screenshot, active-app identity, and input routes are present.
- `desktop-v1` — the computer surface is a general graphical desktop rather
  than a browser-only implementation.

Both are required before the target can be described as an isolated execution
box. The desktop records them after an authenticated probe and then routes
filesystem, shell, fetch, and web-search tools through `/box/tool`. Without
both, those tools are unavailable rather than falling back to the host.
Computer tools similarly require `computer-v1`. Supervised agent-CLI backends
remain unavailable until the supervisor implements in-box agent-process
execution.

### Approval-preserving box RPC

The bundled daemon accepts a canonical tool call, the effective allow/deny
settings, and the approval signatures already granted for that call:

```ts
interface VmBoxToolRequest {
  call: ToolCall
  approvals: string[]
  settings: EffectiveSettings
}

type VmBoxToolResponse =
  | { result: ToolResult }
  | { approval: { signature: string; request: ApprovalDraft } }
```

The first request runs only far enough to produce any approval. The desktop
shows that request through its normal gate and, if accepted, retries with the
signature. If a later phase requires a distinct approval, the exchange repeats.
This preserves file diffs, destructive-action forcing, shell deny rules, and
out-of-workspace warnings without giving the guest permission to draw its own
trusted UI. Eight distinct approval rounds is the hard ceiling.

The reference daemon binds to `127.0.0.1` by default, requires both bearer token
and VM id, caps request bodies, accepts only filesystem/shell/web tools, roots
relative paths at `OPENBOT_BOX_ROOT`, and cancels work when the desktop
disconnects. The managed supervisor binds it to the VM interface and relays it
through a randomly selected, restart-stable `127.0.0.1` host port. The bridge
retargets the VM's private address after every boot. The managed guest launches
Xvfb, Openbox and headful Chromium and advertises `computer-v1`/`desktop-v1`
only after a visible X11 window is ready. X11 is never published on the VM
network; screen capture and input stay behind the authenticated daemon.

## Screen and input invariants

- `image` is a base64 PNG without a `data:` prefix. OpenBOT validates the PNG
  signature and rejects dimensions above 32768 pixels.
- Downscale to roughly 1400 px on the long edge. `scale` is returned width
  divided by native width.
- All input coordinates use the most recent returned screenshot's pixel space.
- An action response is sent only after the action has actually been delivered;
  OpenBOT captures the next frame immediately.
- `/active_app` must return a stable app identity. It is how the user's
  per-application computer-use allowlist is enforced without requiring `*`.
- During human takeover, the desktop maps pointer, wheel, paste and keyboard
  events from the focused remote-screen surface to these same authenticated
  calls. Human input is never converted into a model tool call.

Key combinations are lowercase, `+`-separated, modifiers first: `enter`,
`shift+tab`, `cmd+s`, `ctrl+alt+delete`, and so on.

## Lifecycle and ownership

- One VM belongs to one bot. The daemon must verify both token and VM id.
- Managed VM lifecycle is performed directly through the local runtime
  after verifying immutable OpenBOT ownership labels. Lifecycle HTTP routes are
  for external supervisors; a guest process must not pretend it destroyed its
  own isolation boundary.
- Browser/app state persists over suspend/resume.
- Deleting a bot asks the supervisor to destroy its VM, then removes local
  credentials and references. Local deletion still completes if the VM has
  already disappeared. Managed boxes carry a per-data-profile ownership marker,
  and a later launch garbage-collects owned orphan ids once the runtime is back.
- Start, suspend, and destroy calls are idempotent.

Approval prompts, action policy, routine orchestration, model reasoning, and
transcript storage remain coordinator responsibilities. The guest must still
enforce authentication, target ownership, path containment, and process
isolation: coordinator approval is not a substitute for a sandbox.

## Human administration of managed boxes

The built-in supervisor has one deliberately separate privileged path. After a
human stops the bot and takes over, the desktop may use Apple `container exec`
to start a root command inside an OpenBOT-owned VM. This command never crosses
the guest HTTP API, is not registered as a model tool, and is available only
after the supervisor repeats the immutable ownership-label check. The regular
daemon continues to run as the host user's numeric uid and gid.

The system layer is writable so the owner can install command-line, background
and X11 graphical packages. `/workspace`, including Chromium's profile, remains
a separate persistent bind mount. The bundled Xvfb/Openbox desktop is captured
with `scrot` and controlled with `xdotool`; it deliberately exposes no VNC, X11
or other unauthenticated remote-desktop listener. GPU-heavy or non-X11 software
may still require an external VM implementation of this contract.
