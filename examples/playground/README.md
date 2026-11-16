# Playground

A small fitness app (onboarding, paywall A/B test, purchase, settings) instrumented with Shipstat, used to test the module the way an external app would: it installs the packed npm tarball, not the workspace source.

```sh
# from the repository root
pnpm --filter shipstat build && (cd packages/sdk && npm pack --pack-destination ../..)
cd examples/playground && npm install
node ../../packages/dashboard/bin/shipstat-dashboard.mjs --port 8790   # in another terminal
npx expo run:ios      # or: npx expo run:android
```

Events go to `http://localhost:8790/events` (`10.0.2.2` on the Android emulator); the dashboard is at http://localhost:8790.
