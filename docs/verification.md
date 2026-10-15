# Mac 预览版验证记录

验证日期：2026-10-10。范围为 Mac 预览版及本机隔离服务器；不包含 iPhone、iPad，也未构建 Windows/Android。

## 已验证：真实外部主路径（L4）

`scripts/integration_check.py --live`：通过真实 HTTP → Rust 采集任务 → SQLite 写入路径，无模拟价格或静默备用源。

| 来源 | 实际结果 |
| --- | --- |
| World Bank 中国 GDP | 26 条年度观测，最新统计期 2025 |
| AAPL / AKShare 新浪 | 754 条未复权日线，最新 2026-10-09 |
| 600519 / AKShare 新浪 | 728 条未复权日线，最新 2026-10-09 |

最初东方财富请求失败，保留此限制；界面支持明确选择来源，默认现在是新浪。验证没有覆盖分红、拆股、复权正确性和完整交易日历。

`scripts/learning_check.py` 和独立 API 检查：

- VOA 第 1、26、52 课，ELLLO A1 第 1、25 课：实际下载 MP3 和原文，保存附件并校验字节数。77 课目录齐全，但未逐个下载全部课程。
- MyMemory 英中翻译：真实请求返回“你能解释一下供应链吗？”，错误与额度用尽会明确显示。
- NASA 10 篇来源文章、Guardian 30 篇新闻摘要，分别取得 2026-10-09 / 2026-10-10 的实际发布日期。
- 少数派 10 篇、爱范儿 20 篇、V2EX 50 篇、Hacker News 20 篇；重复入库保留已读状态。
- NASA 首页成功发现 `https://www.nasa.gov/feed/`；直接 RSS 地址也能识别。爱范儿首页没有声明 RSS，发现操作返回明确失败，使用其 `https://www.ifanr.com/feed` 可正常订阅。

## 已覆盖：现实夹具（L2）

- Rust 核心 6 项：持久化重开、中文全文搜索、版本历史、离线冲突及重试幂等、富文本/附件备份恢复、损坏附件拒绝、删除后过期编辑保留副本、同步回执不使当前编辑器版本失效。新增 RSS 重复刷新保留已读、收藏、专题及笔记链接；来源正文变更时撤下旧译文，保留个人笔记；删除的文章不因刷新复活。
- TypeScript 4 项：SRT/LRC/TXT 解析、异常时间范围、FSRS 状态保存与继续复习。
- WebDAV：`scripts/webdav_fixture.py` 与 `cargo run -p cetrinw-cloud --example verify_webdav`，真实文件目录上的 PROPFIND/MKCOL/PUT/GET，上传、列出、下载，再导入另一份 SQLite；包含富文本笔记、中英课文、390,146 字节的真实原创音频和学习进度，校验恢复字节完全一致；错误密码被拒绝。
- 10,000 篇有非空正文的产业研究夹具，经实际 Store / SQLite FTS5 / Jieba 查询，100 次查询返回非空匹配。Debug 构建：P50 29.02 ms，P95 102.26 ms，最大 131.69 ms。**只测 Rust 查询，不包含界面、IPC、启动或总内存**。

原始结果位于 `output/verification/`：`integration.json`、`learning-rss-live.json`、`webdav.json`、`search-10000.json`。初次网站发现失败留在原始记录中，上述 NASA 后续检查独立完成。

## 界面与安装包

使用独立资料库与浏览器上下文，避免改动用户正在试用的笔记。RSS 订阅少数派后，实际文章可以转为带来源的笔记，并继续编辑保存。Mac 应用使用系统 WebView，不含 Electron；已构建 Apple Silicon `.app` 与 `.dmg`。

- L2：三页明确标注的研究 PDF 夹具通过界面上传、分页渲染、鼠标选择原文、划线并引用到笔记。重新打开笔记后，中文分析仍在；界面导出的 ZIP 包含 Markdown 页码引文和字节完全一致的 PDF 附件（按 SHA-256 命名）。证据：`output/verification/pdf-ui-export.json`、`output/playwright/pdf-selection.png`。
- L3/L4：在独立浏览器界面点击 VOA 第 1 课“下载并学习”，取得官网真实音频及 9 句原文，9 句中文对照显示；实际音频播放推进超过 3 秒后暂停。证据：`output/playwright/english-bilingual.png`。这不代表 macOS 原生音频中断行为已验证。
- L3：通过界面将第 9 句的 apartment 加入生词本，保存正确原句“Anna: My new apartment! Yes!”；展示释义并选择“记得”后完成一次复习。第一课内置中文通过“生成 / 补全中文”写入资料库；实际保存 5 秒播放学习记录。证据：`output/verification/english-ui.json`。
- L3：已订阅少数派经界面导出 OPML，再从实际下载的文件导入，SQLite 中仍只有一条对应订阅，无重复。证据：`output/verification/opml-ui.json`。
- 开发验证时曾因构建替换资源造成旧页面懒加载 JS 404；重新加载后 PDF 正常。隔离服务重启时的请求失败也保留在原始浏览器日志，未将其记为接口通过。

最终包位于 `output/releases/`。完整 `.app` 通过 `codesign --verify --deep --strict`，DMG 通过 `hdiutil verify`；SHA-256 与大小记录于 `release-info.json`。首次构建只有链接器签名，完整 bundle 验证失败；已显式配置 ad-hoc 签名并重新构建、复验，未交付失败包。

Mac 原生 App 实际启动，`tauri://localhost` 显示原有资料库；通过原生课程目录下载 VOA 第 1 课，SQLite 中确认 9 句原文及 236,944 字节音频。保留原有笔记。构建通过只支持 L1 结构/编译结论，原生启动与单课下载也不等于全部功能已验收。包为本机 ad-hoc 签名，未做 Developer ID 公证。

## 未验证 / 尚未完成

- 坚果云实际账号未配置：**WebDAV 只有 L2 协议覆盖，不能宣称坚果云上传已验证**。
- Notion API、Google Drive OAuth、跨公网设备自动同步和应用商店分发尚未接入或验证。
- BBC 当前网络访问超时；VOA 新闻订阅数据较旧，保留日期并提示来源更新不足。
- British Council 与 LibriVox 提供官网入口；本环境访问受限，没有证明其下载可用。
- 真实完整行业报告的“引用—关系—事件—假设—后续验证”全链路未完成；研究示例模板不包含编造的行业结论。
- macOS 中文输入法组合输入、麦克风录音、系统媒体控制与中断、异常退出恢复、完整 Markdown 兼容矩阵和长时间稳定性仍需专项验证。
- 性能表中的冷启动、编辑输入 P95、含 WebView 的总内存和移动平台指标未验证，不能把主进程内存当成总内存。

项目全局保护规则检查已执行。所有外部失败均与成功数据区分记录。
