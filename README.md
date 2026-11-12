# Cubbit · 方块仔

> A tiny cube on both your desktops. Poke it, your partner feels it.
> 两只桌面上的小方块：戳一下，对方会有感觉。

This repository is the open-source source snapshot of **Cubbit v2.9.5**, the current Windows release (2026-11-12), published from `softlaunch-2.5`. Earlier history keeps the previous `v2.9.1-soft` and `v2.6.3-soft` snapshots. Windows installers are attached to GitHub Releases, not committed to the repo.

- **Download (always latest):** https://pingguye.cn/cubbit/dl/windows/latest
- **Release notes:** https://github.com/yepinggu66/cubbit/releases
- **Website:** https://pingguye.cn/cubbit/

Payments happen outside the app (PayPal.me for most regions, WeChat / Alipay QR codes in mainland China) and activation codes are issued manually by the developer; no automated checkout is built in.

## What is Cubbit?

Cubbit is a small Electron desktop pet for couples and close friends:

- a cube that lives on your desktop, reacts when poked;
- pokes, hearts and presence are delivered in real time to the other side;
- a shared "couple room", chat, and small interactions;
- lightweight, always-on-top, low-distraction.

## Tech stack

- **Electron 45** (main / preload / renderer)
- **PubNub** for realtime presence & messages
- **electron-updater** for updates
- Vanilla HTML/CSS/JS renderer (no frontend framework)

## Quick start

Requirements: Node.js 20+ and npm.

```bash
npm install
npm start
```

Build a Windows installer / portable exe:

```bash
npm run dist
# or only portable:
npm run dist:portable
```

Output goes to `dist/`.

## Configuration

Realtime credentials are **client-side PubNub publish/subscribe keys**, not secrets:

- defaults live in `src/main/couple/service.js` (`DEFAULT_PUBLISH_KEY` / `DEFAULT_SUBSCRIBE_KEY`);
- override with environment variables `CUBBIT_PUBNUB_PUBLISH_KEY` / `CUBBIT_PUBNUB_SUBSCRIBE_KEY`;
- for a fork, please use **your own PubNub keys** to avoid consuming this project's quota.

The updater URL is configured in `package.json` (`build.publish`).

## Project layout

```
src/main/        Electron main process (window, tray, couple service, license)
src/preload/     contextBridge APIs
src/renderer/    UI: pet, couple-room, chat, onboarding, paywall, settings
resources/       tray icons
build/           app icons
site/            landing page + short promo videos
mobile/          mobile web demo pages
landing/         alternative landing assets
docs/            delivery / launch notes
```

## Status & scope

- This is the public source snapshot of the current Windows release (**2.9.5**); it is not a production-hardened or security-audited build.
- The license verification public key is included (`src/main/license/public-key.pem`); the private signing key is **not** in this repository.
- Analytics, payment and account backend endpoints are not included; they are external services.
- No warranty; see LICENSE.

## License

MIT — see [LICENSE](LICENSE). The Cubbit name, logo and visual assets are trademarks of Cubbit Studio and are **not** granted by the MIT license for use in a way that implies endorsement.

## Security

See [SECURITY.md](SECURITY.md). Do not commit private keys, `.env` files or user data.
