# 医疗报告分析 · med-report

本地优先的检验报告结构化与辅助分析工作台。React + TypeScript 前端、Bun 服务端、SQLite、可选本地 OCR / 经逐文件授权的 GLM 直传解析。支持上传 → 文字提取/OCR → 证据复核 → 手工标注 → 模板映射 → 规则校验 → 经确认的 AI 辅助解读 → 导出。

> 这是可运行的 V1.0 展示与产品化基础版，不是医疗器械或临床决策系统。任何结果都必须回看原文并经专业人员复核；不能用来独立诊断、开药或替代检验审核。演示数据完全虚构，演示规则不构成临床阈值。没有真实样本时，不承诺任意医院版式均可准确识别。

## 快速开始

### 推荐：Docker Compose（本机部署）

安装 Docker Engine / Desktop 与 Compose v2 后，在项目根目录执行：

```sh
cp .env.example .env
# Linux 主机：容器以 UID 1000 的非 root 用户运行，需要目录可写
mkdir -p data file logs
sudo chown -R 1000:1000 data file logs
docker compose up --build -d
```

打开 http://localhost:3001 ，接口文档 http://localhost:3001/api/docs ，OpenAPI JSON http://localhost:3001/api/openapi.json 。

```sh
docker compose logs -f --tail=100
docker compose down
```

关闭服务不删除绑定目录中的数据。备份/迁移时先停服务，再一起备份 `data/`（包括 SQLite 相关文件）、`file/` 和必要的 `logs/`。不要将这些目录或 `.env` 上传到公共代码库。

### 本地开发

安装 Bun 1.4.2+ 即可开发；云解析无需 Poppler、Tesseract、antiword。默认本地模式不出网。无密钥模拟体验：

```sh
cp .env.example .env
bun install --frozen-lockfile
PARSING_MODE=glm GLM_FILE_PROVIDER=mock bun run dev
```

开发页面 http://localhost:5173 ，使用 `admin/admin` 登录。Bun 从项目根目录自动读取 `.env`；示例允许 5173 和 3001 的 localhost/127.0.0.1 Origin。Vite 将 `/api` 转发到 Bun 3001，cookie 保持同源；没有密钥进入 Vite 环境变量。端口保持默认即可。生产方式：

```sh
bun run build
bun run start
```

`.npmrc` 按要求使用 `https://registry.npmmirror.com/`。依赖锁文件随源码提供；不要将实际密钥写入源码、前端构建变量或日志。

## 首次体验

1. 使用固定演示账号 `admin` / 密码 `admin` 登录工作台，选择带有“虚构演示”标记的示例，或上传 `fixtures/` 的测试报告
2. 等待本地后台解析完成；点击字段或证据行，检查文字、页码、行号和不确定性提示
3. 对漏提/误提字段手工标注，关联原始证据；配置参考范围时只能采用报告中注明或经机构审核的规则
4. 在模板中设置标准项目名和别名，再应用至报告；在规则页配置明确单位和数值/定性规则
5. 选择要用于 AI 解读的证据行，先查看脱敏预览，再勾选确认。默认模拟模式不访问外部模型
6. 导出 JSON、CSV 或可打印 HTML；浏览器“打印 → 另存为 PDF”生成 PDF 文件

## 格式支持与已知限制

- PDF：优先使用 Poppler 提取文字；缺少可用文字的页面再本地渲染并 OCR。页数、进程时限和上传大小均受限
- PNG/JPEG：Tesseract 本地 OCR。可选 `local-ocr` Docker 目标内含 `chi_sim+eng`，不依赖 GPU 或第三方 OCR。清晰打印文本优于手写、复杂表格、旋转/低清图片
- DOCX：Mammoth 文字提取，使用段落/行证据。Word 是流式格式，原始物理页码不可靠；不能把逻辑页当作 Word 排版页。嵌入图片没有保证自动 OCR
- DOC：通过 antiword 提取旧版 Word 文字；缺少组件时返回明确提示。图片型 DOC 不保证识别
- TXT：UTF-8 文本，用于演示和测试
- 不支持密码保护文件、损坏文件、任意办公格式和压缩包。对于复杂多列、合并单元格、跨页表格，必须人工复核
- 自动字段提取是保守启发式，不是经过临床验证的版面模型。识别不完整、单位不匹配或缺少参考范围时显示“不确定”，不会臆造阈值或单位换算
- 原始文件保留本地；当前证据视图基于提取文本，不等于精确 PDF 框选定位/全格式原生预览

## GLM-5.3-Flash 文件解析（与医疗解读独立）

