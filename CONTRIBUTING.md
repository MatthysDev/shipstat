# Contributing

Issues and pull requests are welcome.

```sh
pnpm install
pnpm --filter shipstat test && pnpm --filter shipstat lint     # module
pnpm --filter shipstat-dashboard test && pnpm --filter shipstat-dashboard build
packages/sdk/test/ios/run.sh                                  # iOS native core, on the Mac (Xcode)
cd apps/example && npx expo prebuild -p android --no-install && cd android \
  && ./gradlew :shipstat:testDebugUnitTest                    # Android native core (Robolectric)
node packages/dashboard/bin/shipstat-dashboard.mjs --demo     # dashboard on sample data
cd apps/example && npx expo run:ios                           # example app and Perf lab
```

- Keep `track()` cheap: anything that is not handing data to native code belongs on the native background queue.
- Native changes must build on iOS and Android and keep both native test suites green; they cover the same scenarios (`packages/sdk/test/ios/main.swift`, `packages/sdk/android/src/test`), so a new case goes in both. Run the Perf lab in a release build when touching the hot path.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `perf:`, `docs:`…), in English.
- No personal data in events, logs or fixtures.
