import { useState, useEffect, useRef } from 'react'
import { activities, type ActivityEntry } from '../lib/api'

const OP_LABELS: Record<string, string> = {
  init: '初始化',
  build: '镜像构建',
  setup: '环境启动',
  run: '测试执行',
  clean: '资源清理',
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  running: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500 animate-pulse' },
  success: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  failed: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
}

const SOURCE_BADGE: Record<string, { label: string; style: string }> = {
  ai: { label: 'AI', style: 'bg-purple-100 text-purple-700' },
  manual: { label: '手动', style: 'bg-gray-100 text-gray-700' },
  system: { label: '系统', style: 'bg-yellow-100 text-yellow-700' },
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    activities.list(100).then(res => setEntries(res.activities)).catch(() => {})

    const es = new EventSource('/api/events')
    eventSourceRef.current = es

    es.addEventListener('activity:activity_start', (e) => {
      const data = JSON.parse(e.data) as ActivityEntry
      setEntries(prev => [data, ...prev.slice(0, 199)])
    })

    es.addEventListener('activity:activity_update', (e) => {
      const data = JSON.parse(e.data) as ActivityEntry
      setEntries(prev => {
        const idx = prev.findIndex(a => a.id === data.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = data
          return next
        }
        return [data, ...prev.slice(0, 199)]
      })
    })

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => { es.close() }
  }, [])

  const running = entries.filter(e => e.status === 'running')
  const completed = entries.filter(e => e.status !== 'running')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">活动时间线</h2>
          <p className="text-sm text-gray-500 mt-1">实时追踪 AI 和手动操作</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>

      {running.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">进行中</h3>
          <div className="space-y-3">
            {running.map(entry => (
              <ActivityCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
          历史记录 ({completed.length})
        </h3>
        {completed.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg">暂无活动记录</p>
            <p className="text-sm mt-1">当 AI 或你手动执行操作时，活动会显示在这里</p>
          </div>
        ) : (
          <div className="space-y-2">
            {completed.map(entry => (
              <ActivityCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityCard({ entry }: { entry: ActivityEntry }) {
  const styles = STATUS_STYLES[entry.status] ?? STATUS_STYLES.running
  const source = SOURCE_BADGE[entry.source] ?? SOURCE_BADGE.system

  return (
    <div className={`rounded-lg border p-4 ${styles.bg} border-gray-200`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${styles.dot}`} />
          <span className="font-medium text-gray-900">
            {OP_LABELS[entry.operation] ?? entry.operation}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${source.style}`}>
            {source.label}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>{formatDuration(entry.startTime, entry.endTime)}</span>
          <span>{formatTime(entry.startTime)}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-gray-500">项目:</span>
        <span className="text-gray-700">{entry.project}</span>
        <span className={`ml-auto text-xs font-medium ${styles.text}`}>
          {entry.status === 'running' ? '执行中...' : entry.status === 'success' ? '成功' : '失败'}
        </span>
      </div>
      {entry.detail && (
        <p className="mt-2 text-xs text-gray-500">{entry.detail}</p>
      )}
    </div>
  )
}
