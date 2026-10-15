# 个人服务器

服务器负责金融/RSS/宏观采集、增量同步和备份。Mac 离线笔记、已下载课程、本地词典、VOA 课程直接下载均不依赖服务器。

Mac 的全局 RSS、每日新闻、VOA/ELLLO 公开课程也可直接联网获取。全局 RSS 的自动检查仅在应用打开时运行；个人服务器的研究数据源调度与之独立。

## 坚果云 / WebDAV

在 Mac 设置页配置 WebDAV 根地址、账号和**第三方应用密码**，坚果云常用根地址为 `https://dav.jianguoyun.com/dav/`。请在坚果云的“账户信息 → 安全选项 → 第三方应用管理”生成应用密码，参见[官方说明](https://help.jianguoyun.com/?p=2064)。密码仅保存在 Mac 钥匙串中，不填入笔记或项目配置文件。

先保存配置，再测试已保存连接；成功后执行第一次备份。“测试连接”只验证认证和读取目录，“备份已上传”才表示 PUT 成功。备份存放在根目录下 `Cetrinw/`，每次文件名包含时间戳与随机标识，带 `If-None-Match: *` 防止覆盖。

点击“云端备份列表 → 查看并恢复”可先看到创建时间、记录/附件数量和部分标题，再确认合并恢复。相同内容跳过，冲突另存副本。备份包含原始资料，没有额外端到端加密；不自动删除云端历史。当前每个完整备份最多 250 MB。

可启用每天自动备份：应用打开时检查，当天成功一次后不重复上传，失败至少一小时后重试。坚果云免费用户存在容量、流量、请求频率与单次文件列表上限，使用过程中以官方账户显示为准。

WebDAV 保存完整快照，用于备份、迁移和恢复；Cetrinw 服务器处理逐记录冲突与增量同步。Notion 与 Google Drive 的专用 API 连接尚未接入。若这些云盘的官方桌面客户端提供本地同步目录，可以将完整导出保存到该目录。

## 本机启动

```sh
export PATH="$HOME/.cargo/bin:$PATH"
python3 -m venv .venv
.venv/bin/pip install -r workers/requirements.txt
npm ci
npm run build
cargo build --release -p cetrinw-server
export CETRINW_PYTHON="$PWD/.venv/bin/python"
export CETRINW_BIND="127.0.0.1:4318"
export CETRINW_DATA_DIR="$PWD/.data/server"
./target/release/cetrinw-server
```

App 的“设置与数据”填写 `http://127.0.0.1:4318`。本机回环服务默认无需令牌；远程服务必须设置至少 32 字符的随机 `CETRINW_TOKEN`，在反向代理终止 HTTPS，并在 App 配置相同令牌。不要把没有认证的回环服务直接公开转发。

配置示例见根目录 `.env.example`。程序读取进程环境变量，不自动载入 `.env`。密钥不需要填在笔记或数据源配置 JSON 内。

## 采集与限制

- 在 App 设置页创建数据源，再手动“刷新”验证权限与连通性。打开自动更新后服务器每分钟检查是否到时。
- 股票按配置市场的时区工作日 18:00 后检查；其余源按北京时间 08:00。**尚无完整交易所节假日日历**，节假日可能发起无新增数据的请求。
- 默认 A 股为 AKShare 新浪适配器，也可以明确选择东方财富；不会在失败时悄悄切换。当前免费源稳定性没有保证，错误会保留在任务和来源状态中。
- 行情初次取约三年数据。当前再次刷新仍取窗口范围、比较内容并保存变更，不是高效的逐日 API 拉取。
- Tushare 用 `TUSHARE_TOKEN`；FRED 用 `FRED_API_KEY`；SEC 用包含真实联系邮箱的 `CETRINW_USER_AGENT`。未配置的源会报明确错误。
- HTTP JSON 适配器期望 `points`，每项包含 `date` 与 `value`，或日线 OHLCV。单位、币种与来源由适配器或用户填写，需人工核对。
- 下载和通用数据源仅接受公开 HTTPS；不跟随未核验的重定向。该限制可能拒绝某些跳转下载链接。

## 备份、升级和恢复

服务每小时触发备份检查，同一天保留一份成功快照，总共保留最近 30 份。快照使用 SQLite backup 与不可变附件硬链接/复制，不复制运行中的 WAL 文件。

升级前停止服务，另存整个数据目录（或确认有近期完整导出），保存旧二进制，再启动新版本。回退时停止新服务，恢复旧程序和对应数据目录。不要将两套进程同时指向同一数据目录。

浏览器页面用于可信本机开发。远程浏览器界面没有实现令牌登录，远程日常使用请通过 Mac 客户端。服务器由个人信任和管理；目前不是多租户服务，没有端到端加密和细粒度授权。

## HTTP API

`POST /v1/command`，JSON 请求；有令牌的服务使用 `Authorization: Bearer <token>`。失败返回非 2xx 状态与 `error`，不要将其视为更新成功。

| op | 关键参数 | 作用 |
| --- | --- | --- |
| list / get | kind、query、limit、offset / id | 分页查询与全文搜索 / 读取记录 |
| trash / restore | kind（可选）/ id | 列出已删除记录（最近 200 条）/ 恢复并重建全文索引 |
| save | record：id、kind、title、data、revision | 乐观版本写入；冲突生成副本 |
| delete / history | id | 删除标记 / 读取最近版本 |
| asset_put / asset_get | name、mime、base64 / hash | 内容哈希附件 |
| refresh | 数据源 id | 启动采集，返回 jobId，再用 get 查询状态 |
| outbox / changes | 无 / cursor | 本地待发送操作 / 服务器变更流 |
| sync_push / sync_ack / sync_apply | 见 `src/lib/db.ts` | 增量同步协议 |
| export / import / backup | 无 / bundle / 无 | 完整导出、导入、磁盘快照 |
| dictionary | word | 本地英汉词典，未命中时请求在线词典 |
| learning_catalog / learning_download | 无 / id | 公开课程目录 / 下载指定课程 |

`GET /health` 是进程健康探针，并不证明金融接口或同步成功。`GET /v1/assets/{hash}` 获取附件，也需要令牌。

## 部署状态

本轮仅启动本机开发和独立测试实例，未部署到公网服务器，未更改现有生产服务。远程 HTTPS、反向代理、跨设备网络恢复和云端备份需要在选定服务器后单独验证。
