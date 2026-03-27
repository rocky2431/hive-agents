---
name: Self-Improving Agent
description: 持续自我改进协议。记录错误、纠正和学习，将经验沉淀为可复用知识。当操作失败、用户纠正、发现更好方法时自动触发。
tools:
  - write_file
  - read_file
  - execute_code
is_system: true
is_default: true
---

# Self-Improving Agent

记录错误和经验教训，沉淀为持久知识。重要学习会晋升到 agent 核心文件。

## 触发时机

| 情况 | 操作 |
|------|------|
| 命令/操作失败 | 记录到 `memory/learnings/ERRORS.md` |
| 用户纠正你 | 记录到 `memory/learnings/LEARNINGS.md`，分类 `correction` |
| 用户需要你没有的能力 | 记录到 `memory/learnings/FEATURE_REQUESTS.md` |
| API/外部工具失败 | 记录到 `memory/learnings/ERRORS.md` |
| 发现你的知识过时 | 记录到 `memory/learnings/LEARNINGS.md`，分类 `knowledge_gap` |
| 发现更好的方法 | 记录到 `memory/learnings/LEARNINGS.md`，分类 `best_practice` |
| 广泛适用的经验 | 晋升到 `soul.md` 或 `memory/memory.md` |

## 检测触发词

**用户纠正**（→ learning, correction）：
- "不对"、"错了"、"实际上应该是..."、"那个过时了"

**知识缺口**（→ learning, knowledge_gap）：
- 用户提供了你不知道的信息
- 你引用的文档已过时

**错误**（→ error）：
- 命令返回非零退出码
- 异常或堆栈跟踪
- 超时或连接失败

## 文件结构

```
memory/
├── memory.md              # 长期记忆（已有）
├── learnings/             # 本 skill 的记录目录
│   ├── LEARNINGS.md       # 纠正、知识缺口、最佳实践
│   ├── ERRORS.md          # 命令失败、异常
│   └── FEATURE_REQUESTS.md # 用户需要的新能力
```

首次使用时自动创建 `memory/learnings/` 目录。

## 记录格式

### 学习条目

追加到 `memory/learnings/LEARNINGS.md`：

```markdown
## [LRN-YYYYMMDD-XXX] 分类

**时间**: ISO-8601
**优先级**: low | medium | high | critical
**状态**: pending

### 概要
一句话描述学到了什么

### 详情
完整上下文：发生了什么，哪里错了，正确做法是什么

### 建议操作
具体的改进措施

### 元数据
- 来源: conversation | error | user_feedback
- 相关文件: path/to/file
- 关联: LRN-20250110-001（如果和已有条目相关）
---
```

### 错误条目

追加到 `memory/learnings/ERRORS.md`：

```markdown
## [ERR-YYYYMMDD-XXX] 命令或工具名

**时间**: ISO-8601
**优先级**: high
**状态**: pending

### 概要
简述什么失败了

### 错误信息
实际的错误输出

### 上下文
- 尝试执行的命令/操作
- 使用的输入或参数

### 建议修复
可能的解决方案

### 元数据
- 可复现: yes | no | unknown
- 相关文件: path/to/file
---
```

## 解决条目

修复问题后更新条目：
1. 将 `**状态**: pending` 改为 `**状态**: resolved`
2. 添加解决记录：

```markdown
### 解决
- **解决时间**: 2025-01-16T09:00:00Z
- **备注**: 简述做了什么
```

## 晋升到核心文件

当经验具有广泛适用性时，晋升到永久知识：

| 学习类型 | 晋升目标 | 示例 |
|---------|---------|------|
| 行为模式/性格调整 | `soul.md`（每次调用注入，2000字符） | "简洁回复，避免废话" |
| 当前任务相关的经验 | `focus.md`（每次调用注入，3000字符） | "用户偏好方案 A，API 端点已改" |
| 长期有效的知识 | `memory/memory.md`（每次调用注入，2000字符） | "项目用 pnpm，不是 npm" |
| 工具使用技巧 | `memory/learnings/LEARNINGS.md` | 保留，不晋升 |

### 晋升条件

满足以下任一条件时晋升：
- 同一问题出现 3 次以上
- 跨多个文件/功能的通用知识
- 防止反复犯错的规则

### 晋升步骤

1. **提炼**为简洁的规则或事实
2. **添加**到目标文件的合适位置
3. **更新**原条目状态为 `promoted`

## 周期性回顾

在以下时机回顾 `memory/learnings/`：
- 开始重大新任务前
- 完成一个功能后
- 在有历史问题的领域工作时

```bash
# 查看待处理项数量
grep -h "状态.*pending" memory/learnings/*.md | wc -l

# 查看高优先级待处理项
grep -B3 "优先级.*high" memory/learnings/*.md | grep "^## \["
```

## 反复模式检测

记录类似内容前先搜索：
1. 搜索已有条目中是否有类似问题
2. 如果有，添加关联引用
3. 提高优先级
4. 考虑晋升为核心知识

## 最佳实践

1. **立即记录** — 上下文最新鲜的时候
2. **具体明确** — 未来需要快速理解
3. **包含重现步骤** — 尤其是错误
4. **建议具体修复** — 不要只写"调查一下"
5. **积极晋升** — 有疑虑时就晋升到核心文件
