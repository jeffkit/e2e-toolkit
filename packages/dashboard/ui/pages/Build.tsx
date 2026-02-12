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

export function BuildPage() {
  const [imageName, setImageName] = useState('')
  const [noCache, setNoCache] = useState(false)
  const [buildStatus, setBuildStatus] = useState<BuildStatus>({ status: 'idle', logs: [] })
  const [images, setImages] = useState<unknown[]>([])
  const [versionInfo, setVersionInfo] = useState<{ version?: string; projectName?: string }>({})

  // Dynamic branch info: { repoName: BranchInfo }
  const [branchInfo, setBranchInfo] = useState<Record<string, BranchInfo>>({})
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({})
  const logRef = useRef<HTMLDivElement>(null)

  // 获取默认镜像名和分支信息
  useEffect(() => {
    docker.getDefaultImage().then(data => {
      if (data.imageName && !imageName) setImageName(data.imageName)
      setVersionInfo({ version: data.version, projectName: data.projectName })
    }).catch(() => {
      if (!imageName) setImageName('e2e-service:latest')
    })

    docker.getBranches().then(data => {
      setBranchInfo(data)
      // Initialize branch selections to current branches
      const selections: Record<string, string> = {}
      for (const [repoName, info] of Object.entries(data)) {
        if (info.current) selections[repoName] = info.current
      }
      setBranchSelections(selections)
    }).catch(() => {})
  }, [])

  // 加载镜像列表
  useEffect(() => {
    docker.getImages().then(res => {
      if (res.success && res.images) setImages(res.images)
    })
  }, [buildStatus.status])

  // SSE 监听构建日志
  useEffect(() => {
    if (buildStatus.status !== 'building') return

    const eventSource = new EventSource('/api/docker/events')

    eventSource.addEventListener('build-state', (e) => {
      const state = JSON.parse(e.data)
      setBuildStatus(state)
    })

    eventSource.addEventListener('build-log', (e) => {
      const { line } = JSON.parse(e.data)
      setBuildStatus(prev => ({
        ...prev,
        logs: [...prev.logs, line],
      }))
    })

    return () => eventSource.close()
  }, [buildStatus.status === 'building'])

  // 自动滚动日志
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [buildStatus.logs.length])

  const handleBuild = async () => {
    setBuildStatus({ status: 'building', logs: [] })
    await docker.build({
      imageName,
      noCache,
      branches: branchSelections,
    })
  }

  const duration = buildStatus.startTime
    ? ((buildStatus.endTime || Date.now()) - buildStatus.startTime) / 1000
    : 0

  const repoEntries = Object.entries(branchInfo)

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">镜像构建</h2>
        {versionInfo.version && (
          <span className="text-sm text-gray-500">
            当前版本: <span className="font-mono font-medium text-gray-700">v{versionInfo.version}</span>
          </span>
        )}
      </div>

      {/* 构建参数 */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        {/* 分支选择 - 从配置动态生成 */}
        {repoEntries.length > 0 && (
          <div className="flex gap-4 mb-3">
            {repoEntries.map(([repoName, info]) => (
              <div key={repoName} className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {repoName} 分支
                  {info.commit && (
                    <span className="ml-2 font-mono text-gray-400">@ {info.commit}</span>
                  )}
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

        {/* 镜像名称和构建按钮 */}
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
            <input
              type="checkbox"
              checked={noCache}
              onChange={e => setNoCache(e.target.checked)}
              className="rounded"
            />
            No Cache
          </label>
          <button
            onClick={handleBuild}
            disabled={buildStatus.status === 'building'}
            className={`px-6 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
              buildStatus.status === 'building'
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {buildStatus.status === 'building' ? '构建中...' : '开始构建'}
          </button>
        </div>

        {/* 构建状态 */}
        {buildStatus.status !== 'idle' && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              buildStatus.status === 'building' ? 'bg-yellow-100 text-yellow-800' :
              buildStatus.status === 'success' ? 'bg-green-100 text-green-800' :
              'bg-red-100 text-red-800'
            }`}>
              {buildStatus.status === 'building' && '构建中'}
              {buildStatus.status === 'success' && '构建成功'}
              {buildStatus.status === 'error' && '构建失败'}
            </span>
            <span className="text-gray-500">耗时: {duration.toFixed(1)}s</span>
            {buildStatus.error && (
              <span className="text-red-600">{buildStatus.error}</span>
            )}
          </div>
        )}
      </div>

      {/* 构建日志 */}
      <div className="flex-1 min-h-0 bg-gray-900 rounded-lg shadow-sm overflow-hidden flex flex-col">
        <div className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-mono flex justify-between">
          <span>构建日志</span>
          <span>{buildStatus.logs.length} 行</span>
        </div>
        <div ref={logRef} className="flex-1 overflow-auto p-4 font-mono text-xs text-green-400 whitespace-pre-wrap">
          {buildStatus.logs.length === 0 ? (
            <span className="text-gray-600">等待构建开始...</span>
          ) : (
            buildStatus.logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))
          )}
        </div>
      </div>

      {/* 镜像列表 */}
      {images.length > 0 && (
        <div className="mt-4 bg-white rounded-lg shadow-sm border p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">本地镜像</h3>
          <div className="overflow-auto max-h-40">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-1">Repository</th>
                  <th className="pb-1">Tag</th>
                  <th className="pb-1">ID</th>
                  <th className="pb-1">Size</th>
                  <th className="pb-1">Created</th>
                </tr>
              </thead>
              <tbody>
                {images.map((img: any, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 font-medium">{img.Repository}</td>
                    <td className="py-1">{img.Tag}</td>
                    <td className="py-1 font-mono text-gray-500">{img.ID?.slice(0, 12)}</td>
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
  )
}
