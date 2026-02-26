# 文档-代码映射表

| 文档路径 | 代码路径模式 | 说明 |
|----------|-------------|------|
| `README.md` | `packages/cli/src/**`, `packages/core/src/**`, `packages/mcp/src/**` | 项目总览文档 |
| `docs/ONBOARDING.md` | `packages/cli/src/commands/**`, `packages/core/src/config-loader.ts` | 业务接入指南 |
| `docs/yaml-test-config.md` | `packages/core/src/types.ts`, `packages/core/src/yaml-engine.ts`, `packages/core/src/assertion-engine.ts` | YAML 测试配置参考文档 |
| `ci-templates/gitlab-ci.yml` | `packages/cli/src/commands/**` | GitLab CI 模板 |
| `ci-templates/github-actions.yml` | `packages/cli/src/commands/**` | GitHub Actions 模板 |
| `mcp-templates/cursor-mcp-config.json` | `packages/mcp/src/server.ts` | MCP 配置模板 |
