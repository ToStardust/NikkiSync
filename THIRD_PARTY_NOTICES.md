# Third-party notices

## RanAxro/nikki_albums

NikkiSync contains an interoperability adapter for the public hot-update format used by `RanAxro/nikki_albums`, and includes verified photo effect names from its public language files.

Windows local photo decoding uses `nuan5_decryption`, developed and maintained by RanAxro / Nikki Albums. The initial DLL was obtained through MeowStarMap. The current Windows DLL is the author's v3.012.02 build and is distributed under the author's attribution condition in https://github.com/RanAxro/nikki_albums/issues/21#issuecomment-6725988953 . The decoding component is a separately distributed binary and is not asserted to be covered by the source-code MIT license below.

Upstream project: `https://github.com/RanAxro/nikki_albums`

Copyright (c) 2025 Ran

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The upstream software license does not imply that game names, artwork, or images served by its hot-update endpoints are relicensed under MIT. Current desktop startup enables public dictionary lookup by default; it can be disabled in the local metadata dictionary configuration.

## Infinity Nikki Toolkit

Verified photo effect identifiers and names are also derived from https://github.com/sumopenny/Infinity-Nikki-Toolkit . Copyright (c) 2026 sumopenny. The MIT permission and warranty notice above applies to those source materials. Game names and artwork remain subject to their respective rights.

## Game artwork and branding

The MIT license applies to NikkiSync's original source code, not to Infinity Nikki characters, clothing artwork, screenshots, or resources returned by external services. Those rights remain with their respective owners. This is an unofficial player tool.

The Momo branding source and transformations are documented in `assets/branding/README.md`. Its official source image is not relicensed by this repository. Reuse of game artwork, including commercial branding, requires the relevant rights holder's permission.

## External services and historical image source

NUAN5.PRO provides an optional third-party online fallback for photo parameter decoding. It is disabled by default and can be enabled or disabled in desktop sync settings. See https://nuan5.pro/ and https://github.com/ToStardust/NikkiSync/issues/13 . It is a service attribution, not a source-code license notice.

Earlier NikkiSync versions referenced clothing icons hosted and organized by 暖暖共鸣录 (gongeo.us). Current icon delivery has migrated to NikkiSync's own local package and hosting. See https://gongeo.us/ and https://github.com/ToStardust/NikkiSync/issues/14 . This attribution does not assert that game artwork is licensed by either project.

## Other bundled notices

- `assets/licenses/BUN-LICENSE.md`: Bun runtime license.
- `apps/wechat-mini-program/miniprogram/lib/THIRD_PARTY.md` and `THIRD_PARTY_LICENSES.txt`: Noise/encryption runtime dependencies.
- `apps/windows-shell/PORTABLE_NOTICES.md`: Windows single-file runtime notices; the packaging script preserves .NET, WebView2 and JavaScript dependency notices.
- `apps/mobile/app/src/main/assets/licenses/libjpeg-turbo.txt`: libjpeg-turbo 3.2.0 and Independent JPEG Group notices for Android JPEG rotation. This software is based in part on the work of the Independent JPEG Group. The full notices are included in the APK; the application adds its own bounded backing store and rotation integration without modifying upstream sources.
- Dependency license terms remain applicable independently of NikkiSync's MIT license.
- Android uses Google desugar_jdk_libs 2.1.5 to backport Java library APIs. Upstream: https://github.com/google/desugar_jdk_libs . The complete upstream license and Classpath exception are bundled at `assets/licenses/desugar-jdk-libs.txt` in the APK.

## Android Ed25519 compatibility

Android uses Bouncy Castle `bcprov-jdk18on:1.86` lightweight Ed25519 and ASN.1 APIs for protocol identity generation, PKCS#8 loading and signing. It does not register a global provider. The existing AndroidKeyStore AES-GCM wrapping key remains responsible for private-key encryption at rest.

Upstream: https://github.com/bcgit/bc-java ; license: https://www.bouncycastle.org/licence.html . The full copyright and permission notice is included in the APK as `res/raw/bouncycastle_license.txt`.