- `PARSING_MODE=local` 为默认；本地失败只显示错误/缺失工具，不会自动出网。选择上传文件后可以显式改为 GLM 或本地。
- 无工具体验：`PARSING_MODE=glm GLM_FILE_PROVIDER=mock bun run dev`。MOCK 返回固定虚构内容，不识别上传文件、不访问模型，也不需要密钥。
- 实时文件解析：仅在本机 `.env` 设置 `PARSING_MODE=glm`、`GLM_FILE_PROVIDER=live`、`GLM_FILE_API_KEY`。模型固定 `glm-5.3-flash`，服务端 `GLM_FILE_ENDPOINT` 默认普通 API。不得复用此前在聊天公开过的凭证；本交付没有获取、使用或验证任何真实密钥。
- 医疗解读仍使用 `AI_MODE` / `GLM_API_KEY` / `GLM_MODEL=glm-5.3`，不会因开启文件解析而自动启用。
- 每次先选择文件、模式、生成确认，再核对接收域名/完整端点、文件名、大小、SHA-256 和完整文件发送提示，手动勾选同意。预览阶段仅向本机发送元数据。上传会发送完整原件，含身份信息、隐藏内容、附件，不进行脱敏；自定义端点运营方可能不是智谱。取消则不发送文件。后端将同意绑定当前会话、文件字节摘要/名称/大小、GLM 模式和端点，10 分钟失效、单次使用。配置变更/重启/重试需重新确认。
- 模型输出严格检查 JSON `{lines: string[]}`、数量、长度和完成状态；不执行指令或工具调用。模型转写行标为 `method=model`、`page=null`，无原文页码/坐标，自动候选保持低置信度和“不确定”；人工标注后才使用已有规则。原件仍保存在本机并可下载核对。模板、历史、导出沿用已有工作流；模型转写不等于逐字证据，完整性和数值正确性无法由 schema 保证。
- 请求不重试，默认超时 60 秒（配置 1–120 秒）；响应最大 1 MiB，转写最大 2000 行/每行 1000 字符/总计 20 万字符。共享有界队列默认并发 2、排队 32。失败可能已传输，不自动换模式或端点。
- 应用限额：完整文件最大 20 MiB（同时受 `MAX_UPLOAD_MB` 更小值约束）；图片最大 4 MiB、每边不超过 6000。直传不使用本地 PDF 工具，因此不能按本地 `MAX_PAGES` 裁页；发送的是完整文件，超长文件需先手工拆分，不保证全页覆盖。

