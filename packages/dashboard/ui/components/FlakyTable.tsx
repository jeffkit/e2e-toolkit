import { useState } from 'react'
import type { FlakyCase } from '../lib/api'

interface Props {
  cases: FlakyCase[]
  loading?: boolean
  onSelect?: (caseName: string) => void
}

const LEVEL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  STABLE:        { bg: 'bg-green-100', text: 'text-green-800', label: 'Stable' },
  MOSTLY_STABLE: { bg: 'bg-blue-100',  text: 'text-blue-800',  label: 'Mostly Stable' },
  FLAKY:         { bg: 'bg-yellow-100',text: 'text-yellow-800',label: 'Flaky' },
  VERY_FLAKY:    { bg: 'bg-orange-100',text: 'text-orange-800',label: 'Very Flaky' },
  BROKEN:        { bg: 'bg-red-100',   text: 'text-red-800',   label: 'Broken' },
}

const RESULT_DOT: Record<string, string> = {
  passed:  'bg-green-500',
  failed:  'bg-red-500',
  skipped: 'bg-gray-300',
}

type SortKey = 'score' | 'caseName' | 'totalRuns'

export function FlakyTable({ cases, loading, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(false)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sorted = [...cases].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'score') cmp = a.score - b.score
    else if (sortKey === 'caseName') cmp = a.caseName.localeCompare(b.caseName)
    else cmp = a.totalRuns - b.totalRuns
    return sortAsc ? cmp : -cmp
  })

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className="ml-1 text-gray-400">
      {sortKey === col ? (sortAsc ? '↑' : '↓') : '↕'}
    </span>
  )

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Flaky 测试排名</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!cases.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Flaky 测试排名</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">
          没有检测到 flaky 测试
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Flaky 测试排名</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => toggleSort('caseName')}>
                用例名称 <SortIcon col="caseName" />
              </th>
              <th className="pb-2 pr-4">Suite</th>
              <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => toggleSort('score')}>
                Flaky 分数 <SortIcon col="score" />
              </th>
              <th className="pb-2 pr-4">稳定等级</th>
              <th className="pb-2 pr-4">近期结果</th>
              <th className="pb-2 cursor-pointer select-none" onClick={() => toggleSort('totalRuns')}>
                运行次数 <SortIcon col="totalRuns" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const style = LEVEL_STYLES[c.level] ?? LEVEL_STYLES.STABLE!
              return (
                <tr
                  key={`${c.suiteId}-${c.caseName}`}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => onSelect?.(c.caseName)}
                >
                  <td className="py-2.5 pr-4 font-mono text-xs text-gray-900 max-w-xs truncate">
                    {c.caseName}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500 text-xs">{c.suiteId}</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.score >= 0.5 ? 'bg-red-500' : c.score >= 0.2 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                          style={{ width: `${Math.min(c.score * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-600">{(c.score * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex gap-0.5">
                      {c.recentResults.slice(-10).map((r, i) => (
                        <span
                          key={i}
                          className={`w-2 h-2 rounded-full ${RESULT_DOT[r] ?? 'bg-gray-300'}`}
                          title={r}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 text-gray-500 text-xs">{c.failCount}/{c.totalRuns}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
