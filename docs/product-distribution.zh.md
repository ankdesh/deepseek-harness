# 产品开发与原生分发

[English](product-distribution.md) | 中文

## 概要

可以基于本地 Harness 仓库开发产品，并构建只包含所选运行时包的原生应用分发。产品拥有自己的多个包组合、UI、工具、配置、依赖锁文件及部署脚本。每种产品模式都通过具名 `dsh` 配置档启动。

## 目录

- [开发接口](#development-interface)
- [分发接口](#release-interface)
- [维护](#maintenance)

<a id="development-interface"></a>

## 开发接口

完成[主机端构建](development.zh.md)后，产品包装脚本设置独立的 `DSH_HOME`，并调用本仓库的 `node scripts/product-runtime.mjs dev PRODUCT_DIRECTORY [PROFILE]`。单包组合产品在包清单中声明 `dsh.bundle.patch`。分层产品在 `harness.product.json` 中声明 `defaultProfile` 和 `profiles` 对象；每个配置档提供有序 `bundles` 列表、相对于产品目录的 `localBundles` 目录，以及可选的 `patchReload` 策略。Harness 依赖链接到本仓库；产品自己的依赖必须已安装。启动脚本准备所有已声明配置档，启动指定或默认配置档，转发终止信号并等待子进程退出。

共享配置档辅助函数为一个具名配置档更新托管链接和清单。它验证每个本地包组合，要求有序层列表包含所有本地包组合，保留现有用户补丁，并拒绝替换托管链接位置上的真实目录。每个产品都需要独立的状态目录。

<a id="release-interface"></a>

## 分发接口

产品包装脚本调用 `node scripts/product-pack.mjs PRODUCT_DIRECTORY NEW_OUTPUT_DIRECTORY`。目标目录必须尚不存在。产品提供含有 `commit` 和 `node` 的 `harness.lock.json`，以及含有 `schemaVersion: 1` 和产品相对路径数组 `releaseFiles` 的 `harness.product.json`。提交标识必须与仓库 HEAD 一致。

打包器保留已构建的启动器代码，仅将复制的依赖清单缩减为已构建 CLI 导入的包。它遍历已安装依赖、必需的对等依赖，以及与主机平台兼容的可用可选依赖。所选包保留独立依赖链接；根目录包表也支持 Cordis 的裸包导入。构建后的 `lib` 目录保持完整，因为运行时导出可能引用 `lib/types` 下的编译文件。

输出包含产品包、所选运行时包、产品分发文件、`deployment/harness-profile.mjs`、分发元数据、包许可证说明、文件校验和及同级 `.tar.gz`。内部包链接保持在分发目录内。目标主机需要受支持的 Node 运行时及产品声明的原生前置依赖。启动时不安装包，也不构建 JavaScript。

<a id="maintenance"></a>

## 维护

将共享运行时修复和这些工具保存在分叉仓库的集成分支上。产品行为保留在产品仓库中。更新 Harness 锁文件前，应针对上游候选版本测试每个产品。在另一目录中构建并解包候选分发，然后通过其附带 CLI 测试产品。将可写状态保存在分发目录之外，并在回滚前检查会话格式兼容性。

[决策记录](../.agents/notes/implemented/process/2026-09-15-product-owned-native-distributions.zh.md)说明所有权和打包选择。`pnpm run test:product-distribution` 验证配置档替换行为；产品仓库拥有模型、工具和移动分发目录后的集成测试。

## 开发备注

无。
