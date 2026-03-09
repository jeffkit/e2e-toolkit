# argusai-dashboard

## 0.6.0

### Minor Changes

- feat: 新增趋势分析页面与历史 REST API

  **Dashboard 趋势分析页面：**
  - 通过率折线图（PassRateChart）
  - 执行时间区域图（DurationChart）
  - Flaky Test 排行表（FlakyTable）
  - 最近失败列表（FailuresList）
  - 运行历史时间轴（RunTimeline）
  - 日期范围和 Suite 过滤器

  **REST API 端点 (7 个)：**
  - `GET /api/trends/pass-rate` — 通过率趋势
  - `GET /api/trends/duration` — 执行时间趋势
  - `GET /api/trends/flaky` — Flaky 排行榜
  - `GET /api/trends/failures` — 用例失败趋势
  - `GET /api/runs` — 运行历史列表
  - `GET /api/runs/:id` — 单次运行详情
  - `GET /api/runs/:id/compare/:compareId` — 运行对比

### Patch Changes

- Updated dependencies
  - argusai-core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
