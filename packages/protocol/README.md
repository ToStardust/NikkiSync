# M0.18 Protocol TypeScript Contract

`src/index.ts` 是协议 v1 的 HTTP/WebSocket source of truth。共享领域类型定义在 `@nikkisync/core`，由 protocol 原名重新导出；PC Companion 不应另建一份 DTO。移动端后续从 protocol 生成/维护等价 Kotlin/Swift DTO。

## 传输分工

- HTTP(S)：server info、分页图库、changes、asset detail、resource bytes。
- WebSocket：只发“发生了变化”的事件，不发图片/视频字节。
- Resource GET 必须支持 HTTP Range，并返回 `Accept-Ranges: bytes`。
- 建议返回 `ETag: "sha256:<64hex>"` 和 `X-NikkiSync-SHA256`，手机保存完成后做 SHA-256 校验。

## LAN 安全基线

PC Companion 首次启动生成并持久化本地 TLS 证书。配对二维码至少包含：

- serverId
- host / port
- 一次性 pairingToken
- protocolVersion
- pairingToken expiresAt
- `tlsFingerprintSha256`

手机首次扫码时只信任二维码中 pin 住的证书指纹；成功配对后将 serverId + TLS fingerprint 持久化，因此 DHCP 改 IP 不影响身份确认。

设备身份采用 Ed25519：手机生成 device keypair，仅把 public key 发给 PC；private key 留在 iOS Keychain / Android Keystore 管理的安全存储。PC 在 `paired_devices` 保存 public key。

### 请求签名

除 `/v1/server` 与一次性 `/v1/pair` 外，客户端请求包含：

- `X-NikkiSync-Device-Id`
- `X-NikkiSync-Timestamp`（Unix 毫秒字符串）
- `X-NikkiSync-Nonce`（至少 128-bit 随机 base64url）
- `X-NikkiSync-Signature`（Ed25519 signature，base64url）

签名明文 UTF-8：

```text
<METHOD>\n
<PATH_AND_CANONICAL_QUERY>\n
<TIMESTAMP>\n
<NONCE>\n
<SHA256_BODY_HEX>
```

GET/HEAD 无 body 时使用空字节串的 SHA-256。服务端拒绝超出允许时钟窗口的 timestamp，并在窗口内缓存 nonce 防重放。

## Revision 语义

- `libraryRevision` 是 PC 远程图库的全局 revision。
- 一个可见资产变更对应一个新的 revision 与一条 `change_journal`。
- WebSocket 事件只有“加速通知”意义。
- 手机重连后必须调用 `/v1/changes?after=<lastRevision>`；若 `fullResyncRequired=true`，丢弃远端索引缓存并重新分页读取 `/v1/assets`。

## 资源模型

普通照片：

```text
Asset(photo)
└─ source_high_quality / source_primary
```

实况：

```text
Asset(motion_photo)
├─ still: source_high_quality / source_primary
└─ motion: source_motion
```

Apple Live Photo / Android Motion Photo 都是“手机端 exporter 的输出”，不改变 PC 原始 Asset/Resource 模型。
