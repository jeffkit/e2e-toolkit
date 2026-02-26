import { useState } from 'react'
import type { CaseRecord, FlakyInfoRecord } from '../lib/api'

interface FailureEntry {
  caseName: string
  suiteId: string
  error: string | null
  lastFailedDate: string
  flakyInfo?: FlakyInfoRecord
}

interface Props {
  cases: CaseRecord[]
  flakyInfos: FlakyInfoRecord[]
  loading?: boolean
}

const LEVEL_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  STABLE:        { bg: 'bg-green-100', text: 'text-green-700', label: 'Stable' },
  MOSTLY_STABLE: { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Mostly Stable' },
  FLAKY:         { bg: 'bg-yellow-100',text: 'text-yellow-700',label: 'Flaky' },
  VERY_FLAKY:    { bg: 'bg-orange-100',text: 'text-orange-700',label: 'Very Flaky' },
  BROKEN:        { bg: 'bg-red-100',   text: 'text-red-700',   label: 'Broken' },
}

export function FailuresList({ cases, flakyInfos, loading }: Props) {
  const [expandedCase, setExpandedCase] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">最近失败</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  const failedCases = cases.filter(c => c.status === 'failed')
  const flakyMap = new Map(flakyInfos.map(f => [f.caseName, f]))

  const entries: FailureEntry[] = failedCases.map(c => ({
    caseName: c.caseName,
    suiteId: c.suiteId,
    error: c.error,
    lastFailedDate: new Date().toISOString().slice(0, 10),
    flakyInfo: flakyMap.get(c.caseName),
  }))

  if (!entries.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">最近失败</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">
          没有失败的测试用例
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        最近失败 <span className="text-sm font-normal text-gray-500">({entries.length})</span>
      </h3>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {entries.map(entry => {
          const isExpanded = expandedCase === entry.caseName
          const badge = entry.flakyInfo
            ? LEVEL_BADGE[entry.flakyInfo.level] ?? LEVEL_BADGE.STABLE!
            : null

          return (
            <div key={`${entry.suiteId}-${entry.caseName}`} className="border rounded-lg">
              <button
                className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedCase(isExpanded ? null : entry.caseName)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <span className="font-mono text-xs text-gray-900 truncate">{entry.caseName}</span>
                    {badge && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{entry.suiteId}</span>
                    {entry.error && (
                      <span className="truncate max-w-xs text-red-600">{entry.error.slice(0, 80)}</span>
                    )}
                  </div>
                </div>
                <span className="text-gray-400 text-sm ml-2">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {isExpanded && entry.error && (
                <div className="px-4 pb-3 border-t bg-gray-50">
                  <pre className="text-xs text-red-700 whitespace-pre-wrap break-all mt-2 max-h-48 overflow-y-auto">
                    {entry.error}
                  </pre>
                  {entry.flakyInfo && (
                    <p className="mt-2 text-xs text-gray-600 italic">
                      {entry.flakyInfo.suggestion}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
