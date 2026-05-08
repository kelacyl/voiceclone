import { useEffect, useState } from 'react'
import { X, Download, CheckCircle, AlertCircle } from 'lucide-react'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function DownloadProgressModal({ visible, onClose }: Props) {
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(new Map())

  useEffect(() => {
    window.voiceCloneAPI.onDownloadProgress((progress: DownloadState) => {
      setDownloads(prev => {
        const next = new Map(prev)
        next.set(progress.id, progress)
        return next
      })
    })
  }, [])

  if (!visible) return null

  const entries = Array.from(downloads.values())
  const hasActive = entries.some(d => d.status === 'downloading')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-96 max-h-96 overflow-auto p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Download className="w-5 h-5 text-purple-400" />
            模型下载
          </h2>
          {!hasActive && (
            <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded transition">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {entries.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">暂无下载任务</p>
        )}

        <div className="space-y-3">
          {entries.map(d => (
            <div key={d.id} className="p-3 rounded-lg bg-gray-800 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-200 truncate max-w-[200px]">
                  {d.filename}
                  {d.id.endsWith('-base') && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300">基础</span>}
                  {d.id.endsWith('-aux') && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-cyan-900/50 text-cyan-300">辅助</span>}
                </span>
                {d.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-400" />}
                {d.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                {d.status === 'downloading' && (
                  <span className="text-xs text-purple-400">{d.progress}%</span>
                )}
              </div>

              {/* Progress bar */}
              {d.status === 'downloading' && (
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-300"
                    style={{ width: `${d.progress}%` }}
                  />
                </div>
              )}

              {/* Details */}
              {d.status === 'downloading' && (
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>{d.speed}</span>
                  <span>{d.eta}</span>
                </div>
              )}

              {d.status === 'completed' && (
                <p className="text-xs text-green-400 mt-1">下载完成</p>
              )}

              {d.status === 'error' && (
                <p className="text-xs text-red-400 mt-1">{d.error || '下载失败'}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
