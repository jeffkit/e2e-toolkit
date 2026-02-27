import { useState, useEffect, useCallback } from 'react'
import {
  trends, runs as runsApi,
  type PassRateDataPoint, type DurationDataPoint, type FlakyCase,
  type RunRecord, type CaseRecord, type FlakyInfoRecord,
} from '../lib/api'
import { PassRateChart } from '../components/PassRateChart'
import { DurationChart } from '../components/DurationChart'
import { FlakyTable } from '../components/FlakyTable'
import { FailuresList } from '../components/FailuresList'
import { RunTimeline } from '../components/RunTimeline'

type DateRange = 7 | 14 | 30 | 90

export function TrendsPage() {
  const [dateRange, setDateRange] = useState<DateRange>(14)
  const [suiteFilter, setSuiteFilter] = useState('')

  // Data states
  const [passRateData, setPassRateData] = useState<PassRateDataPoint[]>([])
  const [durationData, setDurationData] = useState<DurationDataPoint[]>([])
  const [flakyCases, setFlakyCases] = useState<FlakyCase[]>([])
  const [runList, setRunList] = useState<RunRecord[]>([])
  const [runHasMore, setRunHasMore] = useState(false)
  const [latestCases, setLatestCases] = useState<CaseRecord[]>([])
  const [latestFlakyInfos, setLatestFlakyInfos] = useState<FlakyInfoRecord[]>([])

  // Loading states
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyDisabled, setHistoryDisabled] = useState(false)

  const suiteId = suiteFilter || undefined

  const fetchData = useCallback(async () => {
    setLoadingCharts(true)
    setLoadingRuns(true)
    setError(null)
    setHistoryDisabled(false)

    try {
      const [passRes, durRes, flakyRes, runsRes] = await Promise.all([
        trends.passRate(dateRange, suiteId),
        trends.duration(dateRange, suiteId),
        trends.flaky(10, 0.01, suiteId),
        runsApi.list(20, 0, undefined, dateRange),
      ])

      if (!passRes.success || !durRes.success || !flakyRes.success || !runsRes.success) {
        setError('部分数据加载失败')
      }

      setPassRateData(passRes.dataPoints ?? [])
      setDurationData(durRes.dataPoints ?? [])
      setFlakyCases(flakyRes.cases ?? [])
      setRunList(runsRes.runs ?? [])
      setRunHasMore(runsRes.pagination?.hasMore ?? false)

      // Load latest run detail for failures
      if (runsRes.runs?.length) {
        try {
          const latestRun = runsRes.runs[0]!
          const detailRes = await runsApi.detail(latestRun.id)
          if (detailRes.success) {
            setLatestCases(detailRes.cases ?? [])
            setLatestFlakyInfos(detailRes.flaky ?? [])
          }
        } catch { /* non-critical */ }
      } else {
        setLatestCases([])
        setLatestFlakyInfos([])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('503') || msg.includes('History is not available')) {
        setHistoryDisabled(true)
      } else {
        setError(`数据加载失败: ${msg}`)
      }
    } finally {
      setLoadingCharts(false)
      setLoadingRuns(false)
    }
  }, [dateRange, suiteId])

  useEffect(() => { fetchData() }, [fetchData])

  const loadMoreRuns = async () => {
    setLoadingMore(true)
    try {
      const res = await runsApi.list(20, runList.length, undefined, dateRange)
      if (res.success) {
        setRunList(prev => [...prev, ...res.runs])
        setRunHasMore(res.pagination.hasMore)
      }
    } catch { /* ignore */ }
    setLoadingMore(false)
  }

  if (historyDisabled) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">趋势分析</h2>
        <div className="mt-12 text-center">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">History 功能未启用</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            在项目的 <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">e2e.yaml</code> 中添加以下配置来启用测试历史记录和趋势分析：
          </p>
          <pre className="mt-4 text-left inline-block bg-gray-900 text-green-400 rounded-lg p-4 text-sm">
{`history:
  enabled: true
  storage: local
  retention:
    maxAge: 90d
    maxRuns: 1000`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">趋势分析</h2>
          <p className="text-sm text-gray-500 mt-1">测试质量变化趋势与 Flaky 检测</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Suite filter */}
          <input
            type="text"
            placeholder="Suite 过滤..."
            value={suiteFilter}
            onChange={e => setSuiteFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Date range selector */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([7, 14, 30, 90] as DateRange[]).map(d => (
              <button
                key={d}
                onClick={() => setDateRange(d)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  dateRange === d
                    ? 'bg-white text-gray-900 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <PassRateChart data={passRateData} loading={loadingCharts} />
        <DurationChart data={durationData} loading={loadingCharts} />
      </div>

      {/* Flaky + Failures Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FlakyTable cases={flakyCases} loading={loadingCharts} />
        <FailuresList cases={latestCases} flakyInfos={latestFlakyInfos} loading={loadingCharts} />
      </div>

      {/* Run Timeline */}
      <RunTimeline
        runs={runList}
        hasMore={runHasMore}
        loading={loadingRuns || loadingMore}
        onLoadMore={loadMoreRuns}
      />
    </div>
  )
}
