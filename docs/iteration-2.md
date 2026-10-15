# 第二轮迭代记录 · 2026-10-14

动机：第一轮功能已可用但偏"骨架"。本轮按 [全量评估报告](audit-2026-10-10.md) 的「建议的下一步」执行深度化改造，覆盖数据完整性、安全纵深、可用性与功能缺口。

## 一、数据核心（Rust）

- **历史修剪（P0）**：`crates/core/src/lib.rs` 新增 `history_limit()`。高频类型（article/feed/session/job 保留最近 20 版；lesson/word/review/annotation/watch/source/series 保留 60 版）在每次 `write()` 后自动修剪；笔记与研究记录保留完整版本历史。修复 RSS/新闻每次刷新导致 `history` 无界膨胀的问题。
- **反向链接派生表（B3）**：新增 `links(from_id, to_id, rel)` 表与索引，`write()` 时从记录内容提取 `noteReference`、annotation→note/asset、article→note 引用；旧资料库在打开时一次性回填（`user_version 1 → 2`）。编辑器反向链接与 PDF 批注改为精确索引查询，替换原先对 UUID 做全文检索的不可靠实现。
- **同步幂等**：`sync_apply` 对内容完全相同的远端记录只更新 `remote_versions`，不再产生本地 revision 与历史行；配合新增的 `sync_reset` 操作（清除 outbox/receipts/remote_versions/sync_cursor），更换服务器重新配对不再污染本地历史。
- **空标题回退**：标题 trim 后为空时存为「未命名」（B10）。
- **stats 扩充**：`stats` 现在返回 `history` 行数、`databaseBytes`、附件数量与字节数。
- 新增回归测试：历史修剪边界、links 写入/删除/回填、空标题与 stats、同步去重与 reset。

## 二、安全纵深

- **A1 已修复**：`write_export` 改为 Rust 侧弹出系统保存框（`tauri_plugin_dialog` 阻塞 API），WebView 只提供建议文件名与字节，不再传递任意路径。
- **A3 已修复**：服务器 RSS 适配器的事件标题经 `plain_text()` 清洗，不再把原始 HTML 标签作为可见文本入库。
- **A5 已修复**：浏览器模式同步在无令牌时不再发送空的 `Authorization` 头。
- **B9 已修复**：MP3 嗅探收紧为 `ID3` 或 `0xFF 0xE0` 帧同步。
- **D10**：Mac 自动备份失败写入 `settings.backup_error` 并在设置页展示；成功后清除。

## 三、功能深度

- **阅读模式（D7）**：新增 `article_extract`（Rust `crates/learning` + Tauri + 服务器三处接入），摘要型文章可一键抓取正文全文（语义容器优先的段落提取，带长度质量门槛）。新闻与订阅页共用入口。
- **英语时间轴一键分配（D6）**：`distributeTimeline()` 按句长比例把音频总时长分配给各句，TXT 课程校准前可一键初始化再微调。
- **英语批量下载（D6）**：公开资料页新增「下载本来源全部课程」，顺序下载、显示进度、可暂停、失败汇总。
- **英语可用性（C10/B12）**：课程重命名、跟读录音受控选择并自动选中最新、删除单条录音、整句朗读（TTS）。
- **冲突副本采纳（D2）**：冲突副本编辑器内提供「以此版本覆盖原笔记」，覆盖后副本移入回收站并跳转到原笔记。
- **笔记排序与标签筛选（C9）**：笔记列表新增按标签筛选与排序（最近更新/最早更新/按标题）。
- **全库 Markdown 导出（D4）**：设置页新增「导出全部笔记（Markdown）」，按文件夹结构打包 ZIP；富文本经 `src/lib/markdown.ts` 的轻量序列化器转换（有已存 Markdown 时优先），附带单元测试。
- **清除同步状态（D8）**：设置页新增按钮与确认框，说明用于更换服务器前重新配对。
- **刷新并发守卫（B7）**：新闻页按来源去重并发刷新；订阅/新闻的抓取全文按钮同样受 busy 保护。

## 四、可用性与无障碍

- **深色模式（C4）**：跟随系统 `prefers-color-scheme`，styles.css 末尾新增完整覆盖块（变量重映射 + 逐组件覆盖）；`index.html` 的 theme-color 按明暗提供两套；图表颜色改为读取 CSS 变量（E4 同时完成：ECharts 实例复用 + `setOption` 增量更新）。
- **原生对话框替换（C6）**：新增 `ConfirmModal` / `PromptModal`，替换全部 `window.confirm` / `window.prompt`（编辑器链接与公式、删除笔记、删除课程/单词/录音、删除数据源、研究记录删除、数据表命名与字段表单）。
- **快捷键帮助（C12）**：`?` 或侧栏按钮打开快捷键说明。
- **未保存提醒（C8）**：浏览器模式下 `beforeunload` 基于各编辑器注册的脏检查拦截关闭。
- **服务器地址校验（C13）**：保存前校验 URL 格式与协议（公网必须 HTTPS）。
- **B8 已修复**：超长单词按 UTF-8 边界切分后再翻译，不再因 >500 字节被后端拒绝。

## 五、测试补充

- `crates/learning`：对话/ELLLO 解析夹具测试、正文提取启发式测试。
- `crates/server`：令牌鉴权矩阵、非 HTTPS 与私网地址拒绝。
- `crates/cloud`：备份文件名白名单、WebDAV 地址校验、尾斜杠归一化。
- 前端 vitest：`distributeTimeline` 比例分配、`splitForTranslation` 字节上限、`noteToMarkdown` 序列化。

## 六、验证状态

本会话执行通道（权限分类器）长时间不可用，仅在改动开始时跑过 `npx tsc -b`（通过，exit 0）。**本轮全部改动尚未复跑下列命令，请按顺序执行：**

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npx tsc -b
npm test
cargo test -p cetrinw-core -p cetrinw-server -p cetrinw-learning -p cetrinw-cloud
cargo clippy --workspace --all-targets -- -D warnings
# 重点回归：B13（FTS 别名查询）由 core 的 persistence_chinese_search_history_and_conflicts 覆盖；
# 历史修剪、links 回填、同步去重、解析夹具为本轮新增用例。
# 界面走查：任一对话框 Esc/焦点、深色模式下阅读与编辑、TXT 课程一键分配时间、抓取全文、回收站与冲突采纳。
```

## 七、仍未完成（建议下一轮）

- B5 附件同步仍为 base64 整体传输（大附件内存峰值）。
- E2 前端数据层仍按 kind 多实例 `useEntries`，未引入共享 store。
- D5 研究：对象详情页与关系图仍未实现。
- 批量下载为顺序执行，未做断点续传与并行。
