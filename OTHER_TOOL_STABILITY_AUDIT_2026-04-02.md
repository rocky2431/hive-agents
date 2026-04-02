# 其他工具稳定性审计（云端 Agent 基线）

日期：2026-04-02  
范围：**不含**已单独审计和重构过的 `web_search/web_fetch/firecrawl_fetch/xcrawl_scrape` 与 `Feishu` 办公链  
基线：云端纯 Docker Agent，默认工具面 + 当前后端实现  
结论置信度：**92%**

---

## 1. 总结

当前其他工具的状态，不是“很多已经坏掉”，而是：

- **主链能跑**：文件、命令执行、技能加载、A2A/runtime task、邮件、HR 建人这些核心路径已经具备上线可用性。
- **稳定性不均匀**：搜索/飞书/邮件这几条线已经升级成“结构化错误 + fallback + 遥测”，但其它不少工具仍然停留在“直接返回字符串”阶段。
- **最大真实短板不是功能缺失，而是失败语义不统一**：文件、触发器、消息、Plaza、部分 MCP/HR 路径仍然缺结构化错误 envelope，导致 telemetry、自动恢复、前端诊断都偏弱。

一句话判断：

> 当前其他工具整体是 **业务可用**，但离“高稳定 agent runtime 工具层”还差一轮统一收口。

---

## 2. 我实际验证过的内容

### 2.1 工具注册 / 工具面 / pack

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/services/test_agent_tools.py tests/tools/test_bridge_equivalence.py tests/tools/test_service.py tests/services/test_tool_registry.py tests/services/test_pack_service.py -q
```

结论：

- 当前 canonical tool surface 正常
- governance / pack / registry 没有明显回退

### 2.2 邮件 / 命令执行 / A2A / HR / telemetry

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/services/test_email_runtime.py tests/services/test_command_tooling.py tests/services/test_agent_message_runtime.py tests/agents/test_orchestrator.py tests/tools/test_hr_handler.py tests/services/test_tool_telemetry.py -q
```

结果：`32 passed`

### 2.3 安全回归

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/api/test_security_regressions.py -q
```

结果：`12 passed`

### 2.4 技能加载 / pack / skill registry

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/services/test_skill_loading.py tests/services/test_skill_registry.py tests/skills/test_registry.py tests/services/test_pack_service.py -q
```

结果：`23 passed`

### 2.5 MCP registry / pack 策略

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/services/test_mcp_registry_service.py tests/services/test_pack_service.py -q
```

结果：`13 passed`

---

## 3. 分类别判断

## 3.1 文件与工作区工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/workspace.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/filesystem.py`

包含：

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `glob_search`
- `grep_search`
- `delete_file`
- `read_document`
- `load_skill`
- `tool_search`

当前判断：**可用，但还不够“稳定化”**

优点：

- 路径边界检查基本到位
- `enterprise_info` 做了单独访问处理
- `read_document` 支持常见办公格式
- `load_skill/tool_search` 与当前技能体系兼容

问题：

1. **失败语义仍是纯字符串**
   - `Access denied`
   - `File not found`
   - `Edit failed`
   - `Document read failed`
   都没有 `<tool_error>` payload。
   这意味着 runtime 无法像搜索/飞书/邮件那样统一提取 `error_class / retryable / provider`。

2. **`read_document` 仍是“大杂烩 reader”**
   - 可用，但没有按文件类型输出结构化摘要
   - 一旦依赖缺失，也是普通字符串，不利于自动恢复

3. **`delete_file/write_file/edit_file` 的失败没有进入统一遥测语义**
   - 现在 activity logger 只能看到一段结果文本
   - 不能可靠分桶“权限错误 / 文件不存在 / 参数错误”

结论：

- **能用**
- **适合继续做主链**
- 但应该进入下一轮统一 envelope 改造

---

## 3.2 本地执行工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/code_exec.py`

包含：

- `execute_code`
- `run_command`

当前判断：**稳定，且适合云端主链**

优点：

- workspace 内执行边界清楚
- `run_command` 已经替代了大量“必须走外部 provider”的工作流
- `execute_code` / `run_command` 都有超时限制
- 高风险命令已明确拦截

边界：

- 不是 Claude Code 那种整机 Bash
- 故意禁止：
  - `docker`
  - `kubectl`
  - `apt`
  - `curl`
  - `wget`
  - `ssh`
- 这不是 bug，是云端安全策略

问题：

1. **失败仍是纯字符串**
   - `❌ Command timed out...`
   - `❌ Execution error...`
   没有结构化 envelope

2. **安全检查是 substring 级别**
   - 够用，但不是高精度 policy engine

结论：

- 这是现在最稳的核心工具之一
- 不需要重构方向
- 只需要补统一错误 envelope 和更细策略

---

## 3.3 通信 / A2A / 异步任务

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/messaging.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/communication.py`

包含：

- `send_message_to_agent`
- `delegate_to_agent`
- `check_async_task`
- `cancel_async_task`
- `list_async_tasks`
- `get_current_time`
- `send_channel_file`
- `upload_image`
- `send_web_message`

当前判断：**主链稳定**

优点：

- async task owner 隔离已做
- cancel / list / check 已经打通
- A2A runtime 本身测试覆盖较好
- 对 agent 协作来说已达到可上线标准

问题：

1. **大量失败仍是普通字符串**
   - target agent not found
   - no LLM configured
   - send failed
   - message send error

2. **`send_feishu_message` / `send_web_message` 风格仍然偏旧**
   - 虽然功能能用
   - 但失败分类没有统一成 envelope

结论：

- runtime 协作链本身稳定
- 但通信工具的失败语义仍然落后于新工具体系

---

## 3.4 触发器工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/triggers.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/triggers.py`

