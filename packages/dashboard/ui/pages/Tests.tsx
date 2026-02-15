import { useState, useEffect, useRef } from 'react'
import { tests } from '../lib/api'

interface TestSuite {
  id: string;
  name: string;
  description: string;
  file: string;
  runner?: string;
}

interface TestCase {
  name: string;
  delay?: string;
  request?: { method: string; path: string; body?: unknown; timeout?: string };
  exec?: { command: string; container?: string };
  file?: {
    path: string;
    exists?: boolean;
    contains?: string | string[];
    notContains?: string | string[];
    matches?: string;
    json?: Record<string, unknown>;
    permissions?: string;
    owner?: string;
    size?: string;
  };
  expect?: {
    status?: number | number[];
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    output?: Record<string, unknown>;
    exitCode?: number;
    expr?: string | string[];
    all?: Array<Record<string, unknown>>;
    any?: Array<Record<string, unknown>>;
  };
  save?: Record<string, string>;
  ignoreError?: boolean;
}

interface SuiteContent {
  raw: string;
  parsed?: {
    name: string;
    description?: string;
    variables?: Record<string, string>;
    setup?: unknown[];
    teardown?: unknown[];
    cases: TestCase[];
    caseCount: number;
  };
  filePath?: string;
  runner?: string;
}

interface TestRecord {
  id: string;
  suite: string;
  status: string;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string[];
}

type ViewMode = 'cases' | 'yaml' | 'output';

