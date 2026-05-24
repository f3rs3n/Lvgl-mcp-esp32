# LVGL MCP HTTP follow-up roadmap

This fork added Streamable HTTP support while preserving stdio as the default transport. The server is already usable for the Power Sentinel workflow, so the next work should stay conservative: hardening, diagnostics, tests, and upstreamability rather than project-specific features.

## Principles

- Keep `stdio` as the default transport for compatibility with MCP Inspector, Claude Code, and the original upstream behavior.
- Keep HTTP as MCP Streamable HTTP, not a custom REST `/render` API.
- Keep the server generic. Power Sentinel-specific fixtures, scripts, and workflows belong in the Power Sentinel repo.
- Prefer localhost plus SSH tunnel for remote use. Do not bind to the LAN by default.
- Do not auto-start simulator/build servers unless the operator explicitly asks for that.

## Priority 1 — smoke tests

Add small repeatable smoke tests/scripts rather than a large suite:

- `npm run smoke:http`
  - starts or targets an HTTP server;
  - verifies `/health`;
  - verifies MCP initialize/listTools.
- `npm run smoke:render`
  - calls `lvgl_render` at 320x240;
  - asserts `isError === false`;
  - asserts the result contains image output plus widget-tree text.
- Auth checks:
  - no token configured -> requests work;
  - token configured + missing/wrong header -> rejected;
  - token configured + correct bearer header -> listTools works.

## Priority 2 — health/readiness diagnostics

Improve the HTTP diagnostics without leaking secrets.

`/health` should remain cheap and mean “process is alive”. Consider adding `/ready` for deeper checks:

```json
{
  "ok": true,
  "service": "lvgl-mcp-server",
  "transport": "http",
  "version": "1.2.0",
  "simulatorReady": true,
  "buildDirWritable": true,
  "authEnabled": true
}
```

Keep paths out of normal output unless `--verbose` or `LVGL_MCP_LOG_LEVEL=debug` is enabled.

## Priority 3 — auth/token hygiene

Avoid passing tokens on the command line, because they show up in process listings.

Preferred order:

1. `LVGL_MCP_AUTH_TOKEN` environment variable.
2. Optional local token file support, e.g. `--auth-token-file <path>`.
3. CLI `--auth-token` only for quick local experiments.

Document examples using env/file rather than command-line token arguments.

## Priority 4 — build/cache robustness

The simulator build directory and CMake cache are easy to poison when the repo path changes, especially on Windows.

Possible improvements:

- create build directories before writing request-specific source files;
- detect stale `CMakeCache.txt` whose source/build paths do not match the current `LVGL_PROJECT_ROOT`;
- provide `--clean-build` or an npm script to clear stale simulator build state;
- log the effective project root and build dir in debug mode.

## Priority 5 — code organization for upstreamability

Refactor only after the behavior is covered by smoke tests.

Suggested split:

- CLI/env parsing;
- `createMcpServer()`;
- stdio transport startup;
- HTTP transport startup;
- health/readiness helpers.

This keeps the HTTP addition reviewable and makes it easier to propose upstream without making the fork look project-specific.

## Lower priority / avoid for now

Avoid adding these unless there is a concrete need:

- LAN bind as default;
- always-on Windows service/task;
- custom REST rendering API;
- renamed MCP tools or changed tool schemas;
- Power Sentinel-specific fixtures or UI assumptions inside this repo;
- heavy dependencies just for HTTP.

## Current known-good Power Sentinel integration

Current intended pattern is on-demand:

- Windows clone: `C:\Users\marti\Progetti\Lvgl-mcp-esp32`
- Windows start script: `C:\Users\marti\Progetti\start-lvgl-mcp-http.ps1`
- Windows scheduled task `LvglMcpHttp` exists but is disabled.
- Server binds to `127.0.0.1:3333`.
- Hermes reaches it through an SSH tunnel and has `mcp_servers.lvgl` configured at `http://127.0.0.1:3333/mcp`.

When visual rendering is needed, start the Windows script, reload/test Hermes MCP, render, then stop it if desired.
