# Third-party notices

## RanAxro/nikki_albums

NikkiSync contains an optional interoperability adapter for the public hot-update format used by `RanAxro/nikki_albums`.

Upstream project: `https://github.com/RanAxro/nikki_albums`

Copyright (c) 2025 Ran

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The upstream software license does not imply that third-party data, names, artwork, or images served by its hot-update endpoints are relicensed under MIT. NikkiSync does not vendor those data files. Current desktop startup enables public dictionary lookup by default; it can be disabled in the local metadata dictionary configuration.

## Game artwork and branding

The MIT license applies to NikkiSync's original source code, not to Infinity Nikki characters, clothing artwork, screenshots, or resources returned by external services. Those rights remain with their respective owners. This is an unofficial player tool.

The Momo branding source and transformations are documented in `assets/branding/README.md`. Its official source image is not relicensed by this repository. Reuse of game artwork, including commercial branding, requires the relevant rights holder's permission.

## Other bundled notices

- `assets/licenses/BUN-LICENSE.md`: Bun runtime license.
- `apps/wechat-mini-program/miniprogram/lib/THIRD_PARTY.md` and `THIRD_PARTY_LICENSES.txt`: Noise/encryption runtime dependencies.
- `apps/windows-shell/PORTABLE_NOTICES.md`: Windows single-file runtime notices; the packaging script preserves .NET, WebView2 and JavaScript dependency notices.
- `apps/mobile/app/src/main/assets/licenses/libjpeg-turbo.txt`: libjpeg-turbo 3.2.0 and Independent JPEG Group notices for Android JPEG rotation. This software is based in part on the work of the Independent JPEG Group. The full notices are included in the APK; the application adds its own bounded backing store and rotation integration without modifying upstream sources.
- Dependency license terms remain applicable independently of NikkiSync's MIT license.

## Android Ed25519 compatibility

Android uses Bouncy Castle `bcprov-jdk18on:1.86` lightweight Ed25519 and ASN.1 APIs for protocol identity generation, PKCS#8 loading and signing. It does not register a global provider. The existing AndroidKeyStore AES-GCM wrapping key remains responsible for private-key encryption at rest.

Upstream: https://github.com/bcgit/bc-java ; license: https://www.bouncycastle.org/licence.html . The full copyright and permission notice is included in the APK as `res/raw/bouncycastle_license.txt`.
