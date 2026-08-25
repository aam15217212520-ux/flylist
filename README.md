# FlyList ⚡

网盘分享链接聚合解析下载站，极客暗色风格 UI，基于 Cloudflare Pages + Pages Functions 部署。

## 功能

- 输入网盘分享链接 + 提取码，自动识别网盘类型并解析出直链
- 支持：蓝奏云、城通网盘、小飞机网盘、123云盘、百度网盘（SVIP 加速）
- 百度网盘由管理员在后台配置一个 SVIP 账号的登录态，访客免登录即可获得高速直链
- 后台管理：账号配置、各网盘解析开关、解析次数统计
- Cloudflare KV 缓存直链，降低同一链接被反复请求触发网盘风控的概率

## 技术栈

- 前端：Vite + React + TypeScript + Tailwind CSS
- 后端：Cloudflare Pages Functions（TypeScript，Workers 运行时）
- 存储：Cloudflare KV

## 目录结构

```
functions/api/
  parse.ts              解析主入口
  stats.ts              统计查询
  admin/                后台鉴权与配置接口
  parsers/               各网盘解析器 + 公共工具
src/
  pages/                 Home（前台）/ Admin（后台）
  components/             解析框、结果卡片、协议弹窗
  lib/api.ts               前端请求封装
```

## 本地开发

```bash
npm install

# 创建 KV 命名空间（首次）
npx wrangler kv namespace create FLYLIST_KV
# 将输出的 id 填入 wrangler.toml 的 kv_namespaces.id

# 终端 1：启动 Pages Functions（含 KV 绑定）
npx wrangler pages dev dist --kv FLYLIST_KV --compatibility-date=2024-09-23 --compatibility-flag=nodejs_compat

# 终端 2：启动前端（会把 /api 代理到上面的 8788 端口）
npm run dev
```

也可以先 `npm run build` 再用 `npm run pages:dev` 一步跑起完整效果（前端已构建为静态文件）。

## 部署到 Cloudflare Pages

1. `npx wrangler login`
2. `npx wrangler kv namespace create FLYLIST_KV`，把返回的 `id` 填进 `wrangler.toml`
3. `npx wrangler pages project create flylist`
4. `npm run build`
5. `npx wrangler pages deploy dist`

或者直接在 Cloudflare Dashboard 里连接 Git 仓库自动部署，构建命令 `npm run build`，输出目录 `dist`，并在 Pages 项目设置里绑定同一个 KV 命名空间（Settings → Functions → KV namespace bindings，binding 名填 `FLYLIST_KV`）。

首次访问 `/admin` 后台时，输入的第一个密码会被自动设为管理密码，请第一时间登录设置好，避免被他人抢先设置。

## 各网盘解析器可信度说明

网盘分享接口都是第三方私有接口，会不定期调整，以下是当前实现的置信度，方便后续针对性排查：

| 网盘 | 置信度 | 说明 |
|---|---|---|
| 蓝奏云 | 中 | 核心流程（提取页面内联 sign → 调用 `ajaxm.php`）是长期稳定的思路，但混淆变量名可能变化，解析失败先检查 `functions/api/parsers/lanzou.ts` 里的 `SIGN_PATTERNS` |
| 城通网盘 | 中 | uid/fid 提取正则可能需要对照最新分享页源码调整 |
| 小飞机网盘 | 较低 | 服务较新，接口路径基于合理推测实现，上线后需要用真实分享链接验证，如有出入需要重新抓包 `functions/api/parsers/feiji.ts` |
| 123云盘 | 中高 | 公开分享接口结构相对稳定，但仅覆盖普通文件，大文件/登录态场景未实现 |
| 百度网盘 | 中高 | 采用官方微信端接口 `share/wxlist`（列表）+ `share/tplconfig`（签名）+ `api/sharedownload`（下载，需附带 `sekey`）三步获取直链，不依赖分享页 HTML 结构，支持文件夹分享，思路参考自 94list / HkList / baiduwp-php 等开源实现 |
| UC 网盘 | 中 | 与夸克同源（`QuarkOrUC`），用 Cookie + `pc-api.uc.cn` + `pr=UCBrowser`，下载走 `/api/uc-download` 代理。端点从 alist 驱动对照写出，尚未用真实 Cookie 验证 |
| 迅雷网盘 | 较低 | 需 refresh_token；分享走 restore 转存再取 `web_content_link`，下载走 `/api/xunlei-download`。captcha 目前用参考实现的硬编码签名，真实环境可能失效 |

**建议**：部署后先用几个真实分享链接逐个网盘测试，任何一个解析失败都可以把报错信息发我，我们针对性修正对应 parser 文件即可，不影响其他网盘。

## 客户端接入（API 说明）

本站提供统一的解析 API，供官方客户端（Windows / macOS / Android / iOS）接入。
**客户端只需要请求本站域名，由本站负责识别网盘类型、调用对应网盘接口、管理账号池与风控，客户端无需对接任何网盘 API。**

### 解析接口

```
GET https://flylist.pages.dev/api/parse?url=<分享链接>&pwd=<提取码，可选>
```

- 返回 JSON：单文件时含 `panType`（网盘类型）、`fileName`、`fileSize`、`directLink`（下载地址）；
  文件夹分享时含 `files` 数组，客户端展示列表后用子项的 `url` 再次调用本接口下钻。
- `directLink` 分两类：
  - 直连型网盘（蓝奏云、123云盘等）：直接是网盘 CDN 地址，客户端直接下载即可；
  - 代理型网盘（百度、夸克、UC、迅雷、阿里、天翼、Google Drive）：是本站代理地址
    （`/api/xxx-download?...`），客户端直接 GET 该地址即可下载，服务端会现场签发直链并流式转发，
    客户端无需处理 UA / Cookie / 签名等细节。
- 百度网盘代理地址的路径末段带真实文件名（`/api/baidu-download/文件名.mov?...`），
  客户端可直接用作下载文件名。

### 注意事项

- 请合理控制请求频率（建议客户端对同一链接的解析结果本地缓存 ≥ 10 分钟），高频请求会触发网盘风控导致服务不可用；
- 下载代理支持 HTTP Range 分段请求，客户端可实现断点续传；
- 接口可能随网盘上游调整而变化，客户端应做好对非 200 响应与错误文案的展示。

## 转存文件自动清理

百度网盘解析采用「转存到账号网盘再签直链」模式，转存文件会占用网盘空间，空间满后新转存会失败。
本站提供懒触发式清理接口：

```
GET https://flylist.pages.dev/api/cleanup
```

- 逻辑：遍历账号池各账号的 `/parse_file` 目录，删除「超过 24 小时无人下载」的转存文件，并同步清理 KV 中的转存缓存；
- 触发方式：Cloudflare Pages 不支持定时任务，需在免费定时服务（如 [cron-job.org](https://cron-job.org)、UptimeRobot）
  中添加一条定时 GET 请求指向上述地址（建议每 6～12 小时一次）；接口内置并发锁，重复触发不会重复清理；
- 下载代理每次成功取流会刷新对应文件的「最后下载时间」，因此正在被使用的文件不会被误删。

## 免责声明

本项目仅供个人学习、技术研究使用。百度网盘解析功能依赖管理员自愿配置的账号权益，请遵守《FlyList 访客协议》（首页解析按钮旁可查看），滥用导致的账号风险由使用者自行承担。
