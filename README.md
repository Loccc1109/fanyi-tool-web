# 套图本地化工具 · V2 Web（纯静态版）

本目录可以单独构建、上传 GitHub 并部署到 Cloudflare Pages。**线上只需要 `dist/` 静态文件，不需要 Python、FastAPI、OpenCV、本机后台或 Cloudflare Worker。** V1 和本机 V2 不受影响。

## 本地运行

需要 Node.js **22.12 或更新版本**，推荐新版 Chrome / Edge。请使用 HTTPS 或 localhost；不要双击 HTML 以 file:// 打开。

```powershell
cd D:\project\玩具套图翻译工具\v2-web
npm ci
npm run dev -- --port 5180
```

打开终端显示的网址（通常 http://127.0.0.1:5180）。也可以双击本目录的 `启动Web版.bat`。这里启动的只是静态开发服务器，没有 Python 后台。

生产构建与本地预览：

```sh
npm run build
npm run preview -- --port 5180
```

## GitHub + Cloudflare Pages

1. 上传源码和 `package-lock.json`，不要上传 `node_modules/`、密钥、图片或个人历史备份。
2. 在 Pages 创建项目并连接 GitHub 仓库。
3. 如果仓库是整个项目，**根目录设为 `v2-web`**；如果只上传本目录内容，则根目录留空。
4. 构建命令：`npm run build`；构建输出目录：`dist`；Node 版本设为 `22.16.0` 或其他 >=22.12 的版本。
5. 不需要 API Key 环境变量、Python 服务或 `/api` 代理。构建后 `dist/_headers` 包含 CSP 等安全头。
6. 若手动上传部署，上传 `dist` 内全部文件，而不是源码目录。

代码中的 `/api/...` 是显式导入的 **JavaScript 本地接口适配层**，内部访问 IndexedDB / Worker，并不会向网站服务器发出这些请求。远程付费接口才使用真正的网络请求。

## 重要：静态网页不能解决的限制

### 1. CORS 是硬要求

翻译 API、生图任务 API，以及返回成图的下载域名，都必须允许你的网页域名跨域访问。API 预检通常需要：

```http
Access-Control-Allow-Origin: https://你的项目.pages.dev
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key
```

本应用不发送 Cookie；允许 `*` 的服务也可用。最终成图域名也须允许 GET 响应被浏览器读取。HTTPS 页面不能使用普通 HTTP 远程接口。修改网页或 Pages 响应头**不能替第三方 API 开启 CORS**。

若供应商不支持浏览器跨域，只能换支持的供应商，或另加受保护的代理（代理就不是全静态方案）。不要使用公开的免费 CORS 代理传递密钥和商品图。

### 2. 浏览器不能隐藏密钥

每位使用者在页面右上角自行填写 API 设置。Key 默认保存在当前标签页会话的 sessionStorage；勾选“在此浏览器记住 Key”后会明文保存在 localStorage。页面支持清除 Key。备份不包含 Key。

**不要把共享主密钥写进源码、VITE_* 环境变量、构建文件或 GitHub。** 建议使用限额、可撤销的个人 Key；在可信个人设备使用。图片会发给你配置的 API，不是全程离线处理。

### 3. 历史记录不是云同步

原图、原始 AI 图、对齐图、灰度蒙版、结果和编辑参数保存在当前浏览器、当前域名的 IndexedDB。换浏览器、换域名、清理网站数据或隐私模式可能导致记录不可用。Pages 部署不会替你备份数据。

在“历史记录”中使用 **导出备份 / 导入备份**迁移；备份包括商品图，请安全保管。导入跳过同 ID 记录，不覆盖现有记录。只支持 Web 版自己导出的 ZIP；本机 V2 的 Python 历史不会自动迁移。备份目前有大小限制，较大项目请分批处理并及时保存成图。

### 4. 页面需要保持打开

任务由当前浏览器驱动，关页或刷新会停止本地轮询和处理，不提供服务器后台队列。重新打开历史任务后，可“重试失败项”续查已保存的生图任务 ID，不自动再次提交。

