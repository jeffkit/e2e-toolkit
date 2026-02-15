import { useState, useEffect, useRef } from 'react'
import { docker } from '../lib/api'

interface BuildStatus {
  status: 'idle' | 'building' | 'success' | 'error';
  logs: string[];
  startTime?: number;
  endTime?: number;
  error?: string;
  imageName?: string;
}

interface BranchInfo {
  branches: string[];
  current: string;
  commit: string;
}

interface PipelineStage {
  id: string;
  name: string;
  status: string;
  startTime?: number;
  endTime?: number;
  error?: string;
  logs: string[];
}

interface BuildHistoryEntry {
  id: string;
  imageName: string;
  status: 'success' | 'error';
  startTime: number;
  endTime: number;
  duration: number;
  branches?: Record<string, string>;
  error?: string;
}

type TabMode = 'pipeline' | 'build';

export function BuildPage() {
  const [tabMode, setTabMode] = useState<TabMode>('pipeline')
  const [imageName, setImageName] = useState('')
  const [noCache, setNoCache] = useState(false)
  const [buildStatus, setBuildStatus] = useState<BuildStatus>({ status: 'idle', logs: [] })
  const [images, setImages] = useState<unknown[]>([])
  const [versionInfo, setVersionInfo] = useState<{ version?: string; projectName?: string }>({})
  const [branchInfo, setBranchInfo] = useState<Record<string, BranchInfo>>({})
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({})
  const [buildHistory, setBuildHistory] = useState<BuildHistoryEntry[]>([])

  // Pipeline state
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])
  const [pipelineStatus, setPipelineStatus] = useState<string>('idle')
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [skipBuild, setSkipBuild] = useState(false)
  const [skipTests, setSkipTests] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)

  const logRef = useRef<HTMLDivElement>(null)

  // Load defaults
  useEffect(() => {
    docker.getDefaultImage().then(data => {
      if (data.imageName && !imageName) setImageName(data.imageName)
      setVersionInfo({ version: data.version, projectName: data.projectName })
    }).catch(() => { if (!imageName) setImageName('e2e-service:latest') })

    docker.getBranches().then(data => {
      setBranchInfo(data)
      const selections: Record<string, string> = {}
      for (const [repoName, info] of Object.entries(data)) {
        if (info.current) selections[repoName] = info.current
      }
      setBranchSelections(selections)
    }).catch(() => {})

    docker.getBuildHistory().then(data => setBuildHistory(data.builds)).catch(() => {})
  }, [])

  // Load images
  useEffect(() => {
    docker.getImages().then(res => {
      if (res.success && res.images) setImages(res.images)
    })
  }, [buildStatus.status, pipelineStatus])

  // SSE for build & pipeline logs
  useEffect(() => {
    const eventSource = new EventSource('/api/docker/events')

    eventSource.addEventListener('build-state', (e) => {
      const state = JSON.parse(e.data)
      setBuildStatus(state)
    })
    eventSource.addEventListener('build-log', (e) => {
      const { line } = JSON.parse(e.data)
      setBuildStatus(prev => ({ ...prev, logs: [...prev.logs, line] }))
    })
    eventSource.addEventListener('pipeline-state', (e) => {
      const state = JSON.parse(e.data)
      setPipelineStages(state.stages || [])
      setPipelineStatus(state.status || 'idle')
      if (state.status !== 'running') {
        setPipelineRunning(false)
        docker.getBuildHistory().then(data => setBuildHistory(data.builds)).catch(() => {})
      }
    })
    eventSource.addEventListener('pipeline-log', (e) => {
      const { stage, line } = JSON.parse(e.data)
      setPipelineStages(prev =>
        prev.map(s => s.id === stage ? { ...s, logs: [...s.logs, line] } : s)
      )
    })

    return () => eventSource.close()
  }, [])

  // Pipeline state polling fallback (in case SSE misses events)
  useEffect(() => {
    if (!pipelineRunning) return
    const interval = setInterval(() => {
      docker.getPipelineState().then(state => {
        setPipelineStages(state.stages || [])
        setPipelineStatus(state.status || 'idle')
        if (state.status !== 'running') {
          setPipelineRunning(false)
          docker.getBuildHistory().then(data => setBuildHistory(data.builds)).catch(() => {})
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [pipelineRunning])

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [buildStatus.logs.length, pipelineStages])

  const handleBuild = async () => {
    setBuildStatus({ status: 'building', logs: [] })
    try {
      await docker.build({ imageName, noCache, branches: branchSelections })
    } catch (err) {
      setBuildStatus(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        endTime: Date.now(),
      }))
    }
  }

  const handlePipeline = async () => {
    setPipelineRunning(true)
    setPipelineStatus('running')
    setPipelineStages([]) // Reset stages
    setSelectedStage(null)
    try {
      const res = await docker.runPipeline({
        imageName,
        noCache,
        branches: branchSelections,
        skipBuild,
        skipTests,
      })
      if (!res.success) {
        setPipelineRunning(false)
        setPipelineStatus('error')
      }
    } catch (err) {
      setPipelineRunning(false)
      setPipelineStatus('error')
    }
  }

  const duration = buildStatus.startTime
    ? ((buildStatus.endTime || Date.now()) - buildStatus.startTime) / 1000
    : 0

  const repoEntries = Object.entries(branchInfo)

  const stageIcon = (status: string) => {
    switch (status) {
      case 'success': return '✓'
      case 'error': return '✗'
      case 'running': return '⟳'
      case 'skipped': return '⊘'
      default: return '○'
    }
  }

  const stageColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-500 text-white'
      case 'error': return 'bg-red-500 text-white'
      case 'running': return 'bg-blue-500 text-white animate-pulse'
      case 'skipped': return 'bg-gray-300 text-gray-600'
      default: return 'bg-gray-200 text-gray-500'
    }
  }

  const stageLineColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-400'
      case 'error': return 'bg-red-400'
      case 'running': return 'bg-blue-400 animate-pulse'
      default: return 'bg-gray-200'
    }
  }

  const selectedStageLogs = selectedStage
    ? pipelineStages.find(s => s.id === selectedStage)?.logs || []
    : []

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-800">构建流水线</h2>
          <div className="flex bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setTabMode('pipeline')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                tabMode === 'pipeline' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              流水线
            </button>
            <button
              onClick={() => setTabMode('build')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                tabMode === 'build' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              单步构建
            </button>
          </div>
        </div>
        {versionInfo.version && (
          <span className="text-sm text-gray-500">
            v<span className="font-mono font-medium text-gray-700">{versionInfo.version}</span>
          </span>
        )}
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        {repoEntries.length > 0 && (
          <div className="flex gap-4 mb-3">
            {repoEntries.map(([repoName, info]) => (
              <div key={repoName} className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {repoName}
                  {info.commit && <span className="ml-2 font-mono text-gray-400">@ {info.commit}</span>}
                </label>
                <select
                  value={branchSelections[repoName] || info.current}
                  onChange={e => setBranchSelections(prev => ({ ...prev, [repoName]: e.target.value }))}
                  className="w-full px-3 py-1.5 border rounded-md text-sm bg-white"
                >
                  {(info.branches.length > 0 ? info.branches : ['main']).map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">镜像名称</label>
            <input
              type="text"
              value={imageName}
              onChange={e => setImageName(e.target.value)}
              className="w-full px-3 py-1.5 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e2e-service:latest"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-1">
            <input type="checkbox" checked={noCache} onChange={e => setNoCache(e.target.checked)} className="rounded" />
            No Cache
          </label>

          {tabMode === 'pipeline' ? (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-600 pb-1">
                <input type="checkbox" checked={skipBuild} onChange={e => setSkipBuild(e.target.checked)} className="rounded" />
                跳过构建
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 pb-1">
                <input type="checkbox" checked={skipTests} onChange={e => setSkipTests(e.target.checked)} className="rounded" />
                跳过测试
              </label>
              <button
                onClick={handlePipeline}
                disabled={pipelineRunning || buildStatus.status === 'building'}
                className={`px-6 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
                  pipelineRunning ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                }`}
              >
                {pipelineRunning ? '流水线运行中...' : '一键执行'}
              </button>
            </>
          ) : (
            <button
              onClick={handleBuild}
              disabled={buildStatus.status === 'building' || pipelineRunning}
              className={`px-6 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
                buildStatus.status === 'building' ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {buildStatus.status === 'building' ? '构建中...' : '开始构建'}
            </button>
          )}
        </div>
      </div>

      {tabMode === 'pipeline' ? (
        <>
          {/* Pipeline Stages Visualization */}
          {pipelineStages.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700">流水线阶段</h3>
                {pipelineStatus !== 'idle' && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    pipelineStatus === 'success' ? 'bg-green-100 text-green-700' :
                    pipelineStatus === 'error' ? 'bg-red-100 text-red-700' :
                    pipelineStatus === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {pipelineStatus === 'running' ? '运行中' : pipelineStatus === 'success' ? '成功' : pipelineStatus === 'error' ? '失败' : pipelineStatus}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0">
                {pipelineStages.map((stage, i) => (
                  <div key={stage.id} className="flex items-center flex-1">
                    <button
                      onClick={() => setSelectedStage(stage.id === selectedStage ? null : stage.id)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all flex-1 ${
                        selectedStage === stage.id ? 'bg-blue-50 ring-2 ring-blue-300' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${stageColor(stage.status)}`}>
                        {stageIcon(stage.status)}
                      </div>
                      <span className="text-xs font-medium text-gray-700">{stage.name}</span>
                      {stage.startTime && stage.endTime && (
                        <span className="text-[10px] text-gray-400">{formatDuration(stage.endTime - stage.startTime)}</span>
                      )}
                      {stage.error && (
                        <span className="text-[10px] text-red-500 truncate max-w-24">{stage.error}</span>
                      )}
                    </button>
                    {i < pipelineStages.length - 1 && (
                      <div className={`h-0.5 w-8 shrink-0 ${stageLineColor(stage.status)}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage Logs */}
          <div className="flex-1 min-h-0 bg-gray-900 rounded-lg shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-mono flex justify-between">
              <span>
                {selectedStage
                  ? `${pipelineStages.find(s => s.id === selectedStage)?.name || selectedStage} 日志`
                  : '流水线日志'}
              </span>
              <span>{selectedStageLogs.length} 行</span>
            </div>
            <div ref={logRef} className="flex-1 overflow-auto p-4 font-mono text-xs text-green-400 whitespace-pre-wrap">
              {selectedStage && selectedStageLogs.length > 0 ? (
                selectedStageLogs.map((line, i) => <div key={i}>{line}</div>)
              ) : pipelineStages.length === 0 ? (
                <span className="text-gray-600">点击「一键执行」启动完整流水线：Git 同步 → 镜像构建 → 容器部署 → 运行测试</span>
              ) : (
                <span className="text-gray-600">点击上方阶段图标查看对应日志</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Single Build Mode (original) */}
          {buildStatus.status !== 'idle' && (
            <div className="mb-4 flex items-center gap-3 text-sm">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                buildStatus.status === 'building' ? 'bg-yellow-100 text-yellow-800' :
                buildStatus.status === 'success' ? 'bg-green-100 text-green-800' :
                'bg-red-100 text-red-800'
              }`}>
                {buildStatus.status === 'building' ? '构建中' : buildStatus.status === 'success' ? '构建成功' : '构建失败'}
              </span>
              <span className="text-gray-500">耗时: {duration.toFixed(1)}s</span>
              {buildStatus.error && <span className="text-red-600">{buildStatus.error}</span>}
            </div>
          )}

          <div className="flex-1 min-h-0 bg-gray-900 rounded-lg shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-mono flex justify-between">
              <span>构建日志</span>
              <span>{buildStatus.logs.length} 行</span>
            </div>
            <div ref={logRef} className="flex-1 overflow-auto p-4 font-mono text-xs text-green-400 whitespace-pre-wrap">
              {buildStatus.logs.length === 0 ? (
                <span className="text-gray-600">等待构建开始...</span>
              ) : (
                buildStatus.logs.map((line, i) => <div key={i}>{line}</div>)
              )}
            </div>
          </div>
        </>
      )}

      {/* Build History + Images (collapsible) */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        {/* Build History */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">
            构建历史 ({buildHistory.length})
          </div>
          <div className="max-h-36 overflow-auto">
            {buildHistory.length === 0 ? (
              <div className="p-3 text-center text-xs text-gray-400">暂无构建记录</div>
            ) : (
              buildHistory.map(entry => (
                <div key={entry.id} className="flex items-center justify-between px-4 py-2 border-b last:border-0 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${entry.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium text-gray-700">{entry.imageName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-500">
                    <span>{formatDuration(entry.duration)}</span>
                    <span>{new Date(entry.startTime).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Images */}
        {images.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">
              本地镜像
            </div>
            <div className="max-h-36 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="px-4 py-1">Repository</th>
                    <th className="py-1">Tag</th>
                    <th className="py-1">Size</th>
                    <th className="py-1">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {images.map((img: any, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-1 font-medium">{img.Repository}</td>
                      <td className="py-1">{img.Tag}</td>
                      <td className="py-1">{img.Size}</td>
                      <td className="py-1 text-gray-500">{img.CreatedSince}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
