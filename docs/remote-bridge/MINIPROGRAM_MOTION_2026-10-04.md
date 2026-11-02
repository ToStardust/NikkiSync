# 小程序照片与参数面板动效

日期：2026-10-04（Asia/Hong_Kong）。工作区 NikkiSync-RemoteBridge，分支 feature/remote-bridge-foundation。用户反馈上一版功能“可以，没问题”，但没有对应动画，因此本轮只补微信小程序动效。仍未 commit/push/merge，不修改 EXE/APK、游戏、数据库、Live、NUAN5 或连接安全协议。

## 实现范围

- 照片打开有轻微放大和淡入；下拉时外层图片跟随手指移动、轻微缩小，背景与工具栏逐渐淡出，透出原相册。未达到原有返回条件或取消手势时回弹；确认返回时动画完成后才移除预览。没有新增照片切换的装饰动画，也不回写原生 movable-view scale-value。
- 参数面板从底部进入，握柄可跟手上拉/下拉；展开、收起和关闭用可重定向 CSS transition，不再动画前就移除面板。固定外壳高度，通过 transform 改变停靠位置；scroll-view 在两个状态切换视口尺寸，但不逐帧动画 height。只在握柄响应拖动，内容滚动保持独立。
- 高频触摸在新增 motion.wxs 渲染层处理；touchmove 不逐帧 callMethod 或 setData，开始/结束及原生 scale 事件仍经原有照片 frame 校验。原生缩放值只记录私有状态，外层动画与内层缩放分离。
- 照片退出 180ms、回弹 180ms、打开 200ms；面板打开/切换 220ms、关闭 160ms。照片采用 cubic-bezier(0.23,1,0.32,1)，面板采用 cubic-bezier(0.32,0.72,0,1)。动画属性仅 transform/opacity，模糊半径不变。
- 提供 CSS prefers-reduced-motion 支持；系统支持该媒体查询时保留淡入淡出、去除拖动位移。连接面板亦有“减少动态效果”本地开关供不暴露系统偏好的微信环境使用，仅保存非敏感布尔偏好。
- 关闭与后台/卸载/切图取消旧动画定时回调；重复关闭不启动多个退出，新面板重开使旧 unmount 无效。高清/参数/工具栏的无关渲染不得重置正在进行的拖动；多指操作不误触工具栏。

依照[微信官方 WXS 手势示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageAPI/pages/framework/wxs/movable.wxs)的渲染层节点 setStyle/callMethod 方式实现，并对照[官方模板属性变化监听](https://github.com/wechat-miniprogram/glass-easel/blob/master/glass-easel/guide/zh_CN/basic/template.md)。没有复制示例中的 left/top 动画；本工程只动外层 transform/opacity。

## 动画源码审查

使用 review-animations 技能审查动效代码；只用于审查，不让其扩大到其他业务。下面是本轮修正后的审查记录，不是独立子代理或真机性能审计。

| Before | After | Why |
| --- | --- | --- |
| 返回直接隐藏图片 | 独立 photo-stage 跟手，退出后才卸载；index.js:338 / motion.wxs:28 | 保持手势与页面去向的空间连续性，不碰原生缩放控制属性 |
| 参数面板关闭即移除，展开只有高度变化 | infoMounted 与 infoOpen 分离，固定外壳用 transform，160/220ms 强缓动；index.js:202 / motion.wxs:94 | 让进入/退出可见，避免逐帧布局动画 |
| 无关属性刷新可能覆盖渲染层拖动 | 对 frame/phase/settle/reduced 等字段做变化判定；motion.wxs:30 / motion.wxs:96 | 高清加载或参数更新不能让图片/握柄突然回到初始位置 |
| 同帧 pinch 结束可能成为点击 | 多指结束抑制 tap；动画序号隔离旧回调；index.js:20 / index.js:325 | 保持快速操作与后台退出的状态一致 |
| 缺少减少动态效果处理 | CSS 媒体查询 + 本地开关，保留 120ms 透明度过渡；index.wxss:99 | 保留状态提示、减少位移，兼顾未提供系统偏好的环境 |

### Verdict

**Performance**：动作仅改变 transform/opacity，无 transition:all、逐帧 height/left/top、动态 blur 或每次 touchmove 的逻辑层往返。Node 的渲染层替身测试验证这一结构，不代表测得手机 FPS。

**Interruptibility & timing**：CSS transition 可重定向；进入、退出、回弹有独立短时长。生命周期与旧回调有回归。反向拖动、边界手感、低端机和真实微信原生渲染仍需要手机观察。

**Origin, physicality & cohesion**：照片是围绕画面中心轻微缩小后向下退出，面板来自底部。没有实现精确缩回原缩略图位置的共享元素动画，也没有修改用户已确认的返回距离判定；不宣称完整 iOS 相册动画复刻。

**Accessibility**：系统媒体查询及手动减少动态效果已落地，仍需在支持系统偏好的实际微信环境复验。

**Approve（源码层）**：没有已识别的阻断级源码动效问题；这不是手机视觉、流畅度或全机型放行。

## 验证证据

- 新 motion.test.mjs：初始 **7 RED**；实现后 GREEN。审查新增“无关刷新重置拖动”和“静止多指误触”得到 **2 RED**，修正后动画专项 **9/9 PASS**。
- 聚焦 motion/interactions/page/navigation/zoom/save：**45/45 PASS**。旧模板合约改为验证 WXS 入口，保留单原生容器、不可变缩放初值及显式返回要求。
- npm run test:wechat：**109/109 PASS**，新 motion 测试已纳入主入口。
- npm test -- --runInBand：**87/87 PASS**，本轮重新执行的独立 Node 主工程回归，不是把微信用例重复计数。
- 微信 CLI preview：成功，纯代码包 **208,381 字节**；只更新开发预览，不发布/提审，不含真实照片、UID、实际密钥或本机地址。
- 最新开发预览：out/wechat-gallery-motion-preview.png；这是开发入口，不是含临时密钥的 PC 连接码。
- git diff --check：通过，只有既有 LF/CRLF 提示。

## 设备验收边界

上一版功能用户报告正常，本轮没有操控手机、采集动画录像或 FPS，不把 WXS 的 Node VM 测试/开发预览成功冒充手机动画通过。请完全退出旧小程序后扫码进入本版，再用 EXE 的微信连接码连接：

1. 照片打开、短下拉后回弹、完整下拉返回；确认底下是原相册，选择不丢失。
2. 缩放到原图、高清加载期间拖动，再切图；确认不恢复抽搐，也不误返回。
3. 参数打开、握柄连续上拉/下拉、按钮快速展开/收起、关闭后立即重开；内容滚动不带动面板。
4. 在退出/展开中切后台再返回；不存在旧回调关闭新图片或新面板。
5. 手动减少动态效果，以及支持系统减少动态效果的手机；确认保留淡入淡出，不出现跟手位移。

工具栏返回与照片下拉使用本轮退出动画。系统原生返回仍交给唯一 page-container 的离开事件处理，不宣称已经支持系统返回的逐帧预测进度。EXE/APK 无需更新。
