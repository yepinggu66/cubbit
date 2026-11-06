# Security

- **Do not commit private keys, `.env` files, signing certificates or user data.** The repository `.gitignore` excludes the obvious cases; review your diff before pushing.
- PubNub **publish/subscribe keys are client-side** and are visible in any Electron app. If you fork this project, replace them with your own keys so your quota is not consumed by others.
- The license **public** key lives at `src/main/license/public-key.pem`; the private key is not part of this repository.
- This snapshot includes external service endpoints (PubNub, update server, account backend). Review them before deploying your own build.
- Report security issues privately to the maintainer instead of opening a public issue with a working exploit.
