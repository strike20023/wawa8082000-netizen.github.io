# 解谜提示网站

这个仓库使用 NocoDB 编辑提示内容。编辑者只需要填写一张表、上传可选附件，然后点击“发布网站”。发布器会直接生成 `docs/`、提交并推送，GitHub Pages 随后部署公开页面。

## 编辑者使用方法

内容表只保留以下可见字段，并按这个顺序排列：

| 字段 | NocoDB 类型 | 说明 |
| --- | --- | --- |
| 剧集 | Single Select 或 Single Line Text | 例如“隐秘的见证” |
| 提示名称 | Single Line Text | 例如“1-2-1” |
| 提示词 | Long Text | 可以为空，但提示词和多媒体不能同时为空 |
| 多媒体 | Attachment | 可上传多张图片、音频或视频 |
| 罚时（秒） | Number | 留空时默认 180 秒 |
| 发布网站 | Button | 任意一行的按钮都会发布整张表 |
| 网址 | URL | 发布器自动填写，放在最右侧，不要手工编辑 |

另建一个名为 `公开ID` 的 Single Line Text 字段并在日常视图中隐藏。发布器会在第一次发布时自动填写它。

日常操作：

1. 编辑提示词或上传附件。
2. 点击任意一行的“发布网站”。
3. 等待发布完成后，复制最右侧的“网址”。

单个附件最大 95 MiB。NocoDB、发布器和 Git 提交钩子使用相同限制。

## 一次性配置

### 1. 配置 Codespaces secrets

创建一个只允许读写这张内容表的 NocoDB API Token，并在 Codespaces 中设置：

```text
NOCODB_API_TOKEN
NOCODB_BASE_ID
NOCODB_TABLE_ID
```

如果不使用 Codespaces secrets，也可以复制 `.env.example` 为 `.env.local`。不要提交 `.env.local`。

### 2. 配置发布按钮

在内容表增加 Button 字段“发布网站”，选择 **Run Webhook**：

```text
Method: POST
URL: http://127.0.0.1:8787/publish
```

不需要配置 Header 或发布密码。发布服务只监听容器内部的 `127.0.0.1`，不会作为 Codespaces 端口公开。按钮触发后会立即返回，后台继续生成和推送。可以在 Codespace 终端查看状态：

```bash
curl http://127.0.0.1:8787/status
```

### 3. 首次构建 Codespaces 镜像

手动运行 GitHub Actions 中的 **Build NocoDB Codespaces image**。镜像生成后，确保 `ghcr.io/strike20023/nocodb-git:latest` 对该仓库的 Codespaces 可读，然后创建 Codespace。

## 本地维护命令

```bash
npm test
npm run check:site
npm run check:size
npm run publish
```

发布器只暂存 `docs/`，不会把 API Token 或 NocoDB 的内部目录提交到公开仓库。原有 `info.xlsx` 当前仅用于第一次把历史内容导入 NocoDB；新发布链不会读取它。完成首次导入并核对 18 条内容后即可删除。
