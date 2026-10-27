# 照片随详情面板上移缩小

用户要求：底部上拉详情显示穿搭时，照片跟随同一动画向上移动并缩小，完整显示在未遮挡的上方区域。

## 实现

- PhotoViewerPage 在详情打开时保持现有照片视图，通过实际面板上沿计算可用区域、照片缩放和中心位置，不创建动画截图或重复解码。
- ChromeNavigationHost 将详情的实际布局及 translationY 变化传回照片页；入口、预测性返回、取消、提交、拖动和展开均使用同一个几何来源，没有第二个独立计时动画。
- 详情首帧先保持在屏幕外，测量布局完成后才开始 300ms 上拉，避免零高度导致初始跳变。待开始监听随页面移除清理，保留导航 generation 防止已取消入口覆盖返回。
- 照片按已有 0/90/180/270 度方向适配，保留整张照片，不改原资源或共享图片返回的裁切坐标。
- 详情最大高度为可用高度的三分之二，展开后仍保留上方预览空间，内部内容继续滚动。其他普通设置/编辑弹层不受此高度限制。
- 打开详情前取消尚在执行的图片缩放/平移动画，保留当前逻辑缩放与平移；详情打开后自动适配，关闭时恢复。原导航 interrupt 会重置照片，这里在入栈后恢复所记录的预览状态。
- 图片晚到且长宽比改变、重新布局时重新适配。真实关闭后清空详情几何状态，可再次打开。
- 保留粉色背景、GPU 液态玻璃和顶部模糊、照片缩放/分页/下拉返回、保存/分享及 LIVE 功能。没有改 PC 解析逻辑；EXE 打包仍应含前轮普通照片队列修复。

## 验证

新增 PhotoDetailsViewportTest 最初三项均 RED：旧版照片被遮挡、展开不留空间、缩放照片无法适配。修复后通过；另加入口中间帧和晚到图片回归。

- 四个方向检查照片边界完整处于面板上方；预测性返回进度、取消、关闭和重新打开。
- 展开保留上方空间，面板拖动位置变化同步反映到照片，复位恢复。
- 已缩放和平移照片打开详情后适配，关闭恢复之前状态。
- 真实入口 ValueAnimator 的 0/100/200ms 中间帧验证照片连续移动；使用同一窗口尺寸与正常动画时长，避免测试窗口重测量触发导航 interrupt 造成假失败。
- 现有 SharedImage native Skia 旋转返回及 ChromeNavigationHost 手势/导航回归通过。
- Android 全量 214 tests，0 failures / errors / skipped；stageDebugApk 成功。
- mobile:validate 82 文件、主题 4/4、portable contracts 6/6 通过；git diff --check 通过。
- APK v2 签名验证通过，与前版相同证书；实际 aapt 版本为 0.2.17-details-viewport / versionCode 18。

APK SHA-256：48705b16d5f99f0ea105a1c6136b34985a557a5e717fd1e8f464b0a9a7d390fd。

## 交付与限制

当前 APK：release/NikkiSync/NikkiSync-Android.apk。
匹配绿色包目录：release/NikkiSync-Portable-DetailsViewport。

独立 APK：release/NikkiSync-Portable-DetailsViewport/NikkiSync-0.2.17-Android.apk。
EXE SHA-256：0a2980b32cf2d2bd7d1996bab3a2055b720c5ad220ba151db7d1bc0e37b8c117。
实际 --verify-package 展开验证内嵌 APK 与当前签名 APK 哈希一致，验证时目录只有一个 EXE，用户配置未触碰。验证报告：out/embedded-apk-Anxctt/report.json；构建报告：out/portable-build-a446ea2c3a1d498fbb0a9e2f158976f7/build-report.json。验证完成后再复制独立 APK，便于直接发送给手机测试用户。

本轮没有手机覆盖安装或实际硬件帧率/手势验收。单元测试和源码检查不能代表真机 60/120Hz 验收；没有清空手机缓存、重新配对或写入相册，没有新增公开二进制 Release。
