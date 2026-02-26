import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'
import type { DurationDataPoint } from '../lib/api'

interface Props {
  data: DurationDataPoint[]
  loading?: boolean
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ payload: DurationDataPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]!.payload
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      <p className="text-blue-600">平均: {formatDuration(d.avgDuration)}</p>
      <p className="text-blue-400">最短: {formatDuration(d.minDuration)}</p>
      <p className="text-blue-300">最长: {formatDuration(d.maxDuration)}</p>
      <p className="text-gray-500 mt-1">运行次数: {d.runCount}</p>
    </div>
  )
}

export function DurationChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">执行时长趋势</h3>
        <div className="h-64 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">执行时长趋势</h3>
        <div className="h-64 flex items-center justify-center text-gray-400">暂无数据</div>
      </div>
    )
  }

  const latestAvg = data[data.length - 1]?.avgDuration ?? 0

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">执行时长趋势</h3>
        <span className="text-2xl font-bold text-blue-600">{formatDuration(latestAvg)}</span>
      </div>
      <ResponsiveContainer width="100%" height={256}>
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatDuration(v)} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="maxDuration"
            stroke="#93c5fd"
            fill="url(#durationGrad)"
            strokeWidth={1}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="avgDuration"
            stroke="#3b82f6"
            fill="none"
            strokeWidth={2}
            dot={{ r: 3, fill: '#3b82f6' }}
            activeDot={{ r: 5 }}
          />
          <Area
            type="monotone"
            dataKey="minDuration"
            stroke="#bfdbfe"
            fill="none"
            strokeWidth={1}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
