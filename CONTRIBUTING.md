# Contributing to AhemUI

Thanks for helping. Bug reports, fixes and small improvements are all welcome; for anything bigger, open an issue
first so we can agree on the approach.

## Build and test

You need Node.js 20 or later.

```bash
npm install
npm run build       # everything, incl. the extension and plugin bundles
npm test            # core, server and MCP (stdio) tests
npm run test:e2e    # Playwright browser tests
```

`npm run typecheck` checks all packages, and `npm run dev -w ahemui-example-vue` starts the example app to try
changes in. To try the plugin from your checkout, run `/plugin marketplace add <path to this repo>` in Claude Code.

Keep pull requests focused, add or update tests for behaviour you change, and note user-facing changes under
`## [Unreleased]` in `CHANGELOG.md`.

## Sign-off (DCO)

Every commit needs a `Signed-off-by` line, certifying the [Developer Certificate of Origin](https://developercertificate.org/):
that you wrote the change or otherwise have the right to submit it under the project's licence.

```bash
git commit -s
```

## Licence

AhemUI is MIT licensed ([LICENSE](LICENSE)). By contributing, you agree that your contributions are licensed under
the MIT licence too. The name and logo aren't covered by the licence; see the README.

## Security issues

Please don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md) for how to report one.
