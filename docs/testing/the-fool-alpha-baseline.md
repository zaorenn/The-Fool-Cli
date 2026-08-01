# The Fool Alpha Baseline

**Captured:** 2026-07-29
**Branch:** `feat/the-fool-windows-alpha`
**Upstream base:** The Fool `v2.1.43` (`5ec74f8df`)
**Host:** Windows x64, Europe/Istanbul

## Toolchain

| Tool         | Version                     |
| ------------ | --------------------------- |
| Node.js      | `v24.18.0`                  |
| npm          | `12.0.1`                    |
| Bun          | `1.3.14`                    |
| Rust         | `rustc 1.97.1`              |
| Cargo        | `cargo 1.97.1`              |
| OpenClaw     | `2026.7.1-2 (0790d9f)`      |
| Hermes Agent | `v0.19.0`, Python `3.11.15` |

The existing `bun.lock` remained unchanged after `bun install`.

## Validation results

| Command                          | Result                                       | Notes                                                                            |
| -------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `bun run test`                   | Baseline has 2 environment-specific failures | 2,813 passed, 6 skipped; 342 files passed, 1 skipped, 2 failed; about 60 seconds |
| `bunx --no-install tsc --noEmit` | Passed                                       | About 9 seconds                                                                  |
| `bun run package`                | Passed                                       | About 24 seconds                                                                 |
| `bun run build-win:x64:fast`     | Passed                                       | About 160 seconds; no Defender or file-lock interruption                         |

The two inherited test failures are recorded rather than hidden:

1. `tests/unit/renderer/ContextUsageIndicator.dom.test.tsx` expects a decimal
   point, while the Turkish host locale correctly renders `0,42`.
2. `tests/unit/releasePackagingConfig.test.ts` discovers the WindowsApps WSL
   `bash.exe` shim, which mangles the temporary Windows path before invoking
   Node.

Neither failure is caused by The Fool changes. New work must keep targeted tests
green and must not add failures to this baseline.

## Baseline Windows artifact

- Path: `out/TheFool-2.1.43-win-x64.exe`
- Size: `430817602` bytes
- SHA-256: `2890500AE25B589DE4C715D0F426FDFFCA4B7C16A38DE7E3D86CE0B7B7EAC564`

The artifact is intentionally ignored by Git. It proves that the unmodified
upstream base can be packaged on this workstation before rebranding begins.
