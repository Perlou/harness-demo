# harness-engineering · Claude Code Skill

把 OpenAI 在 2026/2 提出的 **Harness Engineering（驭缰工程）** 范式，
提炼为一份可被 Claude（或任何 LLM 助手）加载、在合适时机自动应用的 skill。

> 一句话定义：工程师不再亲手写代码，而是**设计环境、明确意图、构建反馈
> 回路**，让 AI 智能体可靠地完成工作。

---

## 这个 skill 解决的问题

当你让 Claude 帮你构建任何**让 agent 真正动东西**的系统（写库、调外部
API、操作文件、触发部署、移动资金、发布内容…），它的默认行为是"直接
做"，导致：

- 规则散落在控制流里，看不到、不可 review
- 高风险动作没有人工干预点
- 出错时无法追溯
- LLM 输出不可控时整个系统失守

加载本 skill 后，Claude 会自动按 **Intent → Plan → Check → Approve →
Execute → Trace** 五阶段拆解，把**约束变成显式工件**，把**人工审批变成
独立命令边界**，把**每次运行变成可被 git 追踪的工件**。

---

## 安装方式

`SKILL.md` 是核心文件，可被多种环境加载。

### 方式 1：Claude Code 全局 skill

```bash
# 复制到用户级 skills 目录（Claude Code 启动时自动发现）
mkdir -p ~/.claude/skills
cp -r harness-engineering ~/.claude/skills/

# 或仅复制 SKILL.md
mkdir -p ~/.claude/skills/harness-engineering
cp harness-engineering/SKILL.md ~/.claude/skills/harness-engineering/
```

之后任何项目里的 Claude Code 会话都能识别本 skill 并在合适时机调用。

### 方式 2：项目级 skill

```bash
# 放进项目的 .claude/skills/
mkdir -p <your-project>/.claude/skills
cp -r harness-engineering <your-project>/.claude/skills/
```

仅该项目的会话会加载本 skill。

### 方式 3：Codex / Cursor / 其它 LLM 助手

直接把 `SKILL.md` 的内容粘到你常用助手的 system prompt 或 context 里。
Markdown 格式通用，对任何能读 Markdown 的 LLM 都生效。

### 方式 4：发布为 plugin / marketplace

完整的 skill 目录（含 SKILL.md + 本 README）可作为 plugin 发布。Claude Code
社区有 [skill-creator](https://github.com/apps/skill-creator) 这类工具帮
忙打包。

---

## 何时被自动调用

Claude 会在以下场景自动唤起本 skill：

- 用户问"我想让 agent 自动 ___"，___ 是 DB 写入 / 文件操作 / API 调用 /
  部署 / 发邮件 / 资金动作 / 内容发布等有副作用的事
- 用户表达对 LLM 输出可靠性的担忧（"agent 直接动数据库我不放心"、"出错了
  能回溯吗"、"怎么让 LLM 输出可靠"）
- 用户在设计一个含 approval gate / audit log / policy 检查 的系统

不会唤起的场景：纯对话机器人、一次性文本生成、只读检索工具、纯函数库。

---

## 这份 skill 教 Claude 做什么

打开 `SKILL.md` 看完整内容。摘要：

1. **应用三条核心理念** —— 工件即事实来源 / 约束即显式规则 / 价值在搭脚手架
2. **按五阶段生命周期组织代码** —— Intent / Plan / Check / Approve /
   Execute / Trace
3. **遵守封闭 matcher 注册表边界** —— yaml 不能变成 mini DSL
4. **写双轨证明测试** —— 让假 LLM 故意输出违规内容，验证下游能拦下
5. **避免 7 个反模式** —— 规则写在 if/else / 审批是 toast / Demo 走特殊
   路径 / 等等
6. **每个 finalize 路径都写 report.md** —— 让陌生人能复述运行过程

详细理论与具体动作清单见 SKILL.md 中相应章节。

---

## 谁应该用本 skill

- 在做 AI agent 项目的工程师
- 写"让 LLM 帮我自动 X"业务的团队
- 做平台 / SRE / DevOps，想给 agent 搭可信运行环境的人
- 教学场景：想用一个具体范式讨论"AI 时代工程师的产出物"

---

## 起源与可分享性

本 skill 是从 [OpenAI 2026/2 提出的 Harness Engineering 范式]提炼而来，
配合一份完整的可运行参考实现（基于 TypeScript + Zod + better-sqlite3 +
OpenAI SDK 的 SQL 助手 CLI）反复迭代成型。

**完全 MIT 许可，自由分享**。复制到任何地方使用、修改、分发都可以。建议
保留 SKILL.md 顶部的 frontmatter 让 Claude Code 能正确识别 skill 身份。

如果你扩展或改进了本 skill，欢迎反馈给原始仓库（如有）或自由 fork 维护
你自己的版本。

---

## 文件清单

```
harness-engineering/
├── SKILL.md          核心文件 —— Claude 加载的内容
└── README.md         本文件 —— 安装与使用说明
```

`SKILL.md` 是唯一必需的文件。本 README 仅说明用法，不会被 Claude 加载。
