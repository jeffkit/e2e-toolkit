/**
 * 可视化 e2e.yaml 配置编辑器
 *
 * 表单式 UI，支持：
 * - 各配置区段的结构化编辑
 * - JSON ↔ YAML 双向切换
 * - 模板快速填充
 * - 保存到文件
 */

import { useState, useEffect, useCallback } from 'react'
import { projects } from '../lib/api'

// ─── Types ───────────────────────────────────────────────────

interface PortMapping { host: string; container: string }
interface EnvEntry { key: string; value: string }
interface RepoEntry { name: string; path: string; url: string; branch: string }
interface TestSuiteEntry { id: string; name: string; file: string; runner: string }
interface MockRouteEntry { method: string; path: string; status: number; body: string }
interface MockServiceEntry { name: string; port: string; containerPort: string; routes: MockRouteEntry[] }
interface PresetEndpointEntry { method: string; path: string; name: string; body: string }
interface PresetGroupEntry { group: string; endpoints: PresetEndpointEntry[] }

interface ConfigFormData {
  // project
  projectName: string
  projectDesc: string
  projectVersion: string
  // build
  dockerfile: string
  buildContext: string
  imageName: string
  // container
  containerName: string
  ports: PortMapping[]
  environment: EnvEntry[]
  volumes: string[]
  healthcheckPath: string
  healthcheckInterval: string
  healthcheckTimeout: string
  healthcheckRetries: string
  healthcheckStartPeriod: string
  // vars
  vars: EnvEntry[]
  // repos
  repos: RepoEntry[]
  // mocks
  mocks: MockServiceEntry[]
  // tests
  tests: TestSuiteEntry[]
  // dashboard
  dashboardPort: string
  dashboardUiPort: string
  envDefaults: EnvEntry[]
  defaultDirs: string[]
  presets: PresetGroupEntry[]
  // network
  networkName: string
}

const defaultForm: ConfigFormData = {
  projectName: '', projectDesc: '', projectVersion: '1.0.0',
  dockerfile: './Dockerfile', buildContext: '.', imageName: '',
  containerName: '', ports: [{ host: '8080', container: '3000' }],
  environment: [], volumes: [], healthcheckPath: '/health',
  healthcheckInterval: '10s', healthcheckTimeout: '5s', healthcheckRetries: '10', healthcheckStartPeriod: '30s',
  vars: [{ key: 'base_url', value: 'http://localhost:8080' }],
  repos: [], mocks: [], tests: [],
  dashboardPort: '9095', dashboardUiPort: '9091',
  envDefaults: [], defaultDirs: ['/app', '/tmp'],
  presets: [], networkName: 'e2e-network',
}

// ─── Helpers ─────────────────────────────────────────────────

