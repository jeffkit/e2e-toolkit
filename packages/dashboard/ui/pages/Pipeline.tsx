import { useState, useEffect, useRef } from 'react'

interface StageState {
  id: string
  label: string
  status: 'idle' | 'running' | 'success' | 'failed'
  startTime?: number
  endTime?: number
  events: Array<{ type: string; message: string; timestamp: number }>
}

const STAGE_DEFS = [
  { id: 'init', label: '初始化' },
  { id: 'build', label: '镜像构建' },
  { id: 'setup', label: '环境启动' },
  { id: 'run', label: '测试执行' },
  { id: 'clean', label: '资源清理' },
]

const STATUS_COLORS: Record<string, { ring: string; bg: string; icon: string }> = {
  idle: { ring: 'ring-gray-300', bg: 'bg-gray-100', icon: '○' },
  running: { ring: 'ring-blue-400', bg: 'bg-blue-100', icon: '◉' },
  success: { ring: 'ring-green-400', bg: 'bg-green-100', icon: '✓' },
  failed: { ring: 'ring-red-400', bg: 'bg-red-100', icon: '✗' },
}

function eventToStageId(eventName: string): string | null {
  if (eventName.startsWith('activity:')) {
    const data = eventName.replace('activity:', '')
    if (data === 'activity_start' || data === 'activity_update') return null
  }
  if (eventName.startsWith('build:')) return 'build'
  if (eventName.startsWith('setup:')) return 'setup'
  if (eventName.startsWith('test:')) return 'run'
  if (eventName.startsWith('clean:')) return 'clean'
  return null
}

function formatDuration(start?: number, end?: number): string {
  if (!start) return '-'
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function PipelinePage() {
  const [stages, setStages] = useState<StageState[]>(
    STAGE_DEFS.map(d => ({ ...d, status: 'idle', events: [] }))
  )
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/events')
    eventSourceRef.current = es

    const handleEvent = (channel: string, eventName: string, data: unknown) => {
      const parsed = data as Record<string, unknown>

      setStages(prev => {
        const next = [...prev]

        // Activity events track the high-level operation lifecycle
        if (channel === 'activity') {
          const op = parsed.operation as string
          const status = parsed.status as string
          const stage = next.find(s => s.id === op)
          if (stage) {
            if (status === 'running') {
              stage.status = 'running'
              stage.startTime = parsed.startTime as number
              stage.endTime = undefined
              stage.events = []
            } else {
              stage.status = status === 'success' ? 'success' : 'failed'
              stage.endTime = parsed.endTime as number
            }
          }
          return next
        }

        // Granular lifecycle events go into the detail log
        let stageId: string | null = null
        if (channel === 'build') stageId = 'build'
        else if (channel === 'setup') stageId = 'setup'
        else if (channel === 'test') stageId = 'run'
        else if (channel === 'clean') stageId = 'clean'

        if (stageId) {
          const stage = next.find(s => s.id === stageId)
          if (stage) {
            const type = parsed.type as string ?? eventName
            const msg = parsed.line ?? parsed.name ?? parsed.summary ?? parsed.error ?? type
            stage.events.push({
              type,
              message: String(msg),
              timestamp: Date.now(),
            })
            if (stage.events.length > 500) stage.events = stage.events.slice(-500)
          }
        }

        return next
      })
    }

    // Subscribe to all channels
    for (const ch of ['build', 'setup', 'test', 'clean', 'activity', 'container']) {
      es.addEventListener(`${ch}:activity_start`, (e) => handleEvent('activity', 'activity_start', JSON.parse(e.data)))
      es.addEventListener(`${ch}:activity_update`, (e) => handleEvent('activity', 'activity_update', JSON.parse(e.data)))
    }

    // Specific channel events
    const channels = ['build', 'setup', 'test', 'clean', 'container']
    for (const ch of channels) {
      // Use onmessage pattern for untyped events, or listen to specific sub-events
      const eventTypes: Record<string, string[]> = {
        build: ['build_start', 'build_log', 'build_end'],
        setup: ['setup_start', 'network_created', 'mock_starting', 'mock_started', 'service_starting', 'service_healthy', 'setup_end'],
        test: ['suite_start', 'case_start', 'case_pass', 'case_fail', 'case_skip', 'suite_end'],
        clean: ['clean_start', 'container_removing', 'container_removed', 'mock_stopped', 'network_removed', 'clean_end'],
        container: ['container_start', 'container_healthy', 'container_stop'],
      }
      for (const et of eventTypes[ch] ?? []) {
        es.addEventListener(`${ch}:${et}`, (e) => handleEvent(ch, et, JSON.parse(e.data)))
      }
    }

    // Activity-specific events
    es.addEventListener('activity:activity_start', (e) => handleEvent('activity', 'activity_start', JSON.parse(e.data)))
    es.addEventListener('activity:activity_update', (e) => handleEvent('activity', 'activity_update', JSON.parse(e.data)))

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => { es.close() }
  }, [])

  const selected = stages.find(s => s.id === selectedStage)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">流水线视图</h2>
          <p className="text-sm text-gray-500 mt-1">实时查看 init → build → setup → run → clean 执行过程</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? '实时连接' : '未连接'}</span>
        </div>
      </div>

      {/* Pipeline stages */}
      <div className="flex items-center justify-center gap-0 mb-8">
        {stages.map((stage, idx) => {
          const colors = STATUS_COLORS[stage.status]
          return (
            <div key={stage.id} className="flex items-center">
              <button
                onClick={() => setSelectedStage(stage.id === selectedStage ? null : stage.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all cursor-pointer
                  ${selectedStage === stage.id ? 'ring-2 ring-offset-2 shadow-lg' : 'hover:shadow-md'}
                  ${colors.ring} ${colors.bg}
                `}
                style={{ minWidth: 120 }}
              >
                <span className={`text-2xl ${stage.status === 'running' ? 'animate-spin' : ''}`}>
                  {stage.status === 'running' ? '⟳' : colors.icon}
                </span>
                <span className="text-sm font-medium text-gray-700">{stage.label}</span>
                <span className="text-xs text-gray-500">
                  {formatDuration(stage.startTime, stage.endTime)}
                </span>
                {stage.events.length > 0 && (
                  <span className="text-xs text-gray-400">{stage.events.length} events</span>
                )}
              </button>
              {idx < stages.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 ${
                  stages[idx + 1].status !== 'idle' ? 'bg-blue-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Stage detail */}
      {selected && (
        <div className="bg-white rounded-xl border shadow-sm">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-medium text-gray-900">{selected.label} - 事件日志</h3>
            <span className="text-xs text-gray-400">{selected.events.length} 条</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {selected.events.length === 0 ? (
              <div className="p-8 text-center text-gray-400">暂无事件</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {selected.events.map((evt, i) => (
                  <div key={i} className="px-4 py-2 text-sm flex items-start gap-3 hover:bg-gray-50">
                    <span className="text-xs text-gray-400 shrink-0 font-mono pt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0 font-mono">
                      {evt.type}
                    </span>
                    <span className="text-gray-700 break-all">{evt.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedStage && (
        <div className="text-center py-8 text-gray-400 text-sm">
          点击上方任意阶段查看详细事件日志
        </div>
      )}
    </div>
  )
}
