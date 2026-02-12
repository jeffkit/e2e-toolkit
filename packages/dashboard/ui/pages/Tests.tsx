import { useState, useEffect, useRef } from 'react'
import { tests } from '../lib/api'

interface TestSuite {
  id: string;
  name: string;
  description: string;
  file: string;
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

export function TestsPage() {
  const [suites, setSuites] = useState<TestSuite[]>([])
  const [currentTest, setCurrentTest] = useState<TestRecord | null>(null)
  const [history, setHistory] = useState<TestRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<TestRecord | null>(null)
  const [running, setRunning] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // 加载测试套件列表
  useEffect(() => {
    tests.getSuites().then(res => setSuites(res.suites))
    tests.getHistory().then(res => setHistory(res.tests))
  }, [])

  // 轮询当前测试状态
  useEffect(() => {
    if (!running) return

    const interval = setInterval(async () => {
      const res = await tests.getCurrent()
      if (res.test) {
        setCurrentTest(res.test as TestRecord)
        setSelectedRecord(res.test as TestRecord)
      } else {
        // 测试完成
        setRunning(false)
        setCurrentTest(null)
        // 刷新历史
        const historyRes = await tests.getHistory()
        setHistory(historyRes.tests)
        if (historyRes.tests[0]) {
          setSelectedRecord(historyRes.tests[0])
        }
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [running])

  // 自动滚动日志
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [selectedRecord?.output.length])

  const runSuite = async (suiteId: string) => {
    setRunning(true)
    setSelectedRecord(null)
    const res = await tests.run(suiteId)
    if (!res.success) {
      setRunning(false)
      alert(res.error)
    }
  }

  const runAll = () => runSuite('all')

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">测试套件</h2>
        <button
          onClick={runAll}
          disabled={running}
          className={`px-6 py-2 rounded-md text-sm font-medium text-white transition-colors ${
            running ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {running ? '测试运行中...' : '运行全部测试'}
        </button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧：测试套件列表 */}
        <div className="w-72 shrink-0 flex flex-col gap-4 overflow-auto">
          {/* 套件卡片 */}
          <div className="space-y-2">
            {suites.filter(s => s.id !== 'all').map(suite => (
              <div key={suite.id} className="bg-white rounded-lg shadow-sm border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-800">{suite.name}</span>
                  <button
                    onClick={() => runSuite(suite.id)}
                    disabled={running}
                    className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
                  >
                    运行
                  </button>
                </div>
                <p className="text-xs text-gray-500">{suite.description}</p>
                {suite.runner && suite.runner !== 'vitest' && (
                  <span className="text-xs text-gray-400 mt-1 inline-block">
                    runner: {suite.runner}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 历史记录 */}
          <div className="bg-white rounded-lg shadow-sm border flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">
              测试历史
            </div>
            <div className="flex-1 overflow-auto">
              {history.length === 0 ? (
                <div className="p-3 text-center text-xs text-gray-400">暂无记录</div>
              ) : (
                history.map(record => (
                  <button
                    key={record.id}
                    onClick={() => setSelectedRecord(record)}
                    className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-gray-50 transition-colors ${
                      selectedRecord?.id === record.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full ${
                        record.status === 'passed' ? 'bg-green-500' :
                        record.status === 'failed' ? 'bg-red-500' :
                        'bg-yellow-500'
                      }`} />
                      <span className="text-xs font-medium text-gray-800">
                        {suites.find(s => s.id === record.suite)?.name || record.suite}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{new Date(record.startTime).toLocaleString()}</span>
                      {record.endTime && (
                        <span>{formatDuration(record.endTime - record.startTime)}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 右侧：测试输出 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedRecord ? (
            <>
              {/* 测试信息头 */}
              <div className="bg-white rounded-t-lg border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedRecord.status === 'passed' ? 'bg-green-100 text-green-800' :
                    selectedRecord.status === 'failed' ? 'bg-red-100 text-red-800' :
                    selectedRecord.status === 'running' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {selectedRecord.status === 'passed' && 'PASSED'}
                    {selectedRecord.status === 'failed' && 'FAILED'}
                    {selectedRecord.status === 'running' && 'RUNNING'}
                    {selectedRecord.status === 'error' && 'ERROR'}
                  </span>
                  <span className="text-sm font-medium text-gray-800">
                    {suites.find(s => s.id === selectedRecord.suite)?.name || selectedRecord.suite}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {selectedRecord.endTime
                    ? `完成于 ${new Date(selectedRecord.endTime).toLocaleTimeString()} · 耗时 ${formatDuration(selectedRecord.endTime - selectedRecord.startTime)}`
                    : `开始于 ${new Date(selectedRecord.startTime).toLocaleTimeString()}`}
                </div>
              </div>

              {/* 测试输出 */}
              <div
                ref={logRef}
                className="flex-1 min-h-0 bg-gray-900 rounded-b-lg overflow-auto p-4 font-mono text-xs text-gray-300 whitespace-pre-wrap"
              >
                {selectedRecord.output.length === 0 ? (
                  <span className="text-gray-600">
                    {selectedRecord.status === 'running' ? '等待输出...' : '无输出'}
                  </span>
                ) : (
                  selectedRecord.output.map((line, i) => (
                    <div key={i} className={
                      line.includes('PASS') || line.includes('✓') ? 'text-green-400' :
                      line.includes('FAIL') || line.includes('✗') || line.includes('Error') ? 'text-red-400' :
                      ''
                    }>{line}</div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-lg border text-gray-400 text-sm">
              {running ? '测试运行中，等待输出...' : '选择一个测试套件运行，或查看历史记录'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
