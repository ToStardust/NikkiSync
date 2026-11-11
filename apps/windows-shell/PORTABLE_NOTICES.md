# NikkiSync portable distribution

NikkiSync is an unofficial Infinity Nikki photography companion.
The Windows package links to the current NikkiSync Android test APK; it does not bundle the APK.
Third-party cryptography notices are in runtime/wechat/THIRD_PARTY_LICENSES.txt.

The Windows desktop host uses Microsoft .NET 8 (MIT) and WebView2 SDK.
WebView2 Evergreen Runtime is a separately installed Microsoft component;
the desktop displays an official installation link if it is absent.
- https://github.com/dotnet/runtime/blob/main/LICENSE.TXT
- https://github.com/dotnet/wpf/blob/main/LICENSE.TXT
- https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2903.40

The compiled background executable includes Bun (MIT).
- https://github.com/oven-sh/bun/blob/main/LICENSE.md
- https://bun.com/docs/bundler/executables

Windows program updates use xdelta3 3.2.2 (Apache License 2.0) to reconstruct
a new EXE from a signed delta manifest and a verified old EXE. Its license is
included in runtime/licenses/xdelta3-LICENSE.
- https://github.com/jmacd/xdelta/releases/tag/v3.2.2

Local photo decoding uses nuan5_decryption, developed and maintained by
RanAxro, the author of Nikki Albums. The initial DLL was obtained through
MeowStarMap; this build uses the author's v3.012.02 Windows DLL.
Distribution is permitted by RanAxro subject to attribution. The DLL is a
separately distributed binary; the source-code MIT notices below do not
represent an assertion that its decoding algorithm is open source.
- https://github.com/RanAxro/nikki_albums
- https://github.com/QianQianLuLu1/MeowStarMap
- https://github.com/RanAxro/nikki_albums/issues/21#issuecomment-6725988953

Optional online photo decoding is provided by NUAN5.PRO after user opt-in.
Earlier versions used clothing icons hosted and organized by 暖暖共鸣录;
current icon delivery has moved to NikkiSync's own local package and hosting.
These service and source attributions do not grant game artwork rights.
- https://nuan5.pro/
- https://gongeo.us/
- https://github.com/ToStardust/NikkiSync/issues/13
- https://github.com/ToStardust/NikkiSync/issues/14

The photo effect name mapping uses public data from Nikki Albums and
Infinity Nikki Toolkit. The MIT notice below applies to the toolkit sources;
game resource names and artwork remain subject to their respective rights.
- https://github.com/sumopenny/Infinity-Nikki-Toolkit

This basic distribution does not provide experimental mini-program LIVP export.
Photo download, original MP4 download, outfit information and share cards remain available.
Android LIVE export uses its native media pipeline.

MIT license notice (Bun): Copyright (c) 2022-present Jarred Sumner.
MIT license notice (.NET): Copyright (c) .NET Foundation and Contributors.
MIT license notice (MeowStarMap): Copyright (c) 2026 QianLu.
MIT license notice (Nikki Albums source): Copyright (c) 2025 Ran.
MIT license notice (Infinity Nikki Toolkit): Copyright (c) 2026 sumopenny.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
