# Changelog

`foolcore` is a fork of [AionCore](https://github.com/iOfficeAI/AionCore) (Apache-2.0), vendored into this repository at version 0.1.54. Release history from before the fork lives in that project; this file records what has changed here.

## 0.1.54 — unreleased

- Crates renamed to the `fool-*` namespace; the binary ships as `foolcore` and is compiled from source by `scripts/buildFoolcore.js` rather than downloaded.
- Environment variables, HTTP headers and the startup handshake carry this project's own prefixes.
- The update check resolves releases from this repository.
- The built-in assistant is registered as `fool-assistant` / The Jester, and the built-in agent as The Fool CLI.
- The `fool-config` skill documents how to read and write themes, so the assistant can create one.
