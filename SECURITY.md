# Security policy

AhemUI runs on developers' machines and inside their browsers, so we take reports seriously.

## Reporting a vulnerability

Email **security@ahemui.com** with a description, steps to reproduce and the version (`npx ahemui --version`,
or the version in `vivaldi://extensions` / `chrome://extensions`). Please don't open a public issue first.

You'll get an answer within 5 working days. Once a fix is released we credit the reporter unless you'd rather not be named.

## Supported versions

Only the latest minor release gets security fixes.

## How AhemUI is meant to be safe

- `ahemui serve` listens on `127.0.0.1` only, checks the `Host` header (DNS rebinding) and the `Origin` against the
  project's `devOrigins`, the extension, and its own board. Only local tools without an Origin can widen that list.
- The browser extension's page overlay runs in an isolated world: page scripts can't read the backlog or reach the
  local server through it. Its service worker only relays a fixed set of API paths.
- On deployed sites, password fields, anything marked private, emails, long numbers and URL query strings are
  masked or scrubbed before a capture leaves the page.
- AhemUI sends nothing to any AhemUI-run service. Captures go to the local server and into the repo.

Reports that break any of these are in scope.