function formToConfig(f: ConfigFormData): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    version: '1',
    project: {
      name: f.projectName,
      ...(f.projectDesc ? { description: f.projectDesc } : {}),
      ...(f.projectVersion ? { version: f.projectVersion } : {}),
    },
  }

  // repos
  if (f.repos.length > 0) {
    cfg.repos = f.repos.filter(r => r.name && (r.path || r.url)).map(r => {
      const entry: Record<string, string> = { name: r.name }
      if (r.url) { entry.url = r.url; if (r.branch) entry.branch = r.branch }
      if (r.path) entry.path = r.path
      return entry
    })
  }

  // service
  const env: Record<string, string> = {}
  f.environment.filter(e => e.key).forEach(e => { env[e.key] = e.value })
  const vars: Record<string, string> = {}
  f.vars.filter(v => v.key).forEach(v => { vars[v.key] = v.value })

  const container: Record<string, unknown> = {
    name: f.containerName || `${f.projectName}-e2e`,
    ports: f.ports.filter(p => p.host && p.container).map(p => `${p.host}:${p.container}`),
  }
  if (Object.keys(env).length > 0) container.environment = env
  if (f.volumes.filter(Boolean).length > 0) container.volumes = f.volumes.filter(Boolean)
  if (f.healthcheckPath) {
    container.healthcheck = {
      path: f.healthcheckPath,
      interval: f.healthcheckInterval || '10s',
      timeout: f.healthcheckTimeout || '5s',
      retries: parseInt(f.healthcheckRetries) || 10,
      startPeriod: f.healthcheckStartPeriod || '30s',
    }
  }

  cfg.service = {
    build: { dockerfile: f.dockerfile, context: f.buildContext, image: f.imageName || `${f.projectName}:e2e` },
    container,
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
  }

  // mocks
  if (f.mocks.length > 0) {
    const mocks: Record<string, unknown> = {}
    for (const m of f.mocks.filter(m => m.name)) {
      const mock: Record<string, unknown> = { port: parseInt(m.port) || 9081 }
      if (m.containerPort) mock.containerPort = parseInt(m.containerPort)
      if (m.routes.length > 0) {
        mock.routes = m.routes.filter(r => r.path).map(r => {
          let body: unknown = r.body
          try { body = JSON.parse(r.body) } catch { /* keep string */ }
          return { method: r.method, path: r.path, response: { status: r.status || 200, body } }
        })
      }
      mocks[m.name] = mock
    }
    if (Object.keys(mocks).length > 0) cfg.mocks = mocks
  }

  // tests
  if (f.tests.length > 0) {
    cfg.tests = {
      suites: f.tests.filter(t => t.id).map(t => ({
        name: t.name || t.id,
        id: t.id,
        ...(t.file ? { file: t.file } : {}),
        ...(t.runner && t.runner !== 'yaml' ? { runner: t.runner } : {}),
      })),
    }
  }

  // dashboard
  const dashboard: Record<string, unknown> = {}
  if (f.dashboardPort !== '9095') dashboard.port = parseInt(f.dashboardPort) || 9095
  if (f.dashboardUiPort !== '9091') dashboard.uiPort = parseInt(f.dashboardUiPort) || 9091
  const envDef: Record<string, string> = {}
  f.envDefaults.filter(e => e.key).forEach(e => { envDef[e.key] = e.value })
  if (Object.keys(envDef).length > 0) dashboard.envDefaults = envDef
  if (f.defaultDirs.filter(Boolean).length > 0) dashboard.defaultDirs = f.defaultDirs.filter(Boolean)
  if (f.presets.length > 0) {
    dashboard.presets = f.presets.filter(g => g.group).map(g => ({
      group: g.group,
      endpoints: g.endpoints.filter(e => e.path).map(e => {
        const ep: Record<string, unknown> = { method: e.method, path: e.path, name: e.name || e.path }
        if (e.body) {
          try { ep.body = JSON.parse(e.body) } catch { /* ignore */ }
        }
        return ep
      }),
    }))
  }
  if (Object.keys(dashboard).length > 0) cfg.dashboard = dashboard

  // network
  if (f.networkName && f.networkName !== 'e2e-network') cfg.network = { name: f.networkName }

  return cfg
}

function configToForm(cfg: Record<string, unknown>): ConfigFormData {
  const f = { ...defaultForm }
  const proj = cfg.project as Record<string, string> | undefined
  if (proj) {
    f.projectName = proj.name || ''
    f.projectDesc = proj.description || ''
    f.projectVersion = proj.version || ''
  }
  const repos = cfg.repos as Array<{ name: string; path?: string; url?: string; branch?: string }> | undefined
  if (repos) f.repos = repos.map(r => ({ name: r.name, path: r.path || '', url: r.url || '', branch: r.branch || '' }))

  const service = cfg.service as Record<string, unknown> | undefined
  if (service) {
    const build = service.build as Record<string, string> | undefined
    if (build) {
      f.dockerfile = build.dockerfile || './Dockerfile'
      f.buildContext = build.context || '.'
      f.imageName = build.image || ''
    }
    const ct = service.container as Record<string, unknown> | undefined
    if (ct) {
      f.containerName = (ct.name as string) || ''
      const ports = ct.ports as string[] | undefined
      if (ports) f.ports = ports.map(p => { const [h, c] = p.split(':'); return { host: h, container: c || h } })
      const env = ct.environment as Record<string, string> | undefined
      if (env) f.environment = Object.entries(env).map(([key, value]) => ({ key, value }))
      const vols = ct.volumes as string[] | undefined
      if (vols) f.volumes = vols
      const hc = ct.healthcheck as Record<string, unknown> | undefined
      if (hc) {
        f.healthcheckPath = (hc.path as string) || ''
        f.healthcheckInterval = (hc.interval as string) || '10s'
        f.healthcheckTimeout = (hc.timeout as string) || '5s'
        f.healthcheckRetries = String(hc.retries ?? 10)
        f.healthcheckStartPeriod = (hc.startPeriod as string) || '30s'
      }
    }
    const vars = service.vars as Record<string, string> | undefined
    if (vars) f.vars = Object.entries(vars).map(([key, value]) => ({ key, value }))
  }

  const mocks = cfg.mocks as Record<string, Record<string, unknown>> | undefined
  if (mocks) {
    f.mocks = Object.entries(mocks).map(([name, m]) => ({
      name,
      port: String(m.port ?? ''),
      containerPort: String(m.containerPort ?? ''),
      routes: ((m.routes as Array<Record<string, unknown>>) || []).map(r => {
        const resp = r.response as Record<string, unknown> | undefined
        return {
          method: (r.method as string) || 'GET',
          path: (r.path as string) || '',
          status: (resp?.status as number) || 200,
          body: resp?.body ? JSON.stringify(resp.body) : '',
        }
      }),
    }))
  }

  const tests = cfg.tests as { suites?: Array<Record<string, string>> } | undefined
  if (tests?.suites) {
    f.tests = tests.suites.map(s => ({
      id: s.id || '', name: s.name || '', file: s.file || '', runner: s.runner || 'yaml',
    }))
  }

  const dashboard = cfg.dashboard as Record<string, unknown> | undefined
  if (dashboard) {
    f.dashboardPort = String(dashboard.port ?? 9095)
    f.dashboardUiPort = String(dashboard.uiPort ?? 9091)
    const envDef = dashboard.envDefaults as Record<string, string> | undefined
    if (envDef) f.envDefaults = Object.entries(envDef).map(([key, value]) => ({ key, value }))
    const dirs = dashboard.defaultDirs as string[] | undefined
    if (dirs) f.defaultDirs = dirs
    const presets = dashboard.presets as Array<Record<string, unknown>> | undefined
    if (presets) {
      f.presets = presets.map(g => ({
        group: (g.group as string) || '',
        endpoints: ((g.endpoints as Array<Record<string, unknown>>) || []).map(e => ({
          method: (e.method as string) || 'GET',
          path: (e.path as string) || '',
          name: (e.name as string) || '',
          body: e.body ? JSON.stringify(e.body) : '',
        })),
      }))
    }
  }

  const network = cfg.network as { name?: string } | undefined
  if (network) f.networkName = network.name || 'e2e-network'

  return f
}

