import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { PassRateDataPoint } from '../lib/api'

interface Props {
  data: PassRateDataPoint[]
  loading?: boolean
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ payload: PassRateDataPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]!.payload
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      <p className="text-green-600">通过率: {d.passRate.toFixed(1)}%</p>
      <p className="text-green-500">通过: {d.passed}</p>
      <p className="text-red-500">失败: {d.failed}</p>
      <p className="text-gray-400">跳过: {d.skipped}</p>
      <p className="text-gray-500 mt-1">运行次数: {d.runCount}</p>
    </div>
  )
}

export function PassRateChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">通过率趋势</h3>
        <div className="h-64 flex items-center justify-center text-gray-400">加载中...</div>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">通过率趋势</h3>
        <div className="h-64 flex items-center justify-center text-gray-400">暂无数据</div>
      </div>
    )
  }

  const latestRate = data[data.length - 1]?.passRate ?? 0
  const rateColor = latestRate >= 90 ? 'text-green-600' : latestRate >= 70 ? 'text-yellow-600' : 'text-red-600'
  const lineColor = latestRate >= 90 ? '#16a34a' : latestRate >= 70 ? '#ca8a04' : '#dc2626'

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">通过率趋势</h3>
        <span className={`text-2xl font-bold ${rateColor}`}>{latestRate.toFixed(1)}%</span>
      </div>
      <ResponsiveContainer width="100%" height={256}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={90} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Line
            type="monotone"
            dataKey="passRate"
            stroke={lineColor}
            strokeWidth={2}
            dot={{ r: 3, fill: lineColor }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
