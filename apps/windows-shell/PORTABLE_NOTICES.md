# NikkiSync portable distribution

NikkiSync is an unofficial Infinity Nikki photography companion.
The Windows package includes the current NikkiSync Android test APK.
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

This basic distribution does not provide experimental mini-program LIVP export.
Photo download, original MP4 download, outfit information and share cards remain available.
Android LIVE export uses its native media pipeline.

MIT license notice (Bun): Copyright (c) 2022-present Jarred Sumner.
MIT license notice (.NET): Copyright (c) .NET Foundation and Contributors.

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
