import { useState, useEffect } from 'react'
import { projects, type ProjectEntry } from '../lib/api'
import { ConfigEditor } from '../components/ConfigEditor'

interface Props {
  onProjectSwitch: () => void;
}

type ViewMode = 'list' | 'edit' | 'create'

export function ProjectsPage({ onProjectSwitch }: Props) {
  const [projectList, setProjectList] = useState<ProjectEntry[]>([])
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [editingProject, setEditingProject] = useState<string | null>(null)

  // Add project form
  const [addName, setAddName] = useState('')
  const [addPath, setAddPath] = useState('')
  const [addDesc, setAddDesc] = useState('')

  // Scan
  const [scanDir, setScanDir] = useState('')
  const [scanResults, setScanResults] = useState<Array<{ name: string; configPath: string; description?: string }>>([])
  const [scanning, setScanning] = useState(false)

  const refresh = async () => {
    try {
      const res = await projects.list()
      setProjectList(res.projects)
      setActiveProject(res.activeProject)
    } catch { /* ignore */ }
  }

  useEffect(() => { refresh() }, [])

  const handleActivate = async (name: string) => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await projects.activate(name)
      if (res.success) {
        setSuccess(`已切换到项目: ${name}`)
        await refresh()
        onProjectSwitch()
      } else {
        setError(res.error || '切换失败')
      }
    } catch (e: any) {
      setError(e.message || '切换失败')
    }
    setLoading(false)
  }

  const handleAdd = async () => {
    if (!addName || !addPath) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await projects.add(addName, addPath, addDesc)
      if (res.success) {
        setSuccess(`已添加项目: ${addName}`)
        setAddName('')
        setAddPath('')
        setAddDesc('')
        await refresh()
      } else {
        setError(res.error || '添加失败')
      }
    } catch (e: any) {
      setError(e.message || '添加失败')
    }
    setLoading(false)
  }

  const handleRemove = async (name: string) => {
    if (!confirm(`确定删除项目 "${name}" 吗？（仅从注册表移除，不删除文件）`)) return
    try {
      await projects.remove(name)
      setSuccess(`已移除项目: ${name}`)
      await refresh()
    } catch (e: any) {
      setError(e.message || '移除失败')
    }
  }

  const handleScan = async () => {
    if (!scanDir) return
    setScanning(true)
    setScanResults([])
    try {
      const res = await projects.scan(scanDir)
      if (res.success && res.found) {
        setScanResults(res.found)
        if (res.found.length === 0) {
          setSuccess('未在该目录下找到 e2e.yaml')
        }
      } else {
        setError(res.error || '扫描失败')
      }
    } catch (e: any) {
      setError(e.message || '扫描失败')
    }
    setScanning(false)
  }

  const handleAddFromScan = async (item: { name: string; configPath: string; description?: string }) => {
    try {
      const res = await projects.add(item.name, item.configPath, item.description)
      if (res.success) {
        setSuccess(`已添加项目: ${item.name}`)
        setScanResults(prev => prev.filter(r => r.configPath !== item.configPath))
        await refresh()
      } else {
        setError(res.error || '添加失败')
      }
    } catch (e: any) {
      setError(e.message || '添加失败')
    }
  }

  // ─── 编辑/创建视图 ──────────────────────────────────────────

  if (viewMode === 'edit' && editingProject) {
    return (
      <div className="p-6 h-full overflow-auto">
        <ConfigEditor
          projectName={editingProject}
          mode="edit"
          onSaved={() => { refresh(); onProjectSwitch() }}
          onCancel={() => { setViewMode('list'); setEditingProject(null) }}
        />
      </div>
    )
  }

  if (viewMode === 'create') {
    return (
      <div className="p-6 h-full overflow-auto">
        <ConfigEditor
          mode="create"
          onSaved={() => { refresh(); setViewMode('list') }}
          onCancel={() => setViewMode('list')}
        />
      </div>
    )
  }

  // ─── 列表视图 ──────────────────────────────────────────────

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">项目管理</h2>
        <button
          onClick={() => setViewMode('create')}
          className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
        >
          + 创建新项目
        </button>
      </div>

      {/* 提示信息 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3 mb-4 text-sm text-green-700">
          {success}
          <button onClick={() => setSuccess('')} className="ml-2 text-green-400 hover:text-green-600">✕</button>
        </div>
      )}

      {/* 已注册的项目列表 */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">已注册的项目 ({projectList.length})</h3>
          <button onClick={refresh} className="text-xs text-blue-600 hover:text-blue-700">刷新</button>
        </div>
        {projectList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 mb-3">暂无注册项目</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setViewMode('create')}
                className="text-xs px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors">
                可视化创建项目
              </button>
              <span className="text-xs text-gray-400 self-center">或</span>
              <span className="text-xs text-gray-500 self-center">在下方添加已有的 e2e.yaml</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {projectList.map(p => (
              <div
                key={p.name}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                  p.name === activeProject ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {p.name === activeProject && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{p.name}</span>
                      {p.name === activeProject && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">当前</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate" title={p.configPath}>
                      {p.configPath}
                    </div>
                    {p.description && (
                      <div className="text-xs text-gray-400 mt-0.5">{p.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => { setEditingProject(p.name); setViewMode('edit') }}
                    className="text-xs px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors"
                  >
                    编辑配置
                  </button>
                  {p.name !== activeProject && (
                    <button
                      onClick={() => handleActivate(p.name)}
                      disabled={loading}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                    >
                      切换
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(p.name)}
                    className="text-xs px-3 py-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 手动添加项目（已有 e2e.yaml） */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">导入已有项目（指定 e2e.yaml 路径）</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">项目名称</label>
            <input
              type="text"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="my-project"
              className="w-full text-sm border rounded px-3 py-1.5"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">e2e.yaml 绝对路径</label>
            <input
              type="text"
              value={addPath}
              onChange={e => setAddPath(e.target.value)}
              placeholder="/path/to/e2e.yaml"
              className="w-full text-sm border rounded px-3 py-1.5 font-mono"
            />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">描述（可选）</label>
            <input
              type="text"
              value={addDesc}
              onChange={e => setAddDesc(e.target.value)}
              placeholder="项目描述"
              className="w-full text-sm border rounded px-3 py-1.5"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!addName || !addPath || loading}
            className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            添加
          </button>
        </div>
      </div>

      {/* 扫描目录 */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">扫描目录（自动发现 e2e.yaml）</h3>
        <div className="flex gap-3 mb-3">
          <input
            type="text"
            value={scanDir}
            onChange={e => setScanDir(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
            placeholder="/path/to/workspace"
            className="flex-1 text-sm border rounded px-3 py-1.5 font-mono"
          />
          <button
            onClick={handleScan}
            disabled={!scanDir || scanning}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {scanning ? '扫描中...' : '扫描'}
          </button>
        </div>
        {scanResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">找到 {scanResults.length} 个项目：</p>
            {scanResults.map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 border">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800">{item.name}</div>
                  <div className="text-xs text-gray-500 font-mono truncate">{item.configPath}</div>
                  {item.description && <div className="text-xs text-gray-400">{item.description}</div>}
                </div>
                <button
                  onClick={() => handleAddFromScan(item)}
                  className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors shrink-0 ml-3"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* e2e.yaml 配置说明 */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">e2e.yaml 配置说明</h3>
        <div className="text-xs text-gray-500 space-y-3">
          <p>
            每个 E2E 项目由一个 <code className="bg-gray-100 px-1 rounded">e2e.yaml</code> 配置文件定义。
            你可以使用上方的「创建新项目」按钮通过可视化表单生成，或手动编写。
          </p>
          <div className="bg-gray-50 rounded-lg p-3 border">
            <p className="text-xs font-medium text-gray-600 mb-2">配置文件结构：</p>
            <pre className="text-xs text-gray-500 font-mono whitespace-pre-wrap leading-relaxed">{`version: "1"          # 配置版本号

project:              # * 项目元数据
  name: my-service    #   唯一名称
  description: "..."  #   描述
  version: "1.0.0"    #   版本

repos:                # Git 仓库（支持构建前分支切换）
  - name: my-repo
    path: ../../repo

service:              # * 被测服务
  build:              #   Docker 构建
    dockerfile: ./Dockerfile
    context: .
    image: my-service:e2e
  container:          #   容器运行
    name: my-e2e
    ports: ["8080:3000"]
    environment: {}
    healthcheck:
      path: /health
  vars:               #   自定义变量
    base_url: http://localhost:8080

mocks:                # Mock 外部依赖
  gateway:
    port: 9081
    routes:
      - method: POST
        path: /api/xxx
        response: { status: 200, body: {} }

tests:                # 测试套件
  suites:
    - { id: health, name: 健康检查, file: tests/health.yaml }
    - { id: basic, name: 基础测试, file: tests/basic.yaml, runner: vitest }

dashboard:            # Dashboard 配置
  port: 9095
  presets:            #   API 调试器预设端点
    - group: 健康
      endpoints:
        - { method: GET, path: health, name: Health }
  envDefaults: {}     #   环境变量编辑器默认值
  defaultDirs: [/app] #   容器目录浏览默认路径

network:              # Docker 网络
  name: e2e-network`}</pre>
          </div>
          <p className="text-gray-400">
            标有 <span className="text-red-400">*</span> 的是必填字段。其余为可选，按需配置。
            变量替换支持 <code className="bg-gray-100 px-1 rounded">{'{{env.XXX}}'}</code> 和 <code className="bg-gray-100 px-1 rounded">{'{{config.xxx}}'}</code>。
          </p>
        </div>
      </div>
    </div>
  )
}
