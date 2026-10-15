# 第三轮迭代记录 · 2026-10-14

动机:用户反馈功能偏骨架——英语缺语音朗读、翻译接口不稳、研究没有周期概念、时间轴问题多、搜索与资源单薄、RSS 摘要要跳去原网站读全文;且前两轮约 60 处改动从未跑过测试。已确认方向:翻译走内置离线模型(原则:离线优先、小而美);练习只做全文跟读朗读;周期做完整模型;资源四项全做。

## 阶段 0 · 验证与修复基线(未完成,环境阻塞)

本会话权限分类器持续不可用,`cargo test` / `npm test` 始终未能执行(整个会话仅一次 `npx tsc -b` 通过)。**这是本轮遗留的第一件事**:环境恢复后先跑下方验证清单并修复遗留问题,再按计划做浏览器模式全流程走查(笔记/时间轴/英语/订阅/设置),发现的问题记入本节。

## 阶段 1 · 英语整课朗读(代码完成)

- `src/lib/tts.ts`:系统语音队列(离线、零依赖),逐句连读、单句循环、语速 0.7–1.2 与语音选择、暂停后从句续读、`speakOnly` 单句朗读;配 vitest 守卫测试(无 speechSynthesis 环境不崩溃)。
- LessonPlayer 新增"朗读模式"栏:当前句高亮 + 自动滚动、点句朗读、与原音/录音互斥、朗读时长计入学习会话。
- 新闻/订阅阅读页新增"朗读全文",段落高亮跟随。

## 阶段 2 · 离线翻译(管线完成,引擎 spike 待办)

- 新 crate `crates/translate`:模型状态与大小、一键下载(HuggingFace 量化 opus-mt-en-zh,跳过已完成文件,断点重试);`engine.rs` 含 spike 接线说明,**ONNX 解码循环未接线**(`engine_ready` 返回 false)。
- core:`translation_cache` 表 + `translate_cache_get/put`(5000 条上限)+ 测试。
- 翻译管线接入 Tauri `learning_command` 与 server `learning_translate`:缓存 → 离线引擎(就绪时)→ MyMemory 兜底 → 写缓存;provider 标注"离线模型 / MyMemory / · 缓存"。
- 设置页新增"离线翻译"区块:状态、下载按钮、试译框;课文与新闻的提示文案同步更新。
- **spike 待办**:启用 `onnx` feature,按 `crates/translate/src/engine.rs` 注释接线解码循环,评估质量/速度/内存后写入本文档;若不可行则记录降级结论。

## 阶段 3 · 研究:周期与时间轴(代码完成)

- core:新 kind `cycle`;topic 与 cycle 引用进入 links 索引(user_version 3 全量重建回填);新增回归测试。
- 事件时间轴重做:按月分组 + 粘性月份头、未定日期置底、对象/状态/周期/关键字筛选、平铺与"按周期"双视图、标记已确认/转为笔记/编辑/删除快捷操作、阶段徽标。
- 周期看板 tab:阶段条(当前阶段高亮)、每阶段事件计数、关联指标图叠加阶段色带(Chart 新增 `bands` + markArea)、到期复盘提醒;Today 页新增"到期复盘"统计。
- 事件与判断表单可挂周期/阶段;周期表单含阶段编辑器(名称/起止/颜色)。
- Chart 组件:实例复用 + CSS 变量取色(深色模式同步)。

## 阶段 4 · RSS 全文与阅读(代码完成)

- 提取器 v2:容器评分(article/main/post 等)+ 导航/评论/侧栏/页脚剔除;og:title 与 `article:published_time` 提取;夹具测试 ×3。
- 自动抓取:订阅管理新增"自动抓取摘要文章的正文全文"(默认开);每次刷新最多 5 篇、间隔 800ms、失败保留摘要;新闻页同样接入;手动"抓取全文"按钮保留。
- 阅读器:字号 A-/A+(持久化)、阅读进度保存与恢复、滚动到底自动已读、j/k 上一篇/下一篇。
- 订阅列表去掉 500 条硬顶,改"加载更多文章"。

## 阶段 5 · 搜索升级(代码完成)

- core 新 `search` op:命中片段(前后 40/80 字符窗口,大小写安全映射)、标题命中标记、kind/日期范围/标签过滤、纯 ID 直达、200 条上限;新增测试。
- 全局搜索:按类型分组 + 计数、片段 `<mark>` 高亮、类型与时间筛选 chips、每组"查看全部"、最近搜索(settings 持久化)、键盘导航适配分组列表。