在提交结果不确定（网络中断、超时、返回缺失 ID）时，会保留不确定状态并阻止盲目重新扣费。请先到供应商后台确认任务 ID，在重试提示中填入以接续。没有查清时不要另建任务重复提交。再次点击“按当前设置重新生成”是新任务，会再次调用付费接口。

## 功能与操作

- 导入商品文件夹，按主图 / PC / 手机 / 品牌故事分类，支持四种目标语言。
- 浏览器直连 OpenAI 兼容 `/v1/chat/completions` 多模态翻译接口。
- 生图沿用本机版的异步 `/v1/tasks` 格式：`kind:image`、`operation:generate`、`input.image` data URL，轮询任务并下载 `result_urls`。**不是任意供应商协议都兼容；本版没有自动转接 `/images/edits` 等其他协议。**
- 默认并发 2，最多 4；翻译按最多 4 图一批发送。API 连通性测试为无付费 GET 探测，不能替代真正的 POST / 下载验证。
- Worker 内完成 AI 平移对齐、差异蒙版、颜色偏移微调、人工平移 / X/Y 缩放和无损 PNG 编码。
- **Web 版自动对齐是保守的小平移搜索，不是 Python/OpenCV 的 ECC 仿射实现**；轴向缩放可手动调整。低置信度时留空蒙版，绝不整张替换。
- 所有改图进入待确认；圆形画笔、实心/柔边、擦除、矩形、撤销/重做、羽化、显示/隐藏蓝色修改范围、按住对比原图均保留。
- 蓝色是辅助显示，不写入蒙版或成图；确认前等待 Worker 最终合成预览完成。灰度柔边与羽化使用同一条预览/保存计算链路。
- 确认后才进入批量输出。未授权文件夹时下载 ZIP；Chrome/Edge 授权文件夹后可直接写入，不覆盖已有同名文件。以图片 ID 子目录避免不同源图同名冲突。
- 历史可回到主工作区、编辑、重试、输出；局部重编辑不会重新调用付费生图 API。
- 不需要替换文案时直接保留原图文件字节；修改后的结果为 PNG，保留蒙版外的**浏览器解码后 RGBA 像素**，不承诺原 JPEG 字节、ICC / EXIF 元数据或不同解码器间色彩完全相同。羽化支持范围以最终有效灰度蒙版为准。

## 浏览器与容量

依赖 IndexedDB、Web Locks、Web Worker、OffscreenCanvas、createImageBitmap 和安全上下文，建议桌面新版 Chrome/Edge。直接文件夹写入另依赖 File System Access；不支持时仍可下载 ZIP。

每批最多 100 图、原图合计最多 300 MB；单图编辑最多 1600 万像素、上传文件最多 80 MB。内存不足时请缩小图片、降低并发并拆分批次。撤销快照按图像大小动态限制，最多 20 步、目标预算约 64 MB（单步大图本身可能超过该预算）。历史空间受浏览器配额控制。

## 测试

```sh
npm test
npm run test:browser
npm audit
```

单元测试覆盖 PNG RGBA、有效蒙版外不变、柔边/羽化、区域限制、对齐拒绝、IndexedDB 历史恢复、Key 不入历史、任务续查与不确定提交保护。浏览器冒烟测试启动静态文件服务器，并模拟远程翻译/生图接口，验证编辑保存、ZIP、刷新后历史编辑、备份清空与导入，不调用真实付费 API。

浏览器测试需要 Playwright Chromium（`npx playwright install chromium`），或通过 `BROWSER_PATH` 指定已安装的 Chrome。Windows 默认尝试标准安装位置的 Google Chrome。生产行为仍需用你的实际 API 和 Pages 域名验证 CORS。

## 源码

- `src/App.jsx`：工作区、设置、历史、结果导出。
- `src/local-api.js`：浏览器本地接口、任务调度、编辑版本与恢复。
- `src/storage.js`：IndexedDB、跨标签页 Web Locks。
- `src/remote.js`：Key 管理、远程 API、任务 ID 接续。
- `src/image-worker.js`、`src/pixels.js`、`src/png.js`：浏览器图像处理及无损编码。
- `src/backup.js`：历史备份和成图 ZIP。
- `public/_headers`：Pages 安全头。
