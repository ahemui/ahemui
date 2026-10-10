# Releasing AhemUI

A release is the npm package `ahemui`, the Claude Code plugin (this repo is its marketplace, so the plugin is
whatever is committed at the tag) and a browser-extension zip, attached to the GitHub release and later uploaded to
the Chrome Web Store. The default branch is `main`.

1. Move the notes under `## [Unreleased]` in `CHANGELOG.md` into a new version heading with today's date.
2. Set the version everywhere and build it as a release:
   ```bash
   git switch main && git pull
   npm run set-version 0.4.1
   AHEMUI_RELEASE=1 npm run build
   npm test
   ```
   The release build stamps the plugin as plain `0.4.1` (local builds are `0.4.1-dev.<build id>`).
3. Commit everything, including the rebuilt plugin bundle (`packages/claude-plugin/server`, `scripts`, `vendor`),
   then tag and push. The tag check compares the tag with the versions committed in the repo, so the release build
   outputs must be in the commit you tag:
   ```bash
   git commit -am "Release 0.4.1"
   git tag v0.4.1
   git push origin main v0.4.1
   ```
4. The **Release** workflow checks the tag against the versions, builds, tests, publishes `ahemui` to npm with
   provenance, and attaches `ahemui-extension-v0.4.1.zip` to a GitHub release.
5. Once the store listing exists, upload that zip in the Chrome Web Store developer dashboard (and Edge Add-ons, if
   listed). Until then, people download it from the GitHub release and load it unpacked.

npm publishing uses a trusted publisher (GitHub Actions OIDC), so no npm token is stored anywhere.

## First release

npm trusted publishing can only be set up for a package that already exists, so the very first publish (0.4.0) is
done by hand:

1. Follow steps 1–3 above for `0.4.0` (set the version, `AHEMUI_RELEASE=1 npm run build`, test, commit, but hold
   off pushing the tag).
2. Publish from that release build, with npm 2FA:
   ```bash
   npm login
   npm publish -w ahemui --access public
   ```
3. On npmjs.com, open the `ahemui` package → Settings → Trusted publishing, and add GitHub Actions: repository
   `ahemui/ahemui`, workflow `release.yml`.
4. Create the GitHub release for `v0.4.0` by hand and attach the extension zip (the contents of
   `packages/extension/dist`, zipped as `ahemui-extension-v0.4.0.zip`). Pushing the tag also runs the workflow, but
   its npm publish step fails because 0.4.0 is already on npm, so it stops before making the release.

From 0.4.1 on, releases go through the tag workflow only.
