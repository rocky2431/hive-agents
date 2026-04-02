# CLOUD_TOOL_STABILITY_AUDIT_2026-04-02

## 结论

如果基线明确为：

- 云端部署
- 纯 Docker 容器
- agent 在容器内运行
- 工作目录是持久卷 `/data/agents`
- 没有桌面级整机权限

那么当前工具体系的正确判断是：

- **真正稳定、应该作为主力默认原语的，是本地确定性工具。**
- **搜索与网页能力应建立在 Exa / Tavily / DuckDuckGo + web_fetch / Firecrawl / XCrawl 之上。**
- **Claude Code 给我们的核心启发不是某个 vendor，而是“优先靠本地原语和直接 URL 读取完成工作”。**

我的置信度：**94%**

## 1. 云端容器里真正稳定的主力工具

### A. 文件与代码工作流主力

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `glob_search`
- `grep_search`
- `read_document`
- `execute_code`
- `run_command`

### 为什么它们稳定

- 主要依赖本地 workspace
- 云端容器镜像里已经有：
  - `python3`
  - `node`
  - `git`
  - `bash`
  - `curl`
  - `npm`
- 不依赖第三方 quota / billing / auth

## 2. 云端里的网页能力分层

### A. `web_search`

- 用于关键词检索
- 默认优先 `Exa`
- 次选 `Tavily`
- 免费兜底 `DuckDuckGo`

### B. `web_fetch`

- 已知 URL 的默认读取路径
- 轻量、直接、低依赖

### C. `firecrawl_fetch`

- 复杂页面、PDF、正文提取不完整时升级使用

### D. `xcrawl_scrape`

- JS-heavy、反爬重、动态页面的最终升级路径

## 3. 哪些能力不该作为主链路

### A. MCP / 资源发现

- `discover_resources`
- `import_mcp_server`
- `list_mcp_resources`
- `read_mcp_resource`

它们是平台扩展能力，不是普通任务执行主链路。

### B. 外部渠道能力

- `send_feishu_message`
- `feishu_*`
- `send_email`
- `read_emails`
- `reply_email`

这些都依赖渠道配置和凭证，不应被视作通用默认主力工具。

## 4. Claude Code 给我们的真实启发

Claude Code 最值得借鉴的是：

1. 默认靠本地原语工作
2. 已知 URL 时优先直接 fetch
3. 把外部 provider 能力降级成补充，而不是主链路

## 5. 当前推荐链路

### 搜索与网页

1. 有关键词：`web_search`
2. 已知 URL：`web_fetch`
3. 页面复杂：`firecrawl_fetch`
4. JS-heavy / 反爬：`xcrawl_scrape`

### 代码与工程

1. 搜索文件：`glob_search` / `grep_search`
2. 读取与修改：`read_file` / `edit_file` / `write_file`
3. 执行验证：`run_command`

## 6. 最终判断

对于云端 Docker agent，这套工具体系现在的合理方向是：

- **本地原语优先**
- **Exa 搜索优先**
- **web_fetch 作为已知 URL 主路径**
- **Firecrawl / XCrawl 作为递进式增强**

这比历史上的 provider-heavy 路径更稳，也更符合真实任务落地。
