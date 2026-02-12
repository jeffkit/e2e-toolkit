import { useState, useEffect } from 'react'
import { docker, config as configApi } from '../lib/api'

export function ContainerPage() {
  const [status, setStatus] = useState<{
    status: string;
    containers?: any[];
    containerId?: string;
  }>({ status: 'unknown' })
  const [useMockGateway, setUseMockGateway] = useState(true)
  const [loading, setLoading] = useState<string | null>(null)
  const [showEnv, setShowEnv] = useState(false)
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState('')

  // Load env defaults from config
  useEffect(() => {
    configApi.get().then(res => {
      // Try to load envDefaults from dashboard config, fallback to container environment
      const dashboard = (res as any).dashboard
      if (dashboard?.envDefaults) {
        setEnvVars(dashboard.envDefaults)
      } else {
        const env = (res as any).service?.container?.environment
        if (env && typeof env === 'object') {
          setEnvVars(env as Record<string, string>)
        }
      }
    }).catch(() => {})
  }, [])

  const fetchStatus = async () => {
    try {
      const res = await docker.getStatus()
      setStatus(res)
    } catch {
      setStatus({ status: 'error' })
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleStart = async () => {
    setLoading('starting')
    setErrorMsg('')
    try {
      const res = await docker.start({ useMockGateway, envOverrides: envVars })
      if (!res.success && res.error) {
        setErrorMsg(res.error)
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Start failed')
    }
    await fetchStatus()
    setLoading(null)
  }

  const updateEnv = (key: string, value: string) => {
    setEnvVars(prev => ({ ...prev, [key]: value }))
  }

  const handleStop = async () => {
    setLoading('stopping')
    await docker.stop()
    await fetchStatus()
    setLoading(null)
  }

  const statusColor: Record<string, string> = {
    running: 'bg-green-100 text-green-800',
    stopped: 'bg-gray-100 text-gray-800',
    starting: 'bg-yellow-100 text-yellow-800',
    stopping: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    unknown: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <h2 className="text-xl font-bold text-gray-800 mb-4">容器管理</h2>

      {/* 容器控制 */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              statusColor[status.status] || statusColor.unknown
            }`}>
              {status.status}
            </span>
            {status.containerId && (
              <span className="text-xs font-mono text-gray-500">
                ID: {status.containerId.slice(0, 12)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={useMockGateway}
                onChange={e => setUseMockGateway(e.target.checked)}
                className="rounded"
              />
              Mock Gateway
            </label>

            <button
              onClick={handleStart}
              disabled={loading !== null || status.status === 'running'}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading === 'starting' ? '启动中...' : '启动容器'}
            </button>

            <button
              onClick={handleStop}
              disabled={loading !== null || status.status === 'stopped'}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading === 'stopping' ? '停止中...' : '停止容器'}
            </button>

            <button
              onClick={fetchStatus}
              className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition-colors"
            >
              刷新
            </button>
          </div>
        </div>

        {/* 错误信息 */}
        {(errorMsg || status.status === 'error') && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-3">
            <p className="text-sm text-red-700 font-medium">启动失败</p>
            <p className="text-xs text-red-600 font-mono mt-1 whitespace-pre-wrap">
              {errorMsg || '未知错误，请查看日志'}
            </p>
          </div>
        )}

        {/* 环境变量配置 */}
        <div className="border-t pt-3">
          <button
            onClick={() => setShowEnv(!showEnv)}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <span>{showEnv ? '▼' : '▶'}</span>
            环境变量配置 ({Object.keys(envVars).length} 项)
          </button>
          {showEnv && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {Object.entries(envVars).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-56 shrink-0 truncate font-mono" title={key}>
                    {key}
                  </label>
                  <input
                    type={key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('password') ? 'password' : 'text'}
                    value={value}
                    onChange={e => updateEnv(key, e.target.value)}
                    className="flex-1 text-xs border rounded px-2 py-1 font-mono"
                    placeholder={key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') ? '(sensitive)' : ''}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 容器详情 */}
        {status.containers && status.containers.length > 0 && (
          <div className="border-t pt-3 mt-3">
            <h3 className="text-sm font-medium text-gray-700 mb-2">运行中的服务</h3>
            <div className="grid gap-2">
              {status.containers.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      c.State === 'running' ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                    <span className="font-medium">{c.Service || c.Names}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{c.State}</span>
                    <span>{c.Status}</span>
                    <span className="font-mono">{c.Ports}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 容器内部信息 */}
      {status.status === 'running' && <ContainerInspector />}
    </div>
  )
}

// ==================== 容器内部信息组件 ====================

interface Process {
  user: string;
  pid: string;
  cpu: string;
  mem: string;
  stat: string;
  time: string;
  command: string;
}

interface DirEntry {
  permissions: string;
  links: string;
  owner: string;
  group: string;
  size: string;
  date: string;
  name: string;
}

interface DirInfo {
  path: string;
  exists: boolean;
  entries?: DirEntry[];
  error?: string;
}

function ContainerInspector() {
  const [tab, setTab] = useState<'processes' | 'dirs' | 'exec'>('processes')
  const [processes, setProcesses] = useState<Process[]>([])
  const [dirs, setDirs] = useState<DirInfo[]>([])
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [customDir, setCustomDir] = useState('')
  const [loadingPs, setLoadingPs] = useState(false)
  const [loadingDirs, setLoadingDirs] = useState(false)
  // Exec tab state
  const [execCommand, setExecCommand] = useState('')
  const [execOutput, setExecOutput] = useState('')
  const [execRunning, setExecRunning] = useState(false)

  const fetchProcesses = async () => {
    setLoadingPs(true)
    try {
      const res = await docker.getProcesses()
      if (res.success && res.processes) setProcesses(res.processes as Process[])
    } catch { /* ignore */ }
    setLoadingPs(false)
  }

  const fetchDirs = async (path?: string) => {
    setLoadingDirs(true)
    try {
      const res = await docker.getDirs(path)
      if (res.success && res.directories) setDirs(res.directories as DirInfo[])
    } catch { /* ignore */ }
    setLoadingDirs(false)
  }

  const handleBrowseDir = (path: string) => {
    setSelectedDir(path)
    fetchDirs(path)
  }

  const handleExec = async () => {
    if (!execCommand.trim()) return
    setExecRunning(true)
    try {
      const res = await docker.exec(execCommand)
      setExecOutput(res.output || res.error || '(no output)')
    } catch (err: any) {
      setExecOutput(`Error: ${err.message}`)
    }
    setExecRunning(false)
  }

  useEffect(() => {
    if (tab === 'processes') fetchProcesses()
    else if (tab === 'dirs') fetchDirs()
  }, [tab])

  return (
    <div className="bg-white rounded-lg shadow-sm border mb-4 overflow-hidden">
      {/* Tab 切换 */}
      <div className="flex items-center border-b bg-gray-50">
        {(['processes', 'dirs', 'exec'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-blue-700 border-b-2 border-blue-600 bg-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'processes' ? '进程列表' : t === 'dirs' ? '目录权限' : '命令执行'}
          </button>
        ))}
        <div className="flex-1" />
        {tab !== 'exec' && (
          <button
            onClick={() => tab === 'processes' ? fetchProcesses() : fetchDirs(selectedDir || undefined)}
            className="text-xs px-3 py-1 mr-2 text-gray-500 hover:text-gray-700"
          >
            {loadingPs || loadingDirs ? '加载中...' : '刷新'}
          </button>
        )}
      </div>

      {/* 进程列表 */}
      {tab === 'processes' && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">USER</th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">PID</th>
                <th className="text-right px-3 py-1.5 font-medium text-gray-600">CPU%</th>
                <th className="text-right px-3 py-1.5 font-medium text-gray-600">MEM%</th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">STAT</th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">TIME</th>
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">COMMAND</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p, i) => (
                <tr key={i} className="border-t hover:bg-blue-50 transition-colors">
                  <td className="px-3 py-1 font-mono">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                      p.user === 'root' ? 'bg-red-50 text-red-700'
                        : p.user === 'agentstudio' ? 'bg-blue-50 text-blue-700'
                        : 'bg-gray-50 text-gray-700'
                    }`}>
                      {p.user}
                    </span>
                  </td>
                  <td className="px-3 py-1 font-mono text-gray-500">{p.pid}</td>
                  <td className="px-3 py-1 font-mono text-right">
                    <span className={parseFloat(p.cpu) > 10 ? 'text-orange-600 font-bold' : 'text-gray-600'}>
                      {p.cpu}
                    </span>
                  </td>
                  <td className="px-3 py-1 font-mono text-right text-gray-600">{p.mem}</td>
                  <td className="px-3 py-1 font-mono text-gray-500">{p.stat}</td>
                  <td className="px-3 py-1 font-mono text-gray-500">{p.time}</td>
                  <td className="px-3 py-1 font-mono text-gray-800 truncate max-w-md" title={p.command}>
                    {p.command}
                  </td>
                </tr>
              ))}
              {processes.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-gray-400">
                    {loadingPs ? '加载中...' : '无进程数据'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 目录权限 */}
      {tab === 'dirs' && (
        <div className="max-h-72 overflow-auto">
          {/* 自定义路径输入 */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
            <span className="text-xs text-gray-500">浏览路径:</span>
            <input
              type="text"
              value={customDir}
              onChange={e => setCustomDir(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customDir) handleBrowseDir(customDir) }}
              placeholder="/workspace"
              className="flex-1 text-xs border rounded px-2 py-1 font-mono"
            />
            <button
              onClick={() => customDir && handleBrowseDir(customDir)}
              className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            >
              查看
            </button>
            <button
              onClick={() => { setSelectedDir(null); fetchDirs() }}
              className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
            >
              重置
            </button>
          </div>

          {dirs.map((dir) => (
            <div key={dir.path} className="border-b last:border-0">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50">
                <span className="font-mono text-xs font-bold text-gray-700">{dir.path}</span>
                {!dir.exists && <span className="text-xs text-red-500">(不存在)</span>}
              </div>
              {dir.entries && dir.entries.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left px-3 py-1 font-medium">权限</th>
                      <th className="text-left px-3 py-1 font-medium">所有者</th>
                      <th className="text-left px-3 py-1 font-medium">组</th>
                      <th className="text-right px-3 py-1 font-medium">大小</th>
                      <th className="text-left px-3 py-1 font-medium">名称</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dir.entries.map((entry, i) => (
                      <tr key={i} className="hover:bg-blue-50 transition-colors">
                        <td className="px-3 py-0.5 font-mono">
                          <span className={
                            entry.permissions.startsWith('d') ? 'text-blue-600'
                              : entry.permissions.startsWith('l') ? 'text-purple-600'
                              : entry.permissions.includes('x') ? 'text-green-600'
                              : 'text-gray-600'
                          }>
                            {entry.permissions}
                          </span>
                        </td>
                        <td className="px-3 py-0.5 font-mono">
                          <span className={entry.owner === 'root' ? 'text-red-600' : 'text-blue-600'}>
                            {entry.owner}
                          </span>
                        </td>
                        <td className="px-3 py-0.5 font-mono text-gray-500">{entry.group}</td>
                        <td className="px-3 py-0.5 font-mono text-right text-gray-500">{entry.size}</td>
                        <td className="px-3 py-0.5 font-mono text-gray-800">
                          {entry.permissions.startsWith('d') && entry.name !== '.' && entry.name !== '..' ? (
                            <button
                              onClick={() => handleBrowseDir(`${dir.path}/${entry.name}`.replace('//', '/'))}
                              className="text-blue-600 hover:underline"
                            >
                              {entry.name}/
                            </button>
                          ) : (
                            entry.name
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {dir.error && (
                <div className="px-3 py-2 text-xs text-red-500 font-mono">{dir.error}</div>
              )}
            </div>
          ))}
          {dirs.length === 0 && (
            <div className="text-center py-4 text-xs text-gray-400">
              {loadingDirs ? '加载中...' : '无目录数据'}
            </div>
          )}
        </div>
      )}

      {/* 命令执行 (新版改进) */}
      {tab === 'exec' && (
        <div className="p-4">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={execCommand}
              onChange={e => setExecCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleExec() }}
              placeholder="输入要在容器内执行的命令..."
              className="flex-1 text-sm border rounded px-3 py-2 font-mono focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleExec}
              disabled={execRunning || !execCommand.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {execRunning ? '执行中...' : '执行'}
            </button>
          </div>
          {execOutput && (
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-gray-300 whitespace-pre-wrap max-h-60 overflow-auto">
              {execOutput}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
