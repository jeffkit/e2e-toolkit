/**
 * Component tests for TrendsPage.
 * Verifies rendering with data, empty state, loading states,
 * and date range / suite filter interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TrendsPage } from './TrendsPage'

const mockPassRate = vi.fn()
const mockDuration = vi.fn()
const mockFlaky = vi.fn()
const mockRunsList = vi.fn()
const mockRunsDetail = vi.fn()

vi.mock('../lib/api', () => ({
  trends: {
    passRate: (...args: unknown[]) => mockPassRate(...args),
    duration: (...args: unknown[]) => mockDuration(...args),
    flaky: (...args: unknown[]) => mockFlaky(...args),
    failures: vi.fn(),
  },
  runs: {
    list: (...args: unknown[]) => mockRunsList(...args),
    detail: (...args: unknown[]) => mockRunsDetail(...args),
    compare: vi.fn(),
  },
}))

function setupMocks(empty = false) {
  mockPassRate.mockResolvedValue({
    success: true,
    period: { from: '2026-02-12', to: '2026-02-26' },
    granularity: 'daily',
    dataPoints: empty ? [] : [
      { date: '2026-02-25', passRate: 92.3, passed: 12, failed: 1, skipped: 0, runCount: 1 },
      { date: '2026-02-26', passRate: 100, passed: 13, failed: 0, skipped: 0, runCount: 1 },
    ],
  })

  mockDuration.mockResolvedValue({
    success: true,
    period: { from: '2026-02-12', to: '2026-02-26' },
    dataPoints: empty ? [] : [
      { date: '2026-02-25', avgDuration: 5000, minDuration: 4000, maxDuration: 6000, runCount: 1 },
    ],
  })

  mockFlaky.mockResolvedValue({
    success: true,
    cases: empty ? [] : [
      { caseName: 'test-login', suiteId: 'api', score: 0.3, level: 'FLAKY', recentResults: ['passed', 'failed', 'passed'], failCount: 3, totalRuns: 10 },
    ],
    totalFlaky: empty ? 0 : 1,
    analysisWindow: 10,
  })

  mockRunsList.mockResolvedValue({
    success: true,
    runs: empty ? [] : [
      {
        id: 'run-1', project: 'test', timestamp: Date.now(), gitCommit: 'abc', gitBranch: 'main',
        configHash: 'sha256:test', trigger: 'cli', duration: 5000,
        passed: 10, failed: 1, skipped: 0, flaky: 0, status: 'failed',
      },
    ],
    pagination: { total: empty ? 0 : 1, limit: 20, offset: 0, hasMore: false },
  })

  mockRunsDetail.mockResolvedValue({
    success: true,
    run: {
      id: 'run-1', project: 'test', timestamp: Date.now(), gitCommit: 'abc', gitBranch: 'main',
      configHash: 'sha256:test', trigger: 'cli', duration: 5000,
      passed: 10, failed: 1, skipped: 0, flaky: 0, status: 'failed',
    },
    cases: [
      { id: 'c1', runId: 'run-1', suiteId: 'api', caseName: 'test-fail', status: 'failed', duration: 100, attempts: 1, responseMs: null, assertions: null, error: 'Some error', snapshot: null },
    ],
    flaky: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TrendsPage', () => {
  it('should render with data and display charts', async () => {
    setupMocks(false)
    render(<TrendsPage />)

    await waitFor(() => {
      expect(screen.getByText('趋势分析')).toBeDefined()
    })

    expect(screen.getByText('通过率趋势')).toBeDefined()
    expect(screen.getByText('执行时长趋势')).toBeDefined()
    expect(screen.getByText('Flaky 测试排名')).toBeDefined()
    expect(screen.getByText('运行历史')).toBeDefined()
  })

  it('should render empty state when no data', async () => {
    setupMocks(true)
    render(<TrendsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('暂无数据').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText('暂无运行记录')).toBeDefined()
  })

  it('should show loading states initially', () => {
    setupMocks(false)
    mockPassRate.mockReturnValue(new Promise(() => {}))
    mockDuration.mockReturnValue(new Promise(() => {}))
    mockFlaky.mockReturnValue(new Promise(() => {}))
    mockRunsList.mockReturnValue(new Promise(() => {}))

    render(<TrendsPage />)

    const loadingElements = screen.getAllByText('加载中...')
    expect(loadingElements.length).toBeGreaterThan(0)
  })

  it('should change date range when clicking buttons', async () => {
    setupMocks(false)
    render(<TrendsPage />)

    await waitFor(() => {
      expect(mockPassRate).toHaveBeenCalled()
    })

    vi.clearAllMocks()
    setupMocks(false)

    const btn30 = screen.getByText('30天')
    fireEvent.click(btn30)

    await waitFor(() => {
      expect(mockPassRate).toHaveBeenCalledWith(30, undefined)
    })
  })

  it('should render history disabled state on 503', async () => {
    mockPassRate.mockRejectedValue(new Error('503 History is not available'))
    mockDuration.mockRejectedValue(new Error('503'))
    mockFlaky.mockRejectedValue(new Error('503'))
    mockRunsList.mockRejectedValue(new Error('503'))

    render(<TrendsPage />)

    await waitFor(() => {
      expect(screen.getByText('History 功能未启用')).toBeDefined()
    })
  })
})
