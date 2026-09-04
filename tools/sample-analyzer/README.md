# M0.16 样本分析工具

纯 Node.js CLI，无 npm 依赖；视频详细探测调用 `ffprobe`（找不到时仍会完成文件/图片分析）。建议 Node.js 20+。

## Windows 示例

```powershell
node .\tools\sample-analyzer\analyze.mjs `
  --root "D:\InfinityNikki\X6Game\Saved\GamePlayPhotos" `
  --root "D:\InfinityNikki\X6Game\Video" `
  --output ".\sample-report"
```

如果 ffprobe 不在 PATH：

```powershell
node .\tools\sample-analyzer\analyze.mjs --root "..." --ffprobe "C:\ffmpeg\bin\ffprobe.exe"
```

## 输出

- `analysis-report.json`：机器可读，后续可直接喂给 Resolver 测试。
- `analysis-report.md`：人类可读调查报告。

## 当前调查项

1. HighQuality / LowQuality / Video 路径与 UID。
2. 每个源文件的 SHA-256、大小、mtime、birthtime。
3. JPEG/PNG 尺寸。
4. JPEG 中 EXIF/XMP/Motion XMP 标记。
5. JPEG 中所有 `FFD9` 出现位置的统计，重点报告“首个 EOI 后是否仍有数据”。
6. 视频 codec/container/fps/duration/creation_time/audio。
7. 静态图 ↔ 视频候选评分。
8. HighQuality ↔ LowQuality 候选评分。

## 注意

此工具暂不直接调用 `nuan5_decryption.dll`。原因是 M0.16 的第一目标是先确认原始文件之间的**物理关系与确定性 ID**。拿到真实样本报告后，再把 NikkiGallery 的解密适配器接成可选插件，并比较解密后的 SocialPhoto 数据是否存在可用于配对的资产 ID。