2026-09-30 重新核对 [Flash 模型文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) 和 [对话补全参数](https://docs.bigmodel.cn/api-reference/模型-api/对话补全.md)：图片 `image_url.url` 使用 Base64 Data URL；文件 `type=file`、`file:{filename,file_data}`，与 `file_id/file_url` 三选一。请求开启 thinking，使用 low 推理和 8192 token；未盲套旧视觉模型参数或假设视觉接口支持 JSON response_format。官方文件上限 50M、图片小于 5M，本应用更保守。PDF 有明确文件示例；Word 泛称支持，但 **DOC/DOCX 仅模拟验证，真实格式兼容性未实测、不能保证**。

用户提供的 Coding 技术端点是 `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions`；可以通过上述服务端端点变量配置，但技术可达不代表账户/条款允许。[Coding Plan 官方适用范围](https://docs.bigmodel.cn/cn/coding-plan/overview) 限定支持的编程工具场景，不应用于本自建医疗应用生产调用；生产默认普通 API 按量服务，需自行核对服务商授权和数据处理条款。本文不声称 Coding 或普通端点已实测成功。

显式本地 OCR 模式：Debian/Ubuntu 安装 `poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim antiword` 后，选择本地解析。TXT / DOCX 本地文字提取不需系统 OCR；图片型 Word 不保证识别。Docker 默认 `cloud` 轻量目标不安装这些工具；需本地 OCR 时执行 `DOCKER_TARGET=local-ocr docker compose up --build -d`。镜像轻量化不会改变默认不出网策略，仍需选择 GLM 并同意；可以在 `.env` 设置 `GLM_FILE_PROVIDER=mock` 先验证流程。

## AI 接口与隐私

默认提供商接口：`https://open.bigmodel.cn/api/paas/v4/chat/completions`，可通过服务端 `GLM_ENDPOINT` 配置。兼容请求采用 `messages` 和可配置 `model`。此交付未使用真实密钥，未调用真实服务；模型名称、Coding 端点可用模型及账户授权必须在用户自己的账户中验证。

```dotenv
AI_MODE=mock
GLM_API_KEY=
GLM_MODEL=glm-5.3
```

默认模型为 `glm-5.3`，API 标识已核对 [智谱官方 GLM-5.3 文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)。对该模型的请求开启思考、使用 `low` 强度和 8192 输出 token 上限，完整参数仍在发送前预览中显示；没有调用真实服务来验证账号、Coding 端点或质量。新数据目录使用这个默认值；已有数据库保留用户保存的模型设置，请在“研究与模型设置”将模型改为 `glm-5.3` 并保存。已有 `.env` 也应更新 `GLM_MODEL`；环境变量不会覆盖已保存的设置。

启用真实模式前：撤销曾在聊天/源码中暴露的旧密钥，在本机 `.env` 配置新的 `GLM_API_KEY`，重启服务，然后在设置中检查模式及模型。设置页只显示“是否配置”，不显示或保存密钥。默认 `mock`；模型解读明确标注模拟/真实模式。

医疗报告默认留在本机。AI 解读必须先选择证据行，服务器生成脱敏预览，再由用户明确同意提供商和本次发送内容。服务器只使用已保存且未过期的预览，不能用客户端任意文本绕过。简单脱敏不能保证去除所有姓名、院号、地点或自由文本中的身份信息；用户必须逐行检查，未脱敏内容不要勾选。配置的专科/疾病背景同样可能透露健康信息，真实发送前必须检查。当前最小化适配器仅发送已支持的医学术语和已识别的测量字段；自由文本或未支持项目可能被排除，必须以完整请求预览为准。

报告、OCR 文本及模型输出均视为不可信数据，不执行其中的命令，不将报告内“系统指令”提升为权限。模型输出引用必须来自已批准的证据。AI 结果仍可能错误，引用存在不等于临床结论成立。

## 16 核 / 32GB 服务器资源建议

面向 CPU-only 16 核、32GB 机器。默认 Compose 先给应用最多 8 CPU、12GB 内存，保留操作系统和其他服务余量；OCR 并发 2、每进程 2 线程。上传后台排队，避免长 OCR 占住请求，也避免每次上传无限启动子进程。并发、队列和文件限制可配置，详见 `.env.example` 与 Compose。

这些是保守启动预算，不是吞吐量承诺。实际容量受扫描页数、DPI、语言和布局影响，应使用自己的已脱敏样本测量 CPU/内存/P95 完成时间后逐步提高并发。当前开发环境未进行目标 16 核/32GB 压力验收，也未验证 GPU。长报告达到页数限制时必须显示截断/复核提示，不能当作完整报告。

## 架构与接口

- `src/`：React 单页工作台、历史、模板、规则、设置与授权预览
- `server/`：Bun HTTP API、SQLite 持久化、后台解析队列、证据、规则、模型边界、导出、OpenAPI
- `data/`：本地 SQLite；`file/`：本地原文件；`logs/`：不包含报告正文或密钥的运行日志
- `fixtures/`：虚构样本；`tests/`：隔离临时目录运行的集成/安全测试
- OpenAPI 与 Swagger UI 本地提供，无需外链 CDN；`server/CONTRACT.md` 给出接口约定

可通过标准 HTTP JSON 接口对接其他系统，但本版不包含已认证的 LIS/HIS 集成、机构账号/RBAC、多租户、审计合规认证或医院级高可用。

## 安全边界与运维

默认只在本机访问；Compose 仅绑定 `127.0.0.1:3001`，请不要直接改成公共监听。数据库和原文件不是应用层加密存储，建议主机全盘加密、最小文件权限、受控备份和保留/删除制度。上线到内网多人使用前必须补齐 HTTPS、身份验证、角色权限、访问审计、恶意文件隔离/查杀、数据保留策略和合规评审。固定 `admin/admin` 只用于本机演示，不能保护真实医疗数据，也不可公开部署。所有报告、原件、导出及其余业务 API 都在服务端校验登录。登录采用随机 HttpOnly、SameSite=Strict cookie，8 小时到期；退出立即撤销当前会话；服务重启后需重新登录。HTTP 本机开发可用，直接 HTTPS 请求还会设置 Secure。反向代理 TLS 场景需要额外审查，不要把本 demo 当生产认证方案。

可选 `APP_TOKEN` 保留给脚本使用：设置后，业务 API 接受 `Authorization: Bearer <APP_TOKEN>` 或有效演示会话二者之一。它不会关闭 `admin/admin`，不能用来把这个演示系统变成公网安全系统。浏览器无须输入或保存 API Token。健康检查和登录/会话/退出接口公开，接口文档也需先登录。

上传与 OCR 解析原生文件存在资源和解析器风险，应保持依赖更新，仅接收可信来源文件。容器以非 root 运行并移除 Linux capabilities。后台任务为单进程队列，重启中的任务不保证续跑；应检查状态并重新上传/重试。

## 验证

```sh
bun run typecheck
bun test
bun run build
```

具体执行结果、环境限制和未执行项见 `VALIDATION.md`。任何未运行的 Docker 构建、真实 GLM 调用、目标硬件压测都不能视为通过。

## GitHub 与 CI

源码包含最小权限的 GitHub Actions 校验配置（类型检查、虚构样本测试、构建）。本地生成不等于已经发布到 GitHub；只有用户确认目标仓库后才应推送。CI 在真实密钥缺省的模拟模式运行，不需要也不应添加医疗报告或生产密钥到仓库。
