import { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BuildPage } from './pages/Build'
import { ContainerPage } from './pages/Container'
import { LogsPage } from './pages/Logs'
import { ApiExplorer } from './pages/ApiExplorer'
import { TestsPage } from './pages/Tests'
import { ProjectsPage } from './pages/Projects'
import { ActivityPage } from './pages/Activity'
import { PipelinePage } from './pages/Pipeline'
import { TrendsPage } from './pages/TrendsPage'
import { health, projects, type ProjectEntry } from './lib/api'

type Page = 'activity' | 'pipeline' | 'projects' | 'build' | 'container' | 'logs' | 'api' | 'tests' | 'trends'

function App() {
  const [page, setPage] = useState<Page>('activity')
  const [projectName, setProjectName] = useState('')
  const [projectVersion, setProjectVersion] = useState('')

  // Project selector state
  const [projectList, setProjectList] = useState<ProjectEntry[]>([])
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [switching, setSwitching] = useState(false)

  // 加载当前项目信息
  const loadInfo = useCallback(async () => {
    try {
      const [healthRes, projRes] = await Promise.all([
        health.dashboard(),
        projects.list(),
      ])
      if (healthRes.project) setProjectName(healthRes.project)
      if (healthRes.version) setProjectVersion(healthRes.version)
      setProjectList(projRes.projects)
      setActiveProjectName(projRes.activeProject)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadInfo() }, [loadInfo])

  // 快速切换项目
  const switchProject = async (name: string) => {
    setSwitching(true)
    setShowProjectDropdown(false)
    try {
      const res = await projects.activate(name)
      if (res.success) {
        await handleProjectSwitch()
      }
    } catch { /* ignore */ }
    setSwitching(false)
  }

  // Increment refreshKey on project switch to force child components to re-mount
  const [refreshKey, setRefreshKey] = useState(0)

  const handleProjectSwitch = useCallback(async () => {
    await loadInfo()
    setRefreshKey(k => k + 1) // Force re-mount all page components
  }, [loadInfo])

  const pages: Record<Page, { label: string; icon: string; component: React.ReactNode }> = {
    activity: { label: '活动时间线', icon: '⏱', component: <ActivityPage key={refreshKey} /> },
    pipeline: { label: '流水线', icon: '▶', component: <PipelinePage key={refreshKey} /> },
    projects: {
      label: '项目管理',
      icon: '📂',
      component: <ProjectsPage key={refreshKey} onProjectSwitch={handleProjectSwitch} />,
    },
    build: { label: '镜像构建', icon: '🔨', component: <BuildPage key={refreshKey} /> },
    container: { label: '容器管理', icon: '🚀', component: <ContainerPage key={refreshKey} /> },
    logs: { label: '容器日志', icon: '📋', component: <LogsPage key={refreshKey} /> },
    api: { label: 'API 调试', icon: '🔌', component: <ApiExplorer key={refreshKey} /> },
    tests: { label: '测试套件', icon: '🧪', component: <TestsPage key={refreshKey} /> },
    trends: { label: '趋势分析', icon: '📈', component: <TrendsPage key={refreshKey} /> },
  }

  return (
    <div className="h-screen overflow-hidden">
      <div className="flex h-screen">
        {/* 侧边栏 */}
        <nav className="w-48 bg-gray-900 text-white flex flex-col shrink-0">
          {/* 项目选择器 */}
          <div className="p-4 border-b border-gray-700 relative">
            <button
              onClick={() => setShowProjectDropdown(!showProjectDropdown)}
              className="w-full text-left group"
              disabled={switching}
            >
              <h1 className="text-lg font-bold flex items-center gap-1">
                {switching ? (
                  <span className="text-gray-400">切换中...</span>
                ) : (
                  <>
                    <span className="truncate">
                      {projectName || 'Preflight'}
                    </span>
                    <span className="text-gray-500 text-xs group-hover:text-gray-300 transition-colors">
                      {projectList.length > 1 ? '▼' : ''}
                    </span>
                  </>
                )}
              </h1>
              <p className="text-xs text-gray-400 mt-1">端到端测试仪表盘</p>
            </button>

            {/* 项目下拉列表 */}
            {showProjectDropdown && projectList.length > 0 && (
              <>
                {/* 点击外部关闭 */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowProjectDropdown(false)}
                />
                <div className="absolute left-2 right-2 top-full mt-1 bg-gray-800 rounded-lg shadow-xl border border-gray-600 z-20 overflow-hidden">
                  <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                    切换项目
                  </div>
                  {projectList.map(p => (
                    <button
                      key={p.name}
                      onClick={() => switchProject(p.name)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        p.name === activeProjectName
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        p.name === activeProjectName ? 'bg-white' : 'bg-gray-500'
                      }`} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setShowProjectDropdown(false); setPage('projects') }}
                    className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-gray-700 border-t border-gray-700 transition-colors"
                  >
                    管理项目...
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 py-2">
            {(Object.entries(pages) as [Page, typeof pages[Page]][]).map(([key, { label, icon }]) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2 transition-colors ${
                  page === key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
            {projectVersion ? `v${projectVersion}` : 'preflight v0.1.0'}
          </div>
        </nav>

        {/* 主内容区 */}
        <main className="flex-1 overflow-hidden bg-gray-50 relative">
          {(Object.entries(pages) as [Page, typeof pages[Page]][]).map(([key, { component }]) => (
            <div
              key={key}
              className="absolute inset-0 overflow-auto"
              style={{ display: page === key ? 'block' : 'none' }}
            >
              {component}
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
