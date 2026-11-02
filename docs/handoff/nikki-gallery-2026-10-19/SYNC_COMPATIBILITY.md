# NikkiGallery SyncServer 接入核对

## 身份与资源

保留自己的扫描器、media_files 与 UI，通过适配层输出协议的 Asset / Resource。serverId、TLS证书、公钥、设备凭据必须持久化，不能每次启动/扫描重新生成。两个服务端分别配对，不能只复制对方的凭据来合并身份。

媒体通过认证 HTTPS 下载，WebSocket 仅传事件。资源必须声明正确 resourceId、role、mimeType、sizeBytes、sha256；不要用预览图冒充 source_primary/source_high_quality。

LIVE 需同一 Asset 提供静态源、source_motion，以及 motion.stillResourceId / motionResourceId 的准确关联。支持 Range 请求、原始完整字节和稳定校验值；保留游戏源文件，不把导出处理后的副本哈希当作源哈希。

## 路由与能力

| 能力 | 路径/行为 |
| --- | --- |
| 服务信息、配对 | `/v1/server`、`/v1/pair` |
| 相册与详情 | `/v1/assets`、`/v1/assets/:id`，游标分页及 libraryRevision |
| 原始资源 | `/v1/assets/:id/resources/:rid`，认证、Range、准确长度/哈希 |
| 参数 | `asset.metadata`；不能只有 editor_metadata 或永远空 camera |
| 服装图片 | `/v1/assets/:id/clothing/:clothingId/thumbnail`，真实可访问图片 |
| 套装、单件搜索 | `/v1/search/suits`、`/v1/search/clothing` |
| 常用搭配统计 | `/v1/profile/stats` |
| 元数据更新 | `/v1/assets/:id/metadata`；按实际支持情况处理，不能把拒绝写入伪装为成功 |
| 变更 | `/v1/changes?after=...`，支持 fullResyncRequired |
| 实时同步 | `/ws/v1`，HTTPS升级后发送 server.hello、后续revision事件，并回应标准ping |

当前电脑还实现 `/v1/assets/:id/resources/:rid/export?exif=true&rotation=0`，用于经校验的普通照片 EXIF/旋转导出。这是实现层路由，未加入 API_ROUTES 常量；需要自行核对并实现，不能因为主协议仍为v1就假设该功能已自动兼容。旋转只接受0/90/180/270，服务端转换后返回导出副本的校验信息；源文件不变。

`capabilities` 应反映真实能力。手机现有部分功能会直接调用相应接口，单纯省略能力字段不能代替完整兼容验收；没实现的接口需列为缺口，不能宣称所有功能已接通。

## 参数、缓存与变更

1. 对同照片调用自己的本地 decoder，经过 `metadata-adapter.mjs` 标准化；编辑器LUT或水印参数不能代替游戏参数。
2. 公共字典只按精确ID补名称和类别；不按图片相似度、数字尾号或另一张照片借参数。
3. 缓存按服务器身份、照片/资源版本、decoder与字典版本区分。参数丰富后产生该照片新revision，并进入变更日志/WS；否则手机详情缓存可能长期显示旧值。
4. `identity.gameVersion` 明确值优先；列表提供 gameVersion/gameVersionSource，详情可提供 identity.gameVersionEnglishName。推测必须保留来源，不能写成明确版本。
5. 可见参数需要保留；原生编码token等内部字段不应为了补全而直接全部发送给手机。NikkiSync在row-mappers中移除内部原生参数payload与对应校验字段。
6. 原始文件变化需更新资源长度/哈希/版本，不能只改路径；历史资源不可静默指向另一份照片。

## 发现与恢复

广播 `_nikkisync._tcp.local` 的 PTR/SRV/TXT/A，TXT提供serverId，端口与HTTPS服务一致。网络变化后刷新地址、组播接口及缓存。接收端允许Android服务类型格式差异。

仅响应合法DNS查询，不对自身或其他响应再次广播；不生成组播循环。发现只是定位，后续仍按原配对TLS指纹及签名认证，不能因TXT里的serverId匹配就取消校验。

在实际打包环境测试 WSS 101响应、server.hello、事件、ping/pong、关闭重连。NikkiGallery若使用不同运行时，应在自己的EXE上测试；NikkiSync的Bun版本结论不能替代其Node/Electron验收。

## 数据保留

本轮 NikkiSync 没有新增协议版本或数据库SQL迁移。版本日历保存在已有设置表；Android修图关联有向前迁移，需要保留原条目。NikkiGallery现有sync_devices、sync_change_journal应继续由自身适配层维护，扫描器无需替换。
