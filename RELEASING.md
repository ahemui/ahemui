# Releasing AhemUI

A release is the npm package `ahemui`, the Claude Code plugin (this repo is its marketplace, so the plugin is
whatever is committed at the tag) and a browser-extension zip for the Chrome Web Store.

1. Move the notes under `## [Unreleased]` in `CHANGELOG.md` into shape.
2. Set the version everywhere and build it as a release:
   ```bash
   npm run set-version 0.4.1
   AHEMUI_RELEASE=1 npm run build
   npm test
   ```
   The release build stamps the plugin as plain `0.4.1` (local builds are `0.4.1-dev.<build id>`).
3. Commit everything, including the rebuilt plugin bundle (`packages/claude-plugin/server`, `scripts`, `vendor`),
   then tag and push:
   ```bash
   git commit -am "Release 0.4.1"
   git tag v0.4.1
   git push origin main v0.4.1
   ```
4. The **Release** workflow checks the tag against the versions, builds, tests, publishes `ahemui` to npm with
   provenance, and attaches `ahemui-extension-v0.4.1.zip` to a GitHub release.
5. Upload that zip in the Chrome Web Store developer dashboard (and Edge Add-ons, if listed).

npm publishing uses a trusted publisher (GitHub Actions OIDC), so no npm token is stored anywhere. Set it up once on
npmjs.com under the `ahemui` package → Settings → Trusted publishing: repository `ahemui/ahemui`, workflow `release.yml`.
