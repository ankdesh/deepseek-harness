# Agent Note: Reusable deterministic flows

Status: implemented

[English](2026-10-09-reusable-flows.md) | 中文

## 问题

多操作请求必须跨越等待、conversation 变化和进程丢失。仅凭模型回复和 browser callback 不能确立顺序或已保存结果。

## 决策

Workflow group 包含可复用 flow 定义、纯编译器、持久执行、严格 YAML 加载、原生结果专用阶段和生成的命名工具。Browser 控制使用相同的修订检查命令。产品操作保留语义验证和 service receipt。现有 script execution 与 durable workflow service 保持独立且兼容。[Catalog 决策](2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md) 继续负责那些现有服务；此能力扩展执行，但不替换其持久化记录。

受理的执行固定展开的图、指令、不可变输入、操作声明和费用。进度先于效果提交。未知写入需要声明的 receipt recovery。重启后，新工作必须先显式 Resume。Subflow 共享一个执行及配额。

原生模型阶段使用现有 conversation 及 structured-result capture。一次尝试只允许一个请求；不提供领域工具或自动修正。可信 host 可以把目标 conversation 的费用归入现有父执行预算。Goal control guard 阻止在必需 flow 工作未解决时独立完成 Goal。

## 考虑过的替代方案

**仅使用文本指令或 skill。** 它们可以指导内容编写，但不定义持久操作顺序或权威恢复。

**每个请求都由模型编写计划。** 这为常见操作增加无界验证范围。开发者定义使编译不调用模型或产生 service 效果。

**覆盖所有请求的中心产品状态机。** 这会把领域 approval 状态与通用进度耦合。类型化操作和可复用 subflow 保持职责分离。

## 结果

基于现有操作添加 flow 只需要定义和部署选择，不需要新 endpoint 或 tool handler。操作提供者必须保留精确的版本语义和稳定 receipt ID。一个进程管理一个 state root；并行执行、自动修正、模型创建定义和可移植可执行 trace 仍推迟。

## 验证

原生 Loader 测试验证命名工具选择、类型化阶段结果、中断后 Resume、SDK 命令以及真实 JSONL/SQLite 持久化。Runtime 测试覆盖顺序、分支、subflow、关联决定、过期控制、保守计费、receipt 核对及持久命令发送。Headless 测试验证等待及退出标识。产品检查使用真实 Spec service，并检查自动与受限策略、架构修订、Goal 释放、browser 重载与关闭以及 Spec Editor 批准后的已保存源内容。完整 profile 与文档检查保留观察到的失败；它们不是发布通过的证据。

恢复记录区分未分派意图与不确定效果。原生回执检查使用显式持久化读取。恢复的对话在处理普通输入前移除过期阶段通知。共用请求计费助手在缺少用量时保留保守费用。产品服务测试覆盖分派前后丢失提交响应，且模型阶段不重复、保存不重复；关闭的 Goal 源对话保留待交付的释放记录。

原生请求预留被拒绝时保留预算诊断，并在访问提供者之前停止。真实 Loader 回归检查验证其后不发生模型请求或修正尝试。产品迁移也移除旧 Python 决定桥接；Spec 决定使用关联 flow 控制与 service 回执。

独立回执完整性测试在对话打开及关闭后都能发现被修改的模型输出。伴随检查在两种情况下都读取持久回执；缺少原生阶段输入也属于不变量失败。