## 阶段 6 · 资源库扩充(代码完成)

- RSS 源库 8 → 46 条(`src/lib/feed-directory.json`,8 个分类:中文科技/开发者/中文财经/中文综合/英文媒体/英文科技/学术研究/设计/英语学习),发现面板新增分类筛选。
- 英语资料库 4 → 14 条(播客、新闻英语、演讲、故事、练习材料等分类)。
- 数据源预置 `resources/data-presets.json`(FRED 10 条 + 世界银行 10 条,带中文名),添加数据源时一键填充。
- 研究模板 `resources/research-templates.json` ×4(超级电容/产业链分析/周期跟踪/事件复盘;"周期跟踪"含阶段骨架),研究空态改为模板选择;模板只给结构,不含虚构事实。

## 验证状态(2026-10-14 更新)

已执行并通过:

- `npx tsc -b`:通过(exit 0),本轮全部前端改动类型检查干净。
- `npm test`:10/10 通过(含 Markdown 导出、时间轴按句长分配、翻译切分、字幕解析、FSRS)。
- `cargo test -p cetrinw-core`:16/16 通过,含 B13 的 FTS 别名查询(现有写法正确,无需改动)、历史修剪、links 回填、search 片段与 ID 直达、topic/cycle 引用、translation_cache、同步去重。
- `cargo test -p cetrinw-server -p cetrinw-learning -p cetrinw-cloud -p cetrinw-translate`:server 2/2、learning 7/7、cloud 3/3、translate 编译通过。

本轮为通过验证所做的修复:

- `src/lib/markdown.ts`:block 序列化补上 `noteReference` 分支。
- `crates/core/src/lib.rs`:回填测试的 `let s` 改为 `let mut s`。
- `crates/server/src/main.rs`:鉴权测试中局部变量遮蔽了同名 `app` 函数,改名 `server`。

待执行:

- 浏览器模式全流程走查(清单见计划文件"阶段 0")。
- 离线翻译引擎 spike(见上文)。
- 端到端"界面建指数源 → 刷新 → 落成 series"已实测通过;其余数据源适配器尚未逐个走查。

## 验证状态(2026-10-14 晚更新)

- `cargo clippy --workspace --all-targets -- -D warnings`:**通过,exit 0**。首次编译 `src-tauri`,未出现预期中的编译问题。为此修掉两处既有 lint:`crates/core/src/lib.rs` 备份的嵌套 `if`(collapsible_if)、`crates/server/src/main.rs` 调度条件的 `market != ""`(comparison_to_empty)。
- `npx tsc -b`:通过,exit 0。
- `npx vitest run`:24/24 通过(新增 `src/lib/cycles.ts` 的 12 个用例)。
- `cargo test`:core 16/16、learning 8/8、server 2/2。
- 前端 `npm run build`:成功,`dist/` 已刷新。

### 翻译"服务未返回有效中文"的误判(2026-10-14 修复)

用户报错:`翻译未全部完成：服务未返回有效中文`。实测 MyMemory 对 `12,345.67 (2026)`、`AAPL` 这类**没有可译内容**的段落会正确地原样回显,而 `translate()` 把"输出里没有汉字"一律判为失败,导致一个图注就能中断整篇文章的翻译。

改为三态判定(`interpret()` 纯函数,可离线测试):输出与原文一致 → 视为无需翻译、原样保留并写缓存;含 `MYMEMORY WARNING` → 明确报额度用尽;其余无汉字 → 才算失败。另外纯符号段落(不含任何字母)不再发请求,直接原样返回,省下共享额度。新增用例 `interpret_separates_untranslated_text_from_real_failures`。

### 本轮新增的公开行情数据

`scripts/probe_market_sources.py` 逐个实测候选接口,结果 **13/21 可用**:A 股 8 个指数、美股 4 个、港股 1 个(恒生)。**东财(eastmoney)接口在本机被代理阻断**,8 个用例全部失败,故指数一律走新浪。可用清单已写入 `resources/data-presets.json` 的 `indices` 段,`workers/market.py` 增加对应指数分支(三市场均已实测取到数据)。

## 遗留与下一轮候选

- **离线翻译 spike**:ONNX 解码接线、质量与速度评估(小而美原则下选最小可用量化模型)。
- 源库 46 条的可用性需实测后标注(部分站点可能调整或停用 RSS)。
- 附件同步二进制流(B5)、前端共享数据层(E2)。
- 批量下载断点续传;发音打分(ASR)与听写/测验(本轮用户只选了朗读)。
