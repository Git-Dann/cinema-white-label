# 0008: One codebase, many operator apps (fleet releases)

Status: accepted, November 2026

## Context

Each operator gets its own branded iOS app. As the number of operators grows, a new feature, an Apple requirement or a fix has to reach every app without per-operator hand work. Apple guideline 4.2.6 means a live template app must be published by the content provider (the operator), and 2.5.2 means new features need a new reviewed build.

## Decision

- One codebase and one fleet version. Each app is described by a brand file (`fleet/brands/<slug>.json`, schema `BrandManifest` in contracts). Its xcconfig is generated from that file.
- Live apps sit in the operator's own Apple Developer account. We hold App Manager there and keep one App Store Connect key per Apple team as GitHub secrets.
- `.github/workflows/fleet-release.yml` builds every app in a ring (internal, pilot, general) and uploads each to its own TestFlight. Submission for review stays manual until the first operator account is connected.
- Update policy is server-side: `fleet/policy.json` (`latestVersion`, `minimumVersion`, per-brand overrides) is served by `GET /v1/t/{tenant}/app-status`. The app suggests a new version once and blocks only below the minimum. Offline never blocks.
- Content and configuration keep changing live from the portal. New features ship switched off behind config so operators can turn them on without a release.

## Dependencies

None added. The fleet tool is plain Node using the contracts package; the workflow reuses the steps and certificate clean-up from the TestFlight workflow; the update prompt uses SwiftUI only.

## Alternatives considered

- **All apps in our account.** Simpler to run, but against 4.2.6 for live apps. Kept only for our demo apps.
- **Fastlane.** Mature, but a Ruby toolchain for what `xcodebuild` and the App Store Connect API already do. Revisit if screenshot and metadata automation grows.
- **One shared picker app for everyone.** Allowed by 4.2.6 and cheapest, but operators want their own brand on the home screen. Planned as an option for small independents only.
- **Code push or remote UI.** Ruled out by 2.5.2 for anything that adds features.
