import { useState, useEffect } from 'react'
import { proxy, config as configApi } from '../lib/api'

interface PresetEndpoint {
  method: string;
  path: string;
  name: string;
  body?: unknown;
}

interface PresetGroup {
  group: string;
  endpoints: PresetEndpoint[];
}

interface CallResult {
  endpoint: string;
  method: string;
  status: 'pending' | 'success' | 'error';
  statusCode?: number;
  response?: unknown;
  duration?: number;
  error?: string;
  timestamp: number;
  requestBody?: unknown;
}

export function ApiExplorer() {
  const [results, setResults] = useState<CallResult[]>([])
  const [customMethod, setCustomMethod] = useState('GET')
  const [customPath, setCustomPath] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [selectedResult, setSelectedResult] = useState<CallResult | null>(null)
  const [presets, setPresets] = useState<PresetGroup[]>([])

  // 当前正在编辑的请求（点击带 body 的按钮后展示编辑区域）
  const [pendingRequest, setPendingRequest] = useState<{
    method: string;
    path: string;
    name: string;
    bodyText: string;
  } | null>(null)

  // Load presets from config
  useEffect(() => {
    configApi.get().then(res => {
      const dashboard = (res as any).dashboard
      if (dashboard?.presets) {
        setPresets(dashboard.presets)
      }
    }).catch(() => {})
  }, [])

  const callApi = async (method: string, path: string, body: unknown) => {
    const result: CallResult = {
      endpoint: path,
      method,
      status: 'pending',
      timestamp: Date.now(),
      requestBody: body,
    }
    setResults(prev => [result, ...prev])

    const start = Date.now()
    try {
      const response = await proxy.call(method, path, body)
      const updated: CallResult = {
        ...result,
        status: 'success',
        response,
        duration: Date.now() - start,
      }
      setResults(prev => prev.map(r => r.timestamp === result.timestamp ? updated : r))
      setSelectedResult(updated)
    } catch (err) {
      const updated: CallResult = {
        ...result,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      }
      setResults(prev => prev.map(r => r.timestamp === result.timestamp ? updated : r))
      setSelectedResult(updated)
    }
  }

  const handleEndpointClick = (ep: PresetEndpoint) => {
    if (ep.body) {
      setPendingRequest({
        method: ep.method,
        path: ep.path,
        name: ep.name,
        bodyText: JSON.stringify(ep.body, null, 2),
      })
    } else {
      callApi(ep.method, ep.path, null)
    }
  }

  const handlePendingSend = () => {
    if (!pendingRequest) return
    let body = null
    try {
      body = JSON.parse(pendingRequest.bodyText)
    } catch {
      body = pendingRequest.bodyText
    }
    callApi(pendingRequest.method, pendingRequest.path, body)
    setPendingRequest(null)
  }

  const handleCustomCall = () => {
    let body = null
    if (customBody.trim()) {
      try {
        body = JSON.parse(customBody)
      } catch {
        body = customBody
      }
    }
    callApi(customMethod, customPath, body)
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-gray-800 mb-4">API 调试器</h2>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧：API 列表 */}
        <div className="w-80 shrink-0 overflow-auto">
          {/* 自定义请求 */}
          <div className="bg-white rounded-lg shadow-sm border p-3 mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">自定义请求</h3>
            <div className="flex gap-2 mb-2">
              <select
                value={customMethod}
                onChange={e => setCustomMethod(e.target.value)}
                className="text-xs border rounded px-2 py-1.5"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
                <option>PATCH</option>
              </select>
              <input
                type="text"
                value={customPath}
                onChange={e => setCustomPath(e.target.value)}
                placeholder="endpoint path"
                className="flex-1 text-xs border rounded px-2 py-1.5"
              />
            </div>
            {customMethod !== 'GET' && (
              <textarea
                value={customBody}
                onChange={e => setCustomBody(e.target.value)}
                placeholder='{"key": "value"}'
                className="w-full text-xs border rounded px-2 py-1.5 h-16 font-mono mb-2"
              />
            )}
            <button
              onClick={handleCustomCall}
              disabled={!customPath}
              className="w-full px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              发送请求
            </button>
          </div>

          {/* 预定义端点（从 e2e.yaml 配置读取） */}
          {presets.length > 0 ? (
            presets.map(group => (
              <div key={group.group} className="mb-4">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-1 px-1">
                  {group.group}
                </h3>
                <div className="space-y-1">
                  {group.endpoints.map(ep => (
                    <button
                      key={`${ep.method}-${ep.path}`}
                      onClick={() => handleEndpointClick(ep)}
                      className={`w-full flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-sm border text-left hover:bg-gray-50 transition-colors ${
                        pendingRequest?.path === ep.path ? 'ring-2 ring-blue-400' : ''
                      }`}
                    >
                      <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                        ep.method === 'GET' ? 'bg-green-100 text-green-700'
                          : ep.method === 'POST' ? 'bg-blue-100 text-blue-700'
                          : ep.method === 'PUT' ? 'bg-orange-100 text-orange-700'
                          : ep.method === 'DELETE' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {ep.method}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{ep.name}</div>
                        <div className="text-xs text-gray-500 font-mono truncate">/{ep.path}</div>
                      </div>
                    {ep.body != null && (
                      <span className="text-xs text-gray-400">编辑</span>
                    )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-xs text-gray-400">
              在 e2e.yaml 的 dashboard.presets 中配置预定义端点
            </div>
          )}
        </div>

        {/* 右侧：结果面板 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* 参数编辑区 */}
          {pendingRequest && (
            <div className="bg-white rounded-lg border mb-4 overflow-hidden">
              <div className="flex items-center justify-between bg-blue-50 px-4 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                    {pendingRequest.method}
                  </span>
                  <span className="text-sm font-mono">/{pendingRequest.path}</span>
                  <span className="text-sm text-gray-600">{pendingRequest.name}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPendingRequest(null)}
                    className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handlePendingSend}
                    className="px-4 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
                  >
                    发送
                  </button>
                </div>
              </div>
              <div className="p-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Request Body (JSON)</label>
                <textarea
                  value={pendingRequest.bodyText}
                  onChange={e => setPendingRequest({ ...pendingRequest, bodyText: e.target.value })}
                  className="w-full text-xs border rounded px-3 py-2 font-mono h-32 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {/* 当前选中的响应 */}
          {selectedResult ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between bg-white rounded-t-lg border px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                    selectedResult.method === 'GET' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {selectedResult.method}
                  </span>
                  <span className="text-sm font-mono">/{selectedResult.endpoint}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    selectedResult.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {selectedResult.status}
                  </span>
                  {selectedResult.duration != null && (
                    <span className="text-xs text-gray-500">{selectedResult.duration}ms</span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 bg-gray-900 rounded-b-lg overflow-auto p-4 font-mono text-xs text-green-400">
                {selectedResult.requestBody != null && (
                  <div className="mb-3 pb-3 border-b border-gray-700">
                    <span className="text-gray-500">// Request Body:</span>
                    <pre className="whitespace-pre-wrap text-yellow-300 mt-1">
                      {JSON.stringify(selectedResult.requestBody, null, 2)}
                    </pre>
                  </div>
                )}
                <pre className="whitespace-pre-wrap">
                  {selectedResult.error
                    ? selectedResult.error
                    : JSON.stringify(selectedResult.response, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-lg border text-gray-400 text-sm">
              {pendingRequest ? '编辑参数后点击"发送"' : '点击左侧按钮发送 API 请求'}
            </div>
          )}

          {/* 请求历史 */}
          <div className="mt-4 bg-white rounded-lg shadow-sm border max-h-48 overflow-auto">
            <div className="px-4 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600 sticky top-0">
              请求历史 ({results.length})
            </div>
            {results.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">暂无请求记录</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedResult(r)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left border-b last:border-0 hover:bg-gray-50 text-xs ${
                    selectedResult?.timestamp === r.timestamp ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    r.status === 'success' ? 'bg-green-500' :
                    r.status === 'error' ? 'bg-red-500' :
                    'bg-yellow-500'
                  }`} />
                  <span className="font-mono font-bold text-gray-600">{r.method}</span>
                  <span className="font-mono text-gray-800 truncate flex-1">/{r.endpoint}</span>
                  {r.duration != null && <span className="text-gray-400">{r.duration}ms</span>}
                  <span className="text-gray-400">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
