import type { RunRecord } from '../lib/api'

interface Props {
  runs: RunRecord[]
  hasMore: boolean
  loading?: boolean
  onLoadMore?: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

const TRIGGER_ICON: Record<string, string> = {
  cli: '⌨',
  mcp: '🤖',
  dashboard: '🖥',
  ci: '⚙',
}

export function RunTimeline({ runs, hasMore, loading, onLoadMore }: Props) {
  if (loading && !runs.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!runs.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">暂无运行记录</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">运行历史</h3>
      <div className="space-y-0 relative max-h-[600px] overflow-y-auto">
        {/* Timeline line */}
        <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />

        {runs.map(run => {
          const isPassed = run.status === 'passed'
          const total = run.passed + run.failed + run.skipped

          return (
            <div key={run.id} className="relative pl-8 pb-4">
              {/* Status dot */}
              <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 border-white ${
                isPassed ? 'bg-green-500' : 'bg-red-500'
              }`} />

              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-500">{formatTime(run.timestamp)}</span>
                    <span className="text-xs text-gray-400">{formatDuration(run.duration)}</span>
                    {run.gitBranch && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                        {run.gitBranch}
                      </span>
                    )}
                    <span className="text-xs" title={`Trigger: ${run.trigger}`}>
                      {TRIGGER_ICON[run.trigger] ?? '?'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className="text-green-600">{run.passed} 通过</span>
                    {run.failed > 0 && <span className="text-red-600">{run.failed} 失败</span>}
                    {run.skipped > 0 && <span className="text-gray-400">{run.skipped} 跳过</span>}
                    {run.flaky > 0 && <span className="text-yellow-600">{run.flaky} flaky</span>}
                  </div>

                  {/* Mini progress bar */}
                  {total > 0 && (
                    <div className="flex h-1.5 w-full max-w-xs mt-1.5 rounded-full overflow-hidden bg-gray-100">
                      <div className="bg-green-500" style={{ width: `${(run.passed / total) * 100}%` }} />
                      <div className="bg-red-500" style={{ width: `${(run.failed / total) * 100}%` }} />
                      <div className="bg-gray-300" style={{ width: `${(run.skipped / total) * 100}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="mt-3 w-full py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
        >
          {loading ? '加载中...' : '加载更多'}
        </button>
      )}
    </div>
  )
}
