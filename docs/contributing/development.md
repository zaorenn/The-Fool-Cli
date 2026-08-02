# Development Setup

## Prerequisites

- [Bun](https://bun.sh) for the desktop app's dependencies and scripts
- Node.js 22 or 23 (`>=22 <25`, as declared in `package.json`) — `bun install` rebuilds native modules against Electron and needs it
- A stable Rust toolchain for the backend (`rustup` installs one; the exact version is pinned in `backend/core/rust-toolchain.toml`)

On Windows, install the Rust MSVC toolchain. If Rust compilation fails because native build tools are missing, install **Microsoft C++ Build Tools** from the Visual Studio installer, then reopen your terminal. The same build tools are what `bun install` uses to rebuild `better-sqlite3` and `uiohook-napi` — without them the app starts but loses the database and hold-to-talk.

Nothing else is fetched by hand. On its first run the backend downloads the Node runtime and the agent CLIs it needs into your user data directory; a packaged installer carries them instead, which is the only difference between the two.

## Repository Layout

Everything lives in this one repository — the desktop app and the backend it runs.

```text
The-Fool-Cli/
|-- packages/desktop/     Electron app (main, preload, renderer)
|-- backend/core/         foolcore, the Rust backend the app launches
|-- backend/agent/        the agent SDK crates, consumed by path
`-- resources/            icons, installer support, staged backend binary
```

The backend is **not** fetched from anywhere at build time. `scripts/buildFoolcore.js` compiles `backend/core` with cargo and stages the binary at `resources/bundled-foolcore/{platform}-{arch}/foolcore[.exe]`, which is where `binaryResolver.ts` looks for it.

## Quick Start

```bash
git clone https://github.com/zaorenn/The-Fool-Cli.git
cd The-Fool-Cli

bun install
node scripts/buildFoolcore.js   # compile the backend once
bun run start                   # launch the desktop app in dev mode
```

The app launches `foolcore` itself and passes the backend port to the renderer — you do not need a second terminal for it.

## Rebuilding the Backend

After changing anything under `backend/`, recompile and restart the app:

```bash
node scripts/buildFoolcore.js
bun run start
```

The Electron app owns the backend subprocess, so a running instance keeps using the binary it started with. Quit it before rebuilding.

Two environment variables adjust the build:

| Variable               | Default        | Effect                 |
| ---------------------- | -------------- | ---------------------- |
| `FOOL_BACKEND_ARCH`    | `process.arch` | Target architecture    |
| `FOOL_BACKEND_PROFILE` | `release`      | Cargo profile to build |

For faster iteration on backend code, `FOOL_BACKEND_PROFILE=debug` cuts compile time considerably.

## Working on the Backend Directly

`backend/core` is a normal cargo workspace with a `justfile`:

```bash
cd backend/core
cargo test -p fool-<crate>            # test one crate while iterating
cargo clippy -p fool-<crate> -- -D warnings
cargo test --workspace                # full suite, takes 10+ minutes
```

See [backend/core/AGENTS.md](../../backend/core/AGENTS.md) for the crate layering rules and testing requirements.

## Backend Startup Troubleshooting

### `Cannot find "foolcore" binary`

The staged binary is missing. Run `node scripts/buildFoolcore.js` and check that `resources/bundled-foolcore/{platform}-{arch}/` now contains `foolcore` (or `foolcore.exe`).

### Backend changes do not show up

Quit the app before rebuilding. A running instance holds the old binary for the lifetime of its subprocess.

### Windows Rust build errors

Use the Rust MSVC toolchain and install Microsoft C++ Build Tools. After installing or changing toolchains, open a new PowerShell window before rebuilding.

## Packaging

```bash
bun run build-win        # Windows installer
bun run build-mac        # macOS
bun run build-deb        # Linux .deb
```

These run `scripts/build-with-builder.js`, which compiles the backend first and then hands off to electron-builder.
