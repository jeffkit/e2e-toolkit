# 文档-代码映射表

| 文档路径 | 代码路径模式 | 说明 |
|----------|-------------|------|
| `README.md` | `packages/cli/src/**`, `packages/core/src/**`, `packages/mcp/src/**` | 项目总览文档 |
| `docs/ONBOARDING.md` | `packages/cli/src/commands/**`, `packages/core/src/config-loader.ts` | 业务接入指南 |
| `docs/yaml-test-config.md` | `packages/core/src/types.ts`, `packages/core/src/yaml-engine.ts`, `packages/core/src/assertion-engine.ts` | YAML 测试配置参考文档 |
| `ci-templates/gitlab-ci.yml` | `packages/cli/src/commands/**` | GitLab CI 模板 |
| `ci-templates/github-actions.yml` | `packages/cli/src/commands/**` | GitHub Actions 模板 |
| `mcp-templates/cursor-mcp-config.json` | `packages/mcp/src/server.ts` | MCP 配置模板 |
| `specs/003-resilience/spec.md` | `packages/core/src/resilience/**` | 韧性与自愈功能规格 |
| `specs/003-resilience/plan.md` | `packages/core/src/resilience/**`, `packages/mcp/src/tools/preflight-check.ts`, `packages/mcp/src/tools/reset-circuit.ts` | 韧性功能实现计划 |
| `specs/003-resilience/tasks.md` | `packages/core/src/resilience/**`, `packages/mcp/src/**` | 韧性功能任务清单 |
