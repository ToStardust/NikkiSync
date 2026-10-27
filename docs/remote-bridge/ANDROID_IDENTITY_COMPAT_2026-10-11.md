# Android 设备身份初始化兼容修复

一加 Ace 2V 测试者在启动时看到“设备身份初始化失败 / java.lang.IllegalStateException: Not initialized”。用户说明拿到的是昨天的 APK；对应本地交付为 versionCode 12 / `0.2.11-rotation-return`。具体已安装 APK 与 ColorOS/Android 升级版本尚未取得，不能由型号确定。官方出厂规格为 ColorOS 13.0 / Android 13：https://www.oneplus.com/cn/ace-2v/specs 。

## 原因与证据边界

旧 `DeviceIdentity` 使用系统默认 `KeyPairGenerator.getInstance("Ed25519")`，没有指定实现或初始化参数。同样依赖默认 JCA 的 `KeyFactory` 读取私钥、`Signature` 签名。Android 可提供仅支持 keystore 密钥的 Ed25519 实现；没有可导出软件实现时，生成阶段会抛出 `Not initialized`。直接增加 `NamedParameterSpec` 不能解决 AndroidKeyStore 对别名和 KeyGenParameterSpec 的要求，也不能维持当前 PKCS#8 加密存储模型。

- Android 参考源码的 `generateKeyPairHelper()` 在缺少初始化 spec/store 时抛出相同异常：https://android.googlesource.com/platform/frameworks/base.git/+/85c87b13cd4b853f5cd466ad8fa91bf3d2226713/keystore/java/android/security/keystore2/AndroidKeyStoreKeyPairGeneratorSpi.java 。
- Android 不保证给定算法由特定 provider 提供：https://developer.android.com/privacy-and-security/cryptography 。
- 本地测试移除 JVM 的可导出 Ed25519 后备 provider，再提供 keystore-only 实现，旧生产代码首次启动 RED 为 `IllegalStateException: Not initialized`，旧身份读取 RED 为 `InvalidKeySpecException`。如果保留 SunEC/桌面 BC，JCA 自动后备会掩盖失败；这个测试限制是必要的。

这是与截图匹配且可复现的代码缺陷；没有对方调用栈或实机复测，仍不宣称已确认测试者所有错误来源或一加硬件验收通过。

## 实现

`Ed25519IdentityKey` 使用固定依赖 `org.bouncycastle:bcprov-jdk18on:1.86` 的 lightweight Ed25519 与 ASN.1 API，负责生成、PKCS#8 导入/编码、公钥 SPKI 和签名。不注册/替换全局 JCA provider，不依赖手机厂商 Ed25519 的选择顺序，也不自己实现密码算法。

- 仍用安全随机数生成独立密钥；仍为普通 Ed25519，而非 Ed25519ph/ctx。
- 私钥仍由原有 `SecureBlobStore` 使用 AndroidKeyStore AES-GCM 包装；不增加明文后备、权限请求或网络初始化。
- prefs 名称、私钥 blob 名称、PKCS#8、SPKI、Base64URL、deviceId 与协议 v1 保持兼容。
- 已有身份可以直接读取，保留公钥、deviceId 和已配对 PC；只有原有不可恢复包装密钥的重建分支仍需要重新配对。
- 不修改照片预览、液态玻璃、顶部模糊、预测性返回、缓存、分享图或 LIVE 导出。
- Bouncy Castle 许可证随 APK 作为 `res/raw/bouncycastle_license.txt` 分发，第三方说明已补充。

APK 版本为 versionCode 13 / `0.2.12-identity-compat`。Android 最低版本仍为 13 / API 33。

## 验证

- 针对性 6 项测试通过：首次启动/重启、保留旧配对身份、RFC 8032 §7.1 向量、生成与持久化、导入已有 JCA PKCS#8、拒绝损坏/截断/错误算法密钥。
- 签名与公钥通过独立 SunEC JCA 验证；标准向量的 PKCS#8、SPKI 和 64 字节签名逐字节一致。
- Android 全量 191 tests，0 failures / errors / skipped。
- Mobile 源码合约 81 项通过。

Robolectric 只用内存 keystore 模拟硬件 AES 包装 key 的持久化；AES-GCM 实际由 JCA 执行。该结果不能替代 ColorOS 的真实 AndroidKeyStore 验收。让测试者覆盖安装修复版，不先卸载或清除数据，再检查首次打开、扫码配对、退出重开后连接与照片加载。

## 交付

- APK：`release/NikkiSync/NikkiSync-Android.apk`，21,720,462 字节，SHA-256 `1ACAF1BC169C629B03E9AE4C6D52867748AD0B1476FF8D04E285CF22D4BA6A47`。实际 aapt 版本为 13 / 0.2.12-identity-compat，API 33/35，v2 签名通过。
- 新旧 APK 的签名证书 SHA-256 相同（`89e768c8947e48a0e6d5471888a264daafd99685ea22e290fc3adca71f5d61cb`），允许保留数据覆盖安装。
- 单 EXE：`release/NikkiSync-Portable-IdentityCompat/NikkiSync-PC.exe`，SHA-256 `FF44A3E632C5D60A9CFB38AB113B3B4E07C082E9A9E9C8E677ACC8CFDB535339`。保留已交付的 Windows 自动发现/启动功能与 Bun 1.3.14 baseline --smol，仅更新内置 Android 安装包。默认 Bun 自动下载再次提取失败，复用之前在工作区 out 保存并核验过的官方 1.3.14 baseline 编译器完成构建，没有修改全局 Bun。
- 实际运行 EXE `--verify-package` 并展开校验：内置 APK 的 SHA-256 与上述 APK 完全相同；输出目录恰好一个 EXE；未启动后台、未触及用户 AppData。证据在 `out/embedded-apk-6ASmel/report.json`，不发布测试输出。
- 本轮没有连接/安装/操作测试者手机；一加实机复测仍待用户进行。不要求清除手机数据、取消配对或更改 PC 游戏目录。
