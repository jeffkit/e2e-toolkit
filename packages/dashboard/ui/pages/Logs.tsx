import { useState, useEffect, useRef } from 'react'
import { docker } from '../lib/api'

export function LogsPage() {
  const [status, setStatus] = useState<string>('unknown')
  const [logs, setLogs] = useState('')
  const [logLines, setLogLines] = useState(100)
  const [streaming, setStreaming] = useState(false)
  const [streamLogs, setStreamLogs] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // 获取容器状态
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await docker.getStatus()
        setStatus(res.status)
      } catch {
        setStatus('error')
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchLogs = async () => {
    const res = await docker.getLogs(logLines)
    if (res.success && res.logs) setLogs(res.logs)
  }

  const startLogStream = () => {
    stopLogStream()
    setStreamLogs([])
    setStreaming(true)
    const es = new EventSource(`/api/docker/logs/stream?lines=${logLines}`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        setStreamLogs(prev => {
          const next = [...prev, data.line]
          return next.length > 5000 ? next.slice(-5000) : next
        })
      } catch { /* ignore */ }
    }

    es.addEventListener('close', () => {
      setStreaming(false)
      es.close()
    })

    es.onerror = () => {
      setStreaming(false)
      es.close()
    }
  }

  const stopLogStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setStreaming(false)
  }

  // 自动滚动到底部
  useEffect(() => {
    if (logRef.current && streaming && autoScroll) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [streamLogs, streaming, autoScroll])

  // 组件卸载时关闭流
  useEffect(() => {
    return () => stopLogStream()
  }, [])

  const isRunning = status === 'running'

  // 过滤日志
  const filteredStreamLogs = filter
    ? streamLogs.filter(line => line.toLowerCase().includes(filter.toLowerCase()))
    : streamLogs

  const filteredStaticLogs = filter && logs
    ? logs.split('\n').filter(line => line.toLowerCase().includes(filter.toLowerCase())).join('\n')
    : logs

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-800">容器日志</h2>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            status === 'running' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
          }`}>
            {status}
          </span>
          {streaming && (
            <span className="inline-flex items-center gap-1 text-green-600 text-sm">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              实时流
            </span>
          )}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white rounded-lg shadow-sm border p-3 mb-4 flex items-center gap-3 flex-wrap">
        {/* 流控制 */}
        {streaming ? (
          <button
            onClick={stopLogStream}
            className="px-4 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors"
          >
            停止实时
          </button>
        ) : (
          <button
            onClick={startLogStream}
            disabled={!isRunning}
            className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            实时日志
          </button>
        )}

        <button
          onClick={fetchLogs}
          disabled={streaming || !isRunning}
          className="px-4 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          加载快照
        </button>

        <div className="h-6 w-px bg-gray-300" />

        {/* 行数选择 */}
        <label className="text-xs text-gray-500">行数:</label>
        <select
          value={logLines}
          onChange={e => setLogLines(Number(e.target.value))}
          className="text-xs border rounded px-2 py-1"
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={3000}>3000</option>
        </select>

        <div className="h-6 w-px bg-gray-300" />

        {/* 过滤器 */}
        <label className="text-xs text-gray-500">过滤:</label>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="输入关键词过滤日志..."
          className="text-xs border rounded px-2 py-1 w-48 font-mono"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            清除
          </button>
        )}

        <div className="h-6 w-px bg-gray-300" />

        {/* 自动滚动 */}
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          自动滚动
        </label>

        {/* 右侧统计 */}
        <div className="flex-1" />
        <span className="text-xs text-gray-400">
          {streaming
            ? `${filteredStreamLogs.length} 行${filter ? ` (已过滤，共 ${streamLogs.length})` : ''}`
            : logs ? `${filteredStaticLogs.split('\n').length} 行${filter ? ' (已过滤)' : ''}` : ''}
        </span>
      </div>

      {/* 日志区域 */}
      <div
        ref={logRef}
        className="flex-1 min-h-0 bg-gray-900 rounded-lg overflow-auto p-4 font-mono text-xs text-gray-300 whitespace-pre-wrap"
      >
        {streaming ? (
          filteredStreamLogs.length > 0
            ? filteredStreamLogs.map((line, i) => (
                <div key={i} className="hover:bg-gray-800 leading-5">{line}</div>
              ))
            : <span className="text-gray-600">等待日志...</span>
        ) : (
          filteredStaticLogs || (
            <span className="text-gray-600">
              {isRunning
                ? '点击"实时日志"开始监控，或"加载快照"查看历史日志'
                : '容器未运行，请先在"容器管理"页面启动容器'}
            </span>
          )
        )}
      </div>
    </div>
  )
}