export function TestsPage() {
  const [suites, setSuites] = useState<TestSuite[]>([])
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null)
  const [suiteContent, setSuiteContent] = useState<SuiteContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('cases')

  // YAML editor state
  const [editingYaml, setEditingYaml] = useState(false)
  const [yamlDraft, setYamlDraft] = useState('')
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Test execution state
  const [currentTest, setCurrentTest] = useState<TestRecord | null>(null)
  const [history, setHistory] = useState<TestRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<TestRecord | null>(null)
  const [running, setRunning] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Load suites and history
  useEffect(() => {
    tests.getSuites().then(res => setSuites(res.suites))
    tests.getHistory().then(res => setHistory(res.tests))
  }, [])

  // Load suite content when selected
  useEffect(() => {
    if (!selectedSuiteId || selectedSuiteId === 'all') {
      setSuiteContent(null)
      return
    }
    setLoadingContent(true)
    tests.getSuiteContent(selectedSuiteId).then(res => {
      if (res.success && res.raw) {
        setSuiteContent({
          raw: res.raw,
          parsed: res.parsed as SuiteContent['parsed'],
          filePath: res.filePath,
          runner: res.runner,
        })
        setYamlDraft(res.raw)
      } else {
        setSuiteContent(null)
      }
      setLoadingContent(false)
    }).catch(() => setLoadingContent(false))
  }, [selectedSuiteId])

  // Poll current test
  useEffect(() => {
    if (!running) return
    const interval = setInterval(async () => {
      const res = await tests.getCurrent()
      if (res.test) {
        setCurrentTest(res.test as TestRecord)
        setSelectedRecord(res.test as TestRecord)
      } else {
        setRunning(false)
        setCurrentTest(null)
        const historyRes = await tests.getHistory()
        setHistory(historyRes.tests)
        if (historyRes.tests[0]) setSelectedRecord(historyRes.tests[0])
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [running])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [selectedRecord?.output.length])

  const runSuite = async (suiteId: string) => {
    setRunning(true)
    setSelectedRecord(null)
    setViewMode('output')
    const res = await tests.run(suiteId)
    if (!res.success) { setRunning(false); alert(res.error) }
  }

  const handleSaveYaml = async () => {
    if (!selectedSuiteId) return
    setSaveMessage(null)
    const res = await tests.saveSuiteContent(selectedSuiteId, yamlDraft)
    if (res.success) {
      setSaveMessage({ type: 'success', text: '保存成功' })
      setEditingYaml(false)
      // Reload content
      const contentRes = await tests.getSuiteContent(selectedSuiteId)
      if (contentRes.success && contentRes.raw) {
        setSuiteContent({
          raw: contentRes.raw,
          parsed: contentRes.parsed as SuiteContent['parsed'],
          filePath: contentRes.filePath,
          runner: contentRes.runner,
        })
        setYamlDraft(contentRes.raw)
      }
    } else {
      setSaveMessage({ type: 'error', text: res.error || '保存失败' })
    }
    setTimeout(() => setSaveMessage(null), 3000)
  }

  const formatDuration = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`

  const methodColor = (method: string) => {
    switch (method?.toUpperCase()) {
      case 'GET': return 'bg-green-100 text-green-700'
      case 'POST': return 'bg-blue-100 text-blue-700'
      case 'PUT': return 'bg-orange-100 text-orange-700'
      case 'DELETE': return 'bg-red-100 text-red-700'
      case 'PATCH': return 'bg-purple-100 text-purple-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const selectedSuite = suites.find(s => s.id === selectedSuiteId)

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">测试套件</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runSuite('all')}
            disabled={running}
            className={`px-6 py-2 rounded-md text-sm font-medium text-white transition-colors ${
              running ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {running ? '测试运行中...' : '运行全部测试'}
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Suite List */}
        <div className="w-72 shrink-0 flex flex-col gap-3 overflow-auto">
          {suites.filter(s => s.id !== 'all').map(suite => (
            <button
              key={suite.id}
              onClick={() => { setSelectedSuiteId(suite.id); setViewMode('cases') }}
              className={`bg-white rounded-lg shadow-sm border p-3 text-left transition-all ${
                selectedSuiteId === suite.id ? 'ring-2 ring-blue-500 border-blue-300' : 'hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-800">{suite.name}</span>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    suite.runner === 'yaml' || (!suite.runner && suite.file?.endsWith('.yaml'))
                      ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {suite.runner || (suite.file?.endsWith('.yaml') ? 'yaml' : 'vitest')}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); runSuite(suite.id) }}
                    disabled={running}
                    className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
                  >
                    ▶
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 truncate">{suite.file}</p>
            </button>
          ))}

          {/* History */}
          <div className="bg-white rounded-lg shadow-sm border flex-1 min-h-0 flex flex-col mt-1">
            <div className="px-3 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">
              测试历史 ({history.length})
            </div>
            <div className="flex-1 overflow-auto">
              {history.length === 0 ? (
                <div className="p-3 text-center text-xs text-gray-400">暂无记录</div>
              ) : (
                history.map(record => (
                  <button
                    key={record.id}
                    onClick={() => { setSelectedRecord(record); setViewMode('output') }}
                    className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-gray-50 transition-colors ${
                      selectedRecord?.id === record.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full ${
                        record.status === 'passed' ? 'bg-green-500' :
                        record.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      <span className="text-xs font-medium text-gray-800">
                        {suites.find(s => s.id === record.suite)?.name || record.suite}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{new Date(record.startTime).toLocaleString()}</span>
                      {record.endTime && <span>{formatDuration(record.endTime - record.startTime)}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedSuiteId && selectedSuite ? (
            <>
              {/* Suite Header */}
              <div className="bg-white rounded-t-lg border px-4 py-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">{selectedSuite.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {suiteContent?.filePath || selectedSuite.file}
                    {suiteContent?.parsed && (
                      <span className="ml-2 text-gray-400">· {suiteContent.parsed.caseCount} 个用例</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {(['cases', 'yaml', 'output'] as ViewMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        viewMode === mode
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {mode === 'cases' ? '用例列表' : mode === 'yaml' ? 'YAML 源码' : '执行输出'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cases View */}
              {viewMode === 'cases' && (
                <div className="flex-1 min-h-0 overflow-auto border border-t-0 rounded-b-lg bg-white">
                  {loadingContent ? (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      加载中...
                    </div>
                  ) : suiteContent?.parsed ? (
                    <div className="divide-y">
                      {/* Variables */}
                      {suiteContent.parsed.variables && Object.keys(suiteContent.parsed.variables).length > 0 && (
                        <div className="px-4 py-3 bg-gray-50">
                          <h4 className="text-xs font-medium text-gray-500 mb-2">变量</h4>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(suiteContent.parsed.variables).map(([k, v]) => (
                              <span key={k} className="inline-flex items-center text-xs bg-gray-100 rounded px-2 py-1">
                                <span className="font-mono text-purple-600">{k}</span>
                                <span className="mx-1 text-gray-400">=</span>
                                <span className="font-mono text-gray-700">{v}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Setup steps */}
                      {suiteContent.parsed.setup && suiteContent.parsed.setup.length > 0 && (
                        <div className="px-4 py-3 bg-amber-50/50">
                          <h4 className="text-xs font-medium text-amber-700 mb-2">Setup ({suiteContent.parsed.setup.length} 步)</h4>
                          <div className="space-y-1">
                            {suiteContent.parsed.setup.map((step: any, i: number) => (
                              <div key={i} className="text-xs text-gray-600 font-mono bg-white/70 rounded px-2 py-1">
                                {step.waitHealthy ? `waitHealthy (timeout: ${step.waitHealthy.timeout || '60s'})` :
                                 step.waitForPort ? `waitForPort (${step.waitForPort.host || 'localhost'}:${step.waitForPort.port})` :
                                 step.delay ? `delay ${step.delay}` :
                                 step.name || JSON.stringify(step).slice(0, 80)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Test Cases */}
                      {suiteContent.parsed.cases.map((tc, i) => (
                        <div key={i} className="px-4 py-3 hover:bg-blue-50/30 transition-colors">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-gray-400 w-6">#{i + 1}</span>
                              <span className="text-sm font-medium text-gray-800">{tc.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {tc.delay && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                  delay: {tc.delay}
                                </span>
                              )}
                              {tc.ignoreError && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                                  ignoreError
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="ml-8 space-y-2">
                            {/* Request info */}
                            {tc.request && (
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${methodColor(tc.request.method)}`}>
                                  {tc.request.method}
                                </span>
                                <span className="text-xs font-mono text-gray-700">{tc.request.path}</span>
                                {tc.request.timeout && (
                                  <span className="text-[10px] text-gray-400">timeout: {tc.request.timeout}</span>
                                )}
                              </div>
                            )}

                            {/* Exec info */}
                            {tc.exec != null && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-gray-800 text-gray-200">
                                  EXEC
                                </span>
                                <code className="text-xs font-mono text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">
                                  {tc.exec.command}
                                </code>
                              </div>
                            )}

                            {/* File assertion info */}
                            {tc.file != null && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-700 text-teal-100">
                                    FILE
                                  </span>
                                  <code className="text-xs font-mono text-gray-700">{tc.file.path}</code>
                                  {tc.file.exists !== undefined && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${tc.file.exists ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                      {tc.file.exists ? 'exists' : 'not exists'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5 ml-6">
                                  {tc.file.permissions && (
                                    <span className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 font-mono">perms: {tc.file.permissions}</span>
                                  )}
                                  {tc.file.owner && (
                                    <span className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 font-mono">owner: {tc.file.owner}</span>
                                  )}
                                  {tc.file.size && (
                                    <span className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 font-mono">size: {tc.file.size}</span>
                                  )}
                                  {tc.file.contains && (
                                    <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5">
                                      contains: {Array.isArray(tc.file.contains) ? tc.file.contains.join(', ') : tc.file.contains}
                                    </span>
                                  )}
                                  {tc.file.matches && (
                                    <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 font-mono">
                                      /{tc.file.matches}/
                                    </span>
                                  )}
                                  {tc.file.json != null && (
                                    <details className="text-[10px]">
                                      <summary className="inline-flex items-center bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 cursor-pointer">
                                        JSON ({Object.keys(tc.file.json).length} fields)
                                      </summary>
                                      <pre className="mt-1 p-2 bg-gray-50 rounded font-mono text-[11px]">
                                        {JSON.stringify(tc.file.json, null, 2)}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Process assertion */}
                            {(tc as any).process != null && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-violet-700 text-violet-100">
                                  PROCESS
                                </span>
                                <span className="text-xs font-mono text-gray-700">{(tc as any).process.name}</span>
                                {(tc as any).process.running !== undefined && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${(tc as any).process.running ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {(tc as any).process.running ? 'running' : 'not running'}
                                  </span>
                                )}
                                {(tc as any).process.count && (
                                  <span className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 font-mono">count: {(tc as any).process.count}</span>
                                )}
                                {(tc as any).process.user && (
                                  <span className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5 font-mono">user: {(tc as any).process.user}</span>
                                )}
                              </div>
                            )}

                            {/* Port assertion */}
                            {(tc as any).port != null && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-700 text-cyan-100">
                                  PORT
                                </span>
                                <span className="text-xs font-mono text-gray-700">
                                  {(tc as any).port.host || 'localhost'}:{(tc as any).port.port}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${(tc as any).port.listening !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {(tc as any).port.listening !== false ? 'listening' : 'not listening'}
                                </span>
                              </div>
                            )}

                            {/* Request body */}
                            {tc.request?.body != null && (
                              <details className="text-xs">
                                <summary className="text-gray-500 cursor-pointer hover:text-gray-700">Request Body</summary>
                                <pre className="mt-1 p-2 bg-gray-50 rounded text-gray-700 font-mono text-[11px] overflow-auto max-h-32">
                                  {JSON.stringify(tc.request.body, null, 2)}
                                </pre>
                              </details>
                            )}

                            {/* Expect assertions */}
                            {tc.expect != null && (
                              <div className="flex flex-wrap gap-1.5">
                                {tc.expect.status !== undefined && (
                                  <span className="inline-flex items-center text-[10px] bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 font-mono">
                                    status: {Array.isArray(tc.expect.status) ? `[${tc.expect.status.join(', ')}]` : tc.expect.status}
                                  </span>
                                )}
                                {tc.expect.exitCode !== undefined && (
                                  <span className="inline-flex items-center text-[10px] bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 font-mono">
                                    exitCode: {tc.expect.exitCode}
                                  </span>
                                )}
                                {tc.expect.body != null && (
                                  <details className="text-[10px]">
                                    <summary className="inline-flex items-center bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 cursor-pointer hover:bg-emerald-100">
                                      body ({Object.keys(tc.expect.body).length} assertions)
                                    </summary>
                                    <pre className="mt-1 p-2 bg-gray-50 rounded text-gray-700 font-mono text-[11px] overflow-auto max-h-24">
                                      {JSON.stringify(tc.expect.body, null, 2)}
                                    </pre>
                                  </details>
                                )}
                                {tc.expect.output != null && (
                                  <details className="text-[10px]">
                                    <summary className="inline-flex items-center bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 cursor-pointer hover:bg-emerald-100">
                                      output ({Object.keys(tc.expect.output).length} assertions)
                                    </summary>
                                    <pre className="mt-1 p-2 bg-gray-50 rounded text-gray-700 font-mono text-[11px] overflow-auto max-h-24">
                                      {JSON.stringify(tc.expect.output, null, 2)}
                                    </pre>
                                  </details>
                                )}
                                {tc.expect.expr != null && (
                                  <div className="text-[10px]">
                                    {(Array.isArray(tc.expect.expr) ? tc.expect.expr : [tc.expect.expr]).map((e, ei) => (
                                      <span key={ei} className="inline-flex items-center bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 font-mono mr-1 mb-1">
                                        expr: {e}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {tc.expect.all != null && (
                                  <span className="inline-flex items-center text-[10px] bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                                    ALL ({tc.expect.all.length} conditions)
                                  </span>
                                )}
                                {tc.expect.any != null && (
                                  <span className="inline-flex items-center text-[10px] bg-orange-50 text-orange-700 rounded px-1.5 py-0.5">
                                    ANY ({tc.expect.any.length} conditions)
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Save variables */}
                            {tc.save != null && (
                              <div className="flex items-center gap-1 text-[10px] text-purple-600">
                                <span>save:</span>
                                {Object.entries(tc.save).map(([k, v]) => (
                                  <span key={k} className="bg-purple-50 rounded px-1.5 py-0.5 font-mono">{k} ← {v}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Teardown steps */}
                      {suiteContent.parsed.teardown && suiteContent.parsed.teardown.length > 0 && (
                        <div className="px-4 py-3 bg-red-50/50">
                          <h4 className="text-xs font-medium text-red-700 mb-2">Teardown ({suiteContent.parsed.teardown.length} 步)</h4>
                          <div className="space-y-1">
                            {suiteContent.parsed.teardown.map((step: any, i: number) => (
                              <div key={i} className="text-xs text-gray-600 font-mono bg-white/70 rounded px-2 py-1">
                                {step.name || JSON.stringify(step).slice(0, 80)}
                                {step.ignoreError && <span className="ml-2 text-yellow-600">(ignoreError)</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      无法解析测试用例（可能不是 YAML 测试文件）
                    </div>
                  )}
                </div>
              )}

              {/* YAML Source View */}
              {viewMode === 'yaml' && (
                <div className="flex-1 min-h-0 flex flex-col border border-t-0 rounded-b-lg overflow-hidden">
                  {/* Toolbar */}
                  <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
                    <span className="text-xs text-gray-400 font-mono">
                      {suiteContent?.filePath || selectedSuite.file}
                    </span>
                    <div className="flex items-center gap-2">
                      {saveMessage && (
                        <span className={`text-xs ${saveMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                          {saveMessage.text}
                        </span>
                      )}
                      {editingYaml ? (
                        <>
                          <button
                            onClick={() => { setEditingYaml(false); setYamlDraft(suiteContent?.raw || '') }}
                            className="text-xs px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveYaml}
                            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            保存
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingYaml(true)}
                          className="text-xs px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors"
                        >
                          编辑
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Editor/Viewer */}
                  {editingYaml ? (
                    <textarea
                      value={yamlDraft}
                      onChange={e => setYamlDraft(e.target.value)}
                      className="flex-1 min-h-0 bg-gray-900 text-green-400 font-mono text-xs p-4 resize-none focus:outline-none"
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="flex-1 min-h-0 overflow-auto bg-gray-900 text-green-400 font-mono text-xs p-4 whitespace-pre-wrap">
                      {suiteContent?.raw || '加载中...'}
                    </pre>
                  )}
                </div>
              )}

              {/* Execution Output View */}
              {viewMode === 'output' && (
                <div className="flex-1 min-h-0 flex flex-col border border-t-0 rounded-b-lg overflow-hidden">
                  {selectedRecord ? (
                    <>
                      <div className="flex items-center justify-between bg-white px-4 py-2 border-b">
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            selectedRecord.status === 'passed' ? 'bg-green-100 text-green-800' :
                            selectedRecord.status === 'failed' ? 'bg-red-100 text-red-800' :
                            selectedRecord.status === 'running' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {selectedRecord.status.toUpperCase()}
                          </span>
                          <span className="text-sm text-gray-700">
                            {suites.find(s => s.id === selectedRecord.suite)?.name || selectedRecord.suite}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {selectedRecord.endTime
                            ? `${formatDuration(selectedRecord.endTime - selectedRecord.startTime)}`
                            : '运行中...'}
                        </span>
                      </div>
                      <div
                        ref={logRef}
                        className="flex-1 min-h-0 bg-gray-900 overflow-auto p-4 font-mono text-xs text-gray-300 whitespace-pre-wrap"
                      >
                        {selectedRecord.output.length === 0 ? (
                          <span className="text-gray-600">{running ? '等待输出...' : '无输出'}</span>
                        ) : (
                          selectedRecord.output.map((line, i) => (
                            <div key={i} className={
                              line.includes('PASS') || line.includes('✓') ? 'text-green-400' :
                              line.includes('FAIL') || line.includes('✗') || line.includes('Error') ? 'text-red-400' :
                              line.includes('===') ? 'text-blue-400 font-bold' : ''
                            }>{line}</div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-white text-gray-400 text-sm">
                      {running ? '测试运行中，等待输出...' : '运行测试或查看历史记录以查看输出'}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-lg border text-gray-400 text-sm">
              {running ? '测试运行中...' : '选择左侧的测试套件查看详情'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
