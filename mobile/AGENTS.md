This is the Android client of 夜猫看台 (NightOwl Terrace), an Expo/React Native app. The desktop Electron app at the repository root is the source of truth for algorithms, fixtures, and server-side aliases. Read [`README.md`](./README.md) before changing data, playback, or notification code.

## Project invariants

- **Android only.** `app.json` declares `platforms: ["android"]`; do not add iOS configuration or native folders.
- **Never hand-edit generated files.** `src/shared/{core,data,server}`, `src/data/sync/tz.js`, `src/data/crests.ts`, and `assets/crests/` come from the desktop app. Change root `src/core`, `src/data`, `server/*.json`, or `public/crests`, then run `npm run sync:shared` / `npm run sync:crests`. `npm run verify:shared` must pass before finishing.
- **No backend, no proxy.** Streams are played directly by the native player. Do not add a local or remote relay, signing-channel fallbacks, or bundled stream addresses; `TV_SPORTS_CHANNELS` stays an empty array. Never download, transcode, or re-host video.
- **Notifications are build-gated.** `expo-notifications` must stay dynamically imported behind `EXPO_PUBLIC_NOTIFICATIONS_ENABLED === '1'` and the `storeClient` check. Do not statically import it into a path Expo Go can execute. Native notification verification requires an EAS development/preview APK.
- **UI baseline.** Dark theme only; gold is reserved for key decisions; minimum text 10px; touch targets at least 44pt; spoiler-free is the default. Keep the four-tab decision flow instead of porting desktop multi-pane UI.
- **Checks before declaring done:** `npm run verify:shared`, `npm run typecheck`, `npm run export:android`. Any change touching notifications, PiP, HLS, cleartext HTTP, or safe areas also needs a real-device smoke test on an EAS APK.
- **Secrets.** Never commit keystores, `.env` files, personal channel URLs, or Expo tokens. The EAS project ID is not a secret.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