包含：

- `set_trigger`
- `update_trigger`
- `cancel_trigger`
- `list_triggers`

当前判断：**可用，但存在真实收口缺口**

优点：

- create 路径对 `cron/once/interval/poll/on_message/webhook` 有基础校验
- trigger limit / duplicate name / webhook token 都处理了

真实问题：

1. **`update_trigger` 没有重新做 type-specific 校验**
   - 现在更新时只改 `config`/`reason`
   - 不会重新校验 `cron expr`、`interval minutes`、`once at`
   - 这意味着可以把一个原本好的 trigger 改成坏配置并成功写库

2. **失败仍是普通字符串**
   - 不能进入结构化 telemetry

3. **`poll` 只检查有无 `url`，不校验 URL 合法性**

结论：

- 这条线不是崩的
- 但这里有一个**真实 bug 风险点**：`update_trigger` 缺再校验

---

## 3.5 邮件工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/email_service.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/email.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/email.py`

包含：

- `send_email`
- `read_emails`
- `reply_email`

当前判断：**比以前稳很多，但还没完全一致化**

优点：

- 已经有 preflight
- 已经有 provider/auth/network 分类
- 对 trigger 场景比之前可靠很多

剩余问题：

1. **domain wrapper 仍保留 catch-all 原始字符串**
   - `_handle_email_tool(...)` 最外层 `except` 还是：
     - `❌ Email tool error: ...`
   - 这会绕过 envelope

结论：

- 邮件主链可用
- 但还有一处收口尾巴

---

## 3.6 HR 工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`

包含：

- `create_digital_employee`

当前判断：**稳定，可用**

优点：

- 参数兜底比之前强
- 数组/布尔/trigger JSON 都做了解析兜底
- tenant default model 路径比较明确

问题：

1. **结果仍是成功 JSON / 普通错误字符串混合**
   - 前端现在已做 normalize
   - 但后端协议本身还不够一致

结论：

- 业务上可用
- 不属于当前最高优先级问题

---

## 3.7 Plaza 工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/plaza.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/plaza.py`

包含：

- `plaza_get_new_posts`
- `plaza_create_post`
- `plaza_add_comment`

当前判断：**低优先级可用，但工程化较弱**

优点：

- tenant 范围控制基本正确
- 基础 CRUD 可用

问题：

- 完全是旧式字符串结果
- 没有结构化失败
- 没有更强的 observability

结论：

- 不是当前主痛点
- 不建议优先改

---

## 3.8 MCP 扩展工具

相关实现：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/mcp.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/web_mcp.py`

包含：

- `list_mcp_resources`
- `read_mcp_resource`
- `import_mcp_server`
- `discover_resources`

当前判断：**作为平台扩展能力可用，但不应该作为主执行路径**

优点：

- pack 暴露策略已经收紧
- 明确只有平台扩展场景才该走这条链

问题：

- `list/read` 仍是普通字符串失败
- 运行稳定性仍受外部 registry / provider 影响

结论：

- 平台层通用能力没问题
- 但它不应该成为常规任务主链

---

## 4. 当前最真实的差距

如果只看“除了搜索和飞书之外，其它工具稳不稳”，我会把问题收敛成这 4 条：

1. **结构化错误覆盖率不够**
   - 文件
   - 触发器
   - 通信
   - Plaza
   - 部分 MCP
   仍是纯字符串。

2. **trigger update 存在真实再校验缺口**
   - 这是功能正确性问题，不只是工程风格问题。

3. **邮件还剩一处 wrapper 级尾巴**
   - 已经不是整条链不稳
   - 但确实还没完全统一。

4. **本地执行策略是“安全稳定”，不是“无限自由”**
   - 这一点需要被明确理解，不然会误以为 `run_command` 不够强是 bug。

---

## 5. 我建议的下一轮优化顺序

## P0

1. **给 workspace / triggers / messaging / plaza / mcp(list/read) 统一补 `<tool_error>` envelope**
2. **修 `update_trigger` 的 type-specific revalidation**
3. **把 email wrapper 的最外层 catch-all 改成结构化错误**

## P1

4. **给 `read_document` 分文件类型补更稳定的错误分类**
5. **给 `run_command / execute_code` 加更细的 error_class**
   - timeout
   - blocked_by_policy
   - bad_arguments
   - runtime_error

## P2

6. **Plaza 再补一层 observability**
7. **MCP list/read 也并入统一遥测**

---

## 6. 最终结论

到目前为止，我的判断是：

- **其它工具整体是稳定的、可上线的**
- **但稳定性分层还不均匀**
- **当前最大的真实问题不是“工具不能用”，而是“失败语义没有统一到新一代工具标准”**

如果你要我继续落代码，最值的下一步不是再加新工具，而是：

> **把老工具统一升级到结构化错误 + 统一遥测 + trigger 再校验**