// ─── Sub Components ──────────────────────────────────────────

function SectionHeader({ title, desc, required }: { title: string; desc: string; required?: boolean }) {
  return (
    <div className="mb-3 border-b pb-2">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        {title}
        {required && <span className="text-xs text-red-500">*必填</span>}
      </h3>
      <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
    </div>
  )
}

function Field({ label, desc, required, children }: { label: string; desc?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-gray-600 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
        {desc && <span className="text-gray-400 ml-1">— {desc}</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = 'w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300'
const smallInputCls = 'text-sm border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300'

function KVList({ items, onChange, keyPlaceholder, valuePlaceholder }: {
  items: EnvEntry[]
  onChange: (items: EnvEntry[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input className={`${smallInputCls} flex-1`} placeholder={keyPlaceholder || 'KEY'}
            value={item.key} onChange={e => { const n = [...items]; n[i] = { ...n[i], key: e.target.value }; onChange(n) }} />
          <span className="text-gray-400">=</span>
          <input className={`${smallInputCls} flex-[2]`} placeholder={valuePlaceholder || 'value'}
            value={item.value} onChange={e => { const n = [...items]; n[i] = { ...n[i], value: e.target.value }; onChange(n) }} />
          <button className="text-red-400 hover:text-red-600 text-xs px-1" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => onChange([...items, { key: '', value: '' }])}>
        + 添加
      </button>
    </div>
  )
}

function StringList({ items, onChange, placeholder }: {
  items: string[]; onChange: (items: string[]) => void; placeholder?: string
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input className={`${smallInputCls} flex-1`} placeholder={placeholder}
            value={item} onChange={e => { const n = [...items]; n[i] = e.target.value; onChange(n) }} />
          <button className="text-red-400 hover:text-red-600 text-xs px-1" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => onChange([...items, ''])}>
        + 添加
      </button>
    </div>
  )
}

// ─── Main Editor ─────────────────────────────────────────────

interface ConfigEditorProps {
  /** 编辑已有项目 */
  projectName?: string
  /** 创建模式（无 projectName） */
  mode?: 'edit' | 'create'
  onSaved?: () => void
  onCancel?: () => void
}

export function ConfigEditor({ projectName, mode = 'edit', onSaved, onCancel }: ConfigEditorProps) {
  const [form, setForm] = useState<ConfigFormData>({ ...defaultForm })
  const [activeTab, setActiveTab] = useState('project')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [yamlPreview, setYamlPreview] = useState('')
  const [showYaml, setShowYaml] = useState(false)
  const [createDir, setCreateDir] = useState('')
  const [schemaInfo, setSchemaInfo] = useState<{
    sections: Array<{ key: string; title: string; description: string; required: boolean; fields: Array<{ key: string; type: string; required: boolean; description: string; example?: string }> }>
    templates: Record<string, Record<string, unknown>>
  } | null>(null)

  // Load schema info
  useEffect(() => {
    projects.getSchema().then(setSchemaInfo).catch(() => {})
  }, [])

  // Load existing project config into form when editing
  useEffect(() => {
    if (mode === 'edit' && projectName) {
      projects.getParsedConfig(projectName).then(res => {
        if (res.success && res.config) {
          setForm(configToForm(res.config))
        }
      }).catch(() => {})
    }
  }, [projectName, mode])

  const update = useCallback((patch: Partial<ConfigFormData>) => {
    setForm(prev => ({ ...prev, ...patch }))
  }, [])

  const generateYaml = useCallback(() => {
    const cfg = formToConfig(form)
    // We need to convert to YAML. Since we don't have js-yaml in browser,
    // we'll use a simple JSON representation that the backend will convert.
    setYamlPreview(JSON.stringify(cfg, null, 2))
    setShowYaml(true)
  }, [form])

  const handleSave = async () => {
    if (!form.projectName) { setError('项目名称是必填项'); return }
    setSaving(true)
    setError('')
    setSuccess('')

    const cfg = formToConfig(form)

    try {
      if (mode === 'edit' && projectName) {
        const res = await projects.saveConfigFile(projectName, { config: cfg })
        if (res.success) {
          setSuccess('配置已保存并重新加载')
          onSaved?.()
        } else {
          setError(res.error || '保存失败')
        }
      } else {
        if (!createDir) { setError('请输入项目目录路径'); setSaving(false); return }
        const res = await projects.create(createDir, cfg)
        if (res.success) {
          setSuccess(`项目已创建: ${res.configPath}`)
          onSaved?.()
        } else {
          setError(res.error || '创建失败')
        }
      }
    } catch (e: any) {
      setError(e.message || '操作失败')
    }
    setSaving(false)
  }

  const loadTemplate = (key: string) => {
    if (!schemaInfo?.templates?.[key]) return
    setForm(configToForm(schemaInfo.templates[key]))
    setSuccess(`已加载「${key === 'minimal' ? '最小' : key === 'standard' ? '标准' : '完整'}」模板`)
  }

  const tabs = [
    { id: 'project', label: '项目信息', icon: '📋' },
    { id: 'build', label: '镜像构建', icon: '🔨' },
    { id: 'container', label: '容器配置', icon: '📦' },
    { id: 'repos', label: 'Git 仓库', icon: '🔗' },
    { id: 'mocks', label: 'Mock 服务', icon: '🎭' },
    { id: 'tests', label: '测试套件', icon: '🧪' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'network', label: '网络', icon: '🌐' },
  ]

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            {mode === 'edit' ? `编辑配置 — ${projectName}` : '创建新项目'}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">可视化编辑 e2e.yaml 配置</p>
        </div>
        <div className="flex gap-2 items-center">
          {schemaInfo?.templates && (
            <div className="flex gap-1 mr-2">
              <span className="text-xs text-gray-400">模板:</span>
              {Object.keys(schemaInfo.templates).map(k => (
                <button key={k} onClick={() => loadTemplate(k)}
                  className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                  {k === 'minimal' ? '最小' : k === 'standard' ? '标准' : '完整'}
                </button>
              ))}
            </div>
          )}
          <button onClick={generateYaml}
            className="text-xs px-3 py-1 rounded border text-gray-600 hover:bg-gray-50 transition-colors">
            预览 YAML
          </button>
          <button onClick={handleSave} disabled={saving}
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 transition-colors">
            {saving ? '保存中...' : mode === 'edit' ? '保存' : '创建项目'}
          </button>
          {onCancel && (
            <button onClick={onCancel} className="text-xs px-3 py-1 rounded border text-gray-500 hover:bg-gray-50">
              取消
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="px-4 py-2 bg-green-50 text-green-700 text-sm border-b flex items-center justify-between">
          {success}
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600">✕</button>
        </div>
      )}

      {/* Create mode: directory selector */}
      {mode === 'create' && (
        <div className="px-4 py-2 bg-yellow-50 border-b">
          <Field label="项目目录" desc="e2e.yaml 将保存到此目录" required>
            <input className={inputCls} value={createDir} onChange={e => setCreateDir(e.target.value)}
              placeholder="/path/to/my-project" />
          </Field>
        </div>
      )}

      <div className="flex">
        {/* Tab nav */}
        <div className="w-36 bg-gray-50 border-r shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors ${
                activeTab === t.id ? 'bg-white text-blue-600 font-medium border-r-2 border-blue-600' : 'text-gray-500 hover:bg-gray-100'
              }`}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 p-4 max-h-[500px] overflow-y-auto">
          {/* Project */}
          {activeTab === 'project' && (
            <div>
              <SectionHeader title="项目信息" desc="项目基本元数据，name 是唯一标识" required />
              <Field label="项目名称" desc="唯一标识，用于容器名前缀等" required>
                <input className={inputCls} value={form.projectName} placeholder="my-service"
                  onChange={e => update({ projectName: e.target.value })} />
              </Field>
              <Field label="项目描述">
                <input className={inputCls} value={form.projectDesc} placeholder="My E2E testing project"
                  onChange={e => update({ projectDesc: e.target.value })} />
              </Field>
              <Field label="版本号">
                <input className={inputCls} value={form.projectVersion} placeholder="1.0.0"
                  onChange={e => update({ projectVersion: e.target.value })} />
              </Field>
            </div>
          )}

          {/* Build */}
          {activeTab === 'build' && (
            <div>
              <SectionHeader title="镜像构建" desc="定义 Docker 镜像的构建方式" required />
              <Field label="Dockerfile 路径" desc="相对于 e2e.yaml 文件位置" required>
                <input className={inputCls} value={form.dockerfile} placeholder="./Dockerfile"
                  onChange={e => update({ dockerfile: e.target.value })} />
              </Field>
              <Field label="构建上下文" desc="Docker build 的 context 目录" required>
                <input className={inputCls} value={form.buildContext} placeholder="."
                  onChange={e => update({ buildContext: e.target.value })} />
              </Field>
              <Field label="镜像名:标签" desc="构建后的镜像名称" required>
                <input className={inputCls} value={form.imageName} placeholder="my-service:e2e"
                  onChange={e => update({ imageName: e.target.value })} />
              </Field>
            </div>
          )}

          {/* Container */}
          {activeTab === 'container' && (
            <div>
              <SectionHeader title="容器配置" desc="容器运行参数（端口、环境变量、挂载等）" required />
              <Field label="容器名称" required>
                <input className={inputCls} value={form.containerName} placeholder="my-service-e2e"
                  onChange={e => update({ containerName: e.target.value })} />
              </Field>
              <Field label="端口映射" desc="宿主机端口 : 容器端口" required>
                <div className="space-y-1">
                  {form.ports.map((p, i) => (
                    <div key={i} className="flex gap-1 items-center">
                      <input className={`${smallInputCls} w-24`} value={p.host} placeholder="8080"
                        onChange={e => { const n = [...form.ports]; n[i] = { ...n[i], host: e.target.value }; update({ ports: n }) }} />
                      <span className="text-gray-400">:</span>
                      <input className={`${smallInputCls} w-24`} value={p.container} placeholder="3000"
                        onChange={e => { const n = [...form.ports]; n[i] = { ...n[i], container: e.target.value }; update({ ports: n }) }} />
                      <button className="text-red-400 hover:text-red-600 text-xs px-1"
                        onClick={() => update({ ports: form.ports.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  <button className="text-xs text-blue-600 hover:text-blue-700"
                    onClick={() => update({ ports: [...form.ports, { host: '', container: '' }] })}>
                    + 添加端口
                  </button>
                </div>
              </Field>
              <Field label="环境变量">
                <KVList items={form.environment} onChange={items => update({ environment: items })}
                  keyPlaceholder="ENV_KEY" valuePlaceholder="value" />
              </Field>
              <Field label="Volume 挂载">
                <StringList items={form.volumes} onChange={items => update({ volumes: items })}
                  placeholder="host-path:/container-path" />
              </Field>
              <Field label="健康检查路径" desc="HTTP GET 路径，留空禁用健康检查">
                <input className={inputCls} value={form.healthcheckPath} placeholder="/health"
                  onChange={e => update({ healthcheckPath: e.target.value })} />
              </Field>
              {form.healthcheckPath && (
                <div className="grid grid-cols-4 gap-2">
                  <Field label="间隔"><input className={smallInputCls + ' w-full'} value={form.healthcheckInterval} onChange={e => update({ healthcheckInterval: e.target.value })} /></Field>
                  <Field label="超时"><input className={smallInputCls + ' w-full'} value={form.healthcheckTimeout} onChange={e => update({ healthcheckTimeout: e.target.value })} /></Field>
                  <Field label="重试次数"><input className={smallInputCls + ' w-full'} value={form.healthcheckRetries} onChange={e => update({ healthcheckRetries: e.target.value })} /></Field>
                  <Field label="启动等待"><input className={smallInputCls + ' w-full'} value={form.healthcheckStartPeriod} onChange={e => update({ healthcheckStartPeriod: e.target.value })} /></Field>
                </div>
              )}
              <Field label="自定义变量 (service.vars)" desc="可在配置中通过 {'{{config.xxx}}'} 引用">
                <KVList items={form.vars} onChange={items => update({ vars: items })}
                  keyPlaceholder="base_url" valuePlaceholder="http://localhost:8080" />
              </Field>
            </div>
          )}

          {/* Repos */}
          {activeTab === 'repos' && (
            <div>
              <SectionHeader title="Git 仓库" desc="关联的 Git 仓库，支持本地路径或远程 SSH/HTTPS URL" />
              <div className="space-y-3">
                {form.repos.map((r, i) => (
                  <div key={i} className="border rounded-lg p-3 bg-gray-50">
                    <div className="flex gap-2 items-center mb-2">
                      <input className={`${smallInputCls} w-32`} value={r.name} placeholder="仓库名"
                        onChange={e => { const n = [...form.repos]; n[i] = { ...n[i], name: e.target.value }; update({ repos: n }) }} />
                      <button className="text-red-400 hover:text-red-600 text-xs ml-auto"
                        onClick={() => update({ repos: form.repos.filter((_, j) => j !== i) })}>删除</button>
                    </div>
                    <div className="space-y-1.5">
                      <div>
                        <label className="text-xs text-gray-400">远程 URL（SSH 或 HTTPS，留空则使用本地路径）</label>
                        <input className={`${inputCls}`} value={r.url} placeholder="git@github.com:user/repo.git"
                          onChange={e => { const n = [...form.repos]; n[i] = { ...n[i], url: e.target.value }; update({ repos: n }) }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400">本地路径（相对于 e2e.yaml，远程模式下可留空）</label>
                        <input className={`${inputCls}`} value={r.path} placeholder="../../my-repo"
                          onChange={e => { const n = [...form.repos]; n[i] = { ...n[i], path: e.target.value }; update({ repos: n }) }} />
                      </div>
                      {r.url && (
                        <div>
                          <label className="text-xs text-gray-400">默认分支（远程仓库使用）</label>
                          <input className={`${smallInputCls} w-32`} value={r.branch} placeholder="main"
                            onChange={e => { const n = [...form.repos]; n[i] = { ...n[i], branch: e.target.value }; update({ repos: n }) }} />
                        </div>
                      )}
                    </div>
                    {r.url && <div className="text-xs text-blue-500 mt-1">远程模式 — 构建时自动 clone/fetch 到工作目录</div>}
                    {!r.url && r.path && <div className="text-xs text-gray-400 mt-1">本地模式 — 使用本地已有仓库</div>}
                  </div>
                ))}
                <button className="text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => update({ repos: [...form.repos, { name: '', path: '', url: '', branch: '' }] })}>
                  + 添加仓库
                </button>
              </div>
            </div>
          )}

          {/* Mocks */}
          {activeTab === 'mocks' && (
            <div>
              <SectionHeader title="Mock 服务" desc="模拟外部依赖，自动启动为 sidecar 容器" />
              {form.mocks.map((m, mi) => (
                <div key={mi} className="border rounded-lg p-3 mb-3 bg-gray-50">
                  <div className="flex gap-2 items-center mb-2">
                    <input className={`${smallInputCls} w-32`} value={m.name} placeholder="mock-api"
                      onChange={e => { const n = [...form.mocks]; n[mi] = { ...n[mi], name: e.target.value }; update({ mocks: n }) }} />
                    <input className={`${smallInputCls} w-20`} value={m.port} placeholder="9081"
                      onChange={e => { const n = [...form.mocks]; n[mi] = { ...n[mi], port: e.target.value }; update({ mocks: n }) }} />
                    <input className={`${smallInputCls} w-20`} value={m.containerPort} placeholder="容器端口"
                      onChange={e => { const n = [...form.mocks]; n[mi] = { ...n[mi], containerPort: e.target.value }; update({ mocks: n }) }} />
                    <button className="text-red-400 hover:text-red-600 text-xs ml-auto"
                      onClick={() => update({ mocks: form.mocks.filter((_, j) => j !== mi) })}>删除</button>
                  </div>
                  <div className="text-xs text-gray-500 mb-1">路由:</div>
                  {m.routes.map((r, ri) => (
                    <div key={ri} className="flex gap-1 items-center mb-1">
                      <select className={`${smallInputCls} w-20`} value={r.method}
                        onChange={e => { const n = [...form.mocks]; n[mi].routes[ri] = { ...r, method: e.target.value }; update({ mocks: n }) }}>
                        {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m}>{m}</option>)}
                      </select>
                      <input className={`${smallInputCls} flex-1`} value={r.path} placeholder="/api/xxx"
                        onChange={e => { const n = [...form.mocks]; n[mi].routes[ri] = { ...r, path: e.target.value }; update({ mocks: n }) }} />
                      <input className={`${smallInputCls} w-14`} value={r.status} placeholder="200" type="number"
                        onChange={e => { const n = [...form.mocks]; n[mi].routes[ri] = { ...r, status: parseInt(e.target.value) || 200 }; update({ mocks: n }) }} />
                      <input className={`${smallInputCls} flex-1`} value={r.body} placeholder='{"key":"value"}'
                        onChange={e => { const n = [...form.mocks]; n[mi].routes[ri] = { ...r, body: e.target.value }; update({ mocks: n }) }} />
                      <button className="text-red-400 hover:text-red-600 text-xs px-1"
                        onClick={() => { const n = [...form.mocks]; n[mi].routes = n[mi].routes.filter((_, j) => j !== ri); update({ mocks: n }) }}>✕</button>
                    </div>
                  ))}
                  <button className="text-xs text-blue-600 hover:text-blue-700"
                    onClick={() => { const n = [...form.mocks]; n[mi].routes.push({ method: 'GET', path: '', status: 200, body: '' }); update({ mocks: n }) }}>
                    + 添加路由
                  </button>
                </div>
              ))}
              <button className="text-xs text-blue-600 hover:text-blue-700"
                onClick={() => update({ mocks: [...form.mocks, { name: '', port: '9081', containerPort: '', routes: [] }] })}>
                + 添加 Mock 服务
              </button>
            </div>
          )}

          {/* Tests */}
          {activeTab === 'tests' && (
            <div>
              <SectionHeader title="测试套件" desc="定义 E2E 测试套件，支持多种运行器" />
              <div className="space-y-2">
                {form.tests.map((t, i) => (
                  <div key={i} className="flex gap-2 items-center bg-gray-50 rounded px-3 py-2 border">
                    <input className={`${smallInputCls} w-24`} value={t.id} placeholder="ID"
                      onChange={e => { const n = [...form.tests]; n[i] = { ...n[i], id: e.target.value }; update({ tests: n }) }} />
                    <input className={`${smallInputCls} w-32`} value={t.name} placeholder="套件名称"
                      onChange={e => { const n = [...form.tests]; n[i] = { ...n[i], name: e.target.value }; update({ tests: n }) }} />
                    <input className={`${smallInputCls} flex-1`} value={t.file} placeholder="tests/xxx.yaml"
                      onChange={e => { const n = [...form.tests]; n[i] = { ...n[i], file: e.target.value }; update({ tests: n }) }} />
                    <select className={`${smallInputCls} w-24`} value={t.runner}
                      onChange={e => { const n = [...form.tests]; n[i] = { ...n[i], runner: e.target.value }; update({ tests: n }) }}>
                      {['yaml', 'vitest', 'pytest', 'shell', 'exec'].map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button className="text-red-400 hover:text-red-600 text-xs px-1"
                      onClick={() => update({ tests: form.tests.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button className="text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => update({ tests: [...form.tests, { id: '', name: '', file: '', runner: 'yaml' }] })}>
                  + 添加测试套件
                </button>
              </div>
            </div>
          )}

          {/* Dashboard */}
          {activeTab === 'dashboard' && (
            <div>
              <SectionHeader title="Dashboard 配置" desc="仪表盘的端口、预设 API 端点、默认环境变量等" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="API 端口">
                  <input className={inputCls} value={form.dashboardPort} placeholder="9095"
                    onChange={e => update({ dashboardPort: e.target.value })} />
                </Field>
                <Field label="UI 端口">
                  <input className={inputCls} value={form.dashboardUiPort} placeholder="9091"
                    onChange={e => update({ dashboardUiPort: e.target.value })} />
                </Field>
              </div>
              <Field label="默认环境变量" desc="环境变量编辑器的预填值">
                <KVList items={form.envDefaults} onChange={items => update({ envDefaults: items })} />
              </Field>
              <Field label="容器浏览目录" desc="默认可浏览的容器内目录">
                <StringList items={form.defaultDirs} onChange={items => update({ defaultDirs: items })} placeholder="/app" />
              </Field>
              <Field label="API 预设分组" desc="API 调试器的预定义端点">
                {form.presets.map((g, gi) => (
                  <div key={gi} className="border rounded p-2 mb-2 bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                      <input className={`${smallInputCls} w-32`} value={g.group} placeholder="分组名"
                        onChange={e => { const n = [...form.presets]; n[gi] = { ...n[gi], group: e.target.value }; update({ presets: n }) }} />
                      <button className="text-red-400 hover:text-red-600 text-xs ml-auto"
                        onClick={() => update({ presets: form.presets.filter((_, j) => j !== gi) })}>删除分组</button>
                    </div>
                    {g.endpoints.map((ep, ei) => (
                      <div key={ei} className="flex gap-1 items-center mb-1">
                        <select className={`${smallInputCls} w-16`} value={ep.method}
                          onChange={e => { const n = [...form.presets]; n[gi].endpoints[ei] = { ...ep, method: e.target.value }; update({ presets: n }) }}>
                          {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m}>{m}</option>)}
                        </select>
                        <input className={`${smallInputCls} flex-1`} value={ep.path} placeholder="path"
                          onChange={e => { const n = [...form.presets]; n[gi].endpoints[ei] = { ...ep, path: e.target.value }; update({ presets: n }) }} />
                        <input className={`${smallInputCls} w-24`} value={ep.name} placeholder="名称"
                          onChange={e => { const n = [...form.presets]; n[gi].endpoints[ei] = { ...ep, name: e.target.value }; update({ presets: n }) }} />
                        <button className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => { const n = [...form.presets]; n[gi].endpoints = n[gi].endpoints.filter((_, j) => j !== ei); update({ presets: n }) }}>✕</button>
                      </div>
                    ))}
                    <button className="text-xs text-blue-600 hover:text-blue-700"
                      onClick={() => { const n = [...form.presets]; n[gi].endpoints.push({ method: 'GET', path: '', name: '', body: '' }); update({ presets: n }) }}>
                      + 添加端点
                    </button>
                  </div>
                ))}
                <button className="text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => update({ presets: [...form.presets, { group: '', endpoints: [] }] })}>
                  + 添加分组
                </button>
              </Field>
            </div>
          )}

          {/* Network */}
          {activeTab === 'network' && (
            <div>
              <SectionHeader title="Docker 网络" desc="容器间通信使用的 Docker 网络" />
              <Field label="网络名称" desc="默认 e2e-network">
                <input className={inputCls} value={form.networkName} placeholder="e2e-network"
                  onChange={e => update({ networkName: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
      </div>

      {/* YAML Preview Modal */}
      {showYaml && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowYaml(false)}>
          <div className="bg-white rounded-lg shadow-xl w-[700px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">配置预览 (JSON → 后端转换为 YAML 保存)</h3>
              <button onClick={() => setShowYaml(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <pre className="p-4 text-xs font-mono overflow-auto max-h-[60vh] bg-gray-50">{yamlPreview}</pre>
          </div>
        </div>
      )}

      {/* Schema docs */}
      {schemaInfo && activeTab === 'project' && (
        <div className="px-4 py-3 border-t bg-blue-50">
          <details>
            <summary className="text-xs text-blue-600 cursor-pointer">查看完整 e2e.yaml 配置说明</summary>
            <div className="mt-2 space-y-3">
              {schemaInfo.sections.map(s => (
                <div key={s.key}>
                  <div className="text-xs font-medium text-gray-700">{s.title} <code className="text-gray-400">{s.key}</code> {s.required && <span className="text-red-400">*必填</span>}</div>
                  <p className="text-xs text-gray-400">{s.description}</p>
                  <div className="ml-3 mt-1 space-y-0.5">
                    {s.fields.map(f => (
                      <div key={f.key} className="text-xs text-gray-500">
                        <code className="text-gray-600">{f.key}</code>
                        <span className="text-gray-300 mx-1">{f.type}</span>
                        {f.required && <span className="text-red-300">*</span>}
                        {' '}{f.description}
                        {f.example && <span className="text-gray-300"> (例: <code>{f.example}</code>)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
