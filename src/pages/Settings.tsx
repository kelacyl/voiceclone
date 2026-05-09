import { useState, useEffect } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, FolderOpen, Globe, RotateCw, FileCheck, Package, Key, Shield, ShieldCheck, Copy } from 'lucide-react'
import DownloadProgressModal from '../components/DownloadProgressModal'

const api = window.voiceCloneAPI

interface FileCounts {
  base: { existing: number; total: number }
  aux: { existing: number; total: number }
}

export default function Settings() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [mirrors, setMirrors] = useState<MirrorInfo[]>([])
  const [activeMirror, setActiveMirror] = useState('modelscope')
  const [selectedModel, setSelectedModel] = useState('Fun-CosyVoice3-0.5B-2512')
  const [modelsDir, setModelsDir] = useState('')
  const [downloading, setDownloading] = useState<{ model: string; group: string } | null>(null)
  const [showProgress, setShowProgress] = useState(false)
  const [error, setError] = useState('')
  const [modelFileCounts, setModelFileCounts] = useState<Record<string, FileCounts>>({})

  // License
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null)
  const [licenseMsg, setLicenseMsg] = useState('')
  const [licenseError, setLicenseError] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setError('')
    try {
      const [cfg, mirrorList, mirror] = await Promise.all([
        api.getConfig(),
        api.getMirrors(),
        api.getActiveMirror(),
      ])
      setSelectedModel(cfg.voiceModel)
      setMirrors(mirrorList)
      setActiveMirror(mirror)

      const modelList = await api.getRecommendedModels()
      setModels(modelList)

      await refreshFileCounts(modelList)

      try {
        const status = await api.modelStatus()
        setModelsDir(status.models_dir)
      } catch { /* 后端未启动，稍后刷新 */ }

      // 加载序列码状态
      try {
        const [info, mid] = await Promise.all([
          api.getLicenseInfo(),
          api.getMachineId(),
        ])
        setLicenseInfo(info)
        setMachineId(mid)
      } catch { /* ignore */ }
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function refreshFileCounts(modelList: ModelInfo[]) {
    const counts: Record<string, FileCounts> = {}
    for (const m of modelList) {
      try {
        counts[m.filename] = await api.getModelFileCounts(m.filename)
      } catch {
        counts[m.filename] = { base: { existing: 0, total: 0 }, aux: { existing: 0, total: 0 } }
      }
    }
    setModelFileCounts(counts)
  }

  async function switchMirror(mirrorId: string) {
    setActiveMirror(mirrorId)
    await api.setActiveMirror(mirrorId)
    const modelList = await api.getRecommendedModels()
    setModels(modelList)
    await refreshFileCounts(modelList)
  }

  async function downloadGroup(modelFname: string, modelName: string, group: 'base' | 'aux') {
    setDownloading({ model: modelFname, group })
    setShowProgress(true)
    setError('')

    try {
      const result = await api.downloadModel(modelFname, modelName, group)
      if (result.success) {
        if (group === 'base') {
          setSelectedModel(modelFname)
          await api.setConfig({ voice_model: modelFname })
        }
        await refreshFileCounts(models)
      } else {
        setError(result.error || '下载失败')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloading(null)
    }
  }

  async function redownloadGroup(modelFname: string, modelName: string, group: 'base' | 'aux') {
    setDownloading({ model: modelFname, group })
    setShowProgress(true)
    setError('')

    try {
      await api.deleteModelGroup(modelFname, group)
      // Refresh counts after deletion
      await refreshFileCounts(models)

      const result = await api.downloadModel(modelFname, modelName, group)
      if (result.success) {
        if (group === 'base') {
          setSelectedModel(modelFname)
          await api.setConfig({ voice_model: modelFname })
        }
        await refreshFileCounts(models)
      } else {
        setError(result.error || '下载失败')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloading(null)
    }
  }

  async function activateLicense() {
    if (!licenseKey.trim()) return
    setLicenseMsg('')
    setLicenseError(false)
    try {
      const ok = await api.validateLicense(licenseKey.trim())
      if (ok) {
        await api.setConfig({ license_key: licenseKey.trim() })
        const info = await api.getLicenseInfo()
        setLicenseInfo(info)
        setLicenseMsg('激活成功！')
        setLicenseError(false)
        setLicenseKey('')
      } else {
        setLicenseMsg('序列码无效')
        setLicenseError(true)
      }
    } catch {
      setLicenseMsg('验证失败')
      setLicenseError(true)
    }
  }

  const activeMirrorId = models.length > 0 ? models[0]?.downloadId : ''

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-sm text-red-300">
          {error}
          <button onClick={() => setError('')} className="ml-3 underline">关闭</button>
        </div>
      )}

      {/* 序列码激活 */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-3">序列码激活</h3>

        {/* License status */}
        {licenseInfo && (
          <div className={`p-3 rounded mb-3 ${licenseInfo.isActivated ? 'bg-green-900/20 border border-green-800' : 'bg-yellow-900/20 border border-yellow-800'}`}>
            <div className="flex items-center gap-2 mb-1">
              {licenseInfo.isActivated ? (
                <><ShieldCheck className="w-4 h-4 text-green-400" /><span className="text-sm text-green-400 font-medium">已激活</span></>
              ) : (
                <><Shield className="w-4 h-4 text-yellow-400" /><span className="text-sm text-yellow-400 font-medium">未激活 — 试用模式</span></>
              )}
            </div>
            <p className="text-xs text-gray-400">
              本月已使用 <span className="text-gray-200 font-mono">{licenseInfo.usageCount}</span> / <span className="text-gray-200 font-mono">{licenseInfo.monthLimit}</span> 次
              {!licenseInfo.isActivated && licenseInfo.usageCount >= licenseInfo.monthLimit && (
                <span className="text-red-400 ml-2">额度已用完，请输入序列码解锁</span>
              )}
            </p>
          </div>
        )}

        {/* License input */}
        {!licenseInfo?.isActivated && (
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              value={licenseKey}
              onChange={(e) => { setLicenseKey(e.target.value); setLicenseMsg('') }}
              placeholder="输入序列码 (格式: XXXX-XXXX-XXXX-XXXX)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono"
              onKeyDown={(e) => e.key === 'Enter' && activateLicense()}
            />
            <button
              onClick={activateLicense}
              disabled={!licenseKey.trim()}
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 transition text-sm disabled:opacity-40 shrink-0"
            >
              激活
            </button>
          </div>
        )}
        {licenseMsg && (
          <p className={`text-xs mt-2 ${licenseError ? 'text-red-400' : 'text-green-400'}`}>{licenseMsg}</p>
        )}

        {/* Machine ID */}
        {!licenseInfo?.isActivated && machineId && (
          <div className="mt-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
            <p className="text-xs text-gray-500 mb-1">本机机器码（提供给开发者以获取绑定序列码）</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-300 font-mono break-all select-all flex-1">{machineId}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(machineId); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                className="p-1 rounded hover:bg-gray-700 transition shrink-0"
                title="复制机器码"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {copied && <span className="text-xs text-green-400 shrink-0">已复制</span>}
            </div>
          </div>
        )}
        {!licenseInfo?.isActivated && (
          <p className="text-xs text-gray-600 mt-2">
            获取序列码请联系 <a href="mailto:kyl2059@qq.com" className="text-purple-400 hover:text-purple-300 underline">kyl2059@qq.com</a>
          </p>
        )}
      </div>

      {/* 下载地址 */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-3">下载地址</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-gray-500" />
            <select
              value={activeMirror}
              onChange={(e) => switchMirror(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            >
              {mirrors.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {activeMirrorId && (
            <div className="p-2 rounded bg-gray-800/50 border border-gray-700/50">
              <p className="text-xs text-gray-500 mb-1">当前下载源模型 ID</p>
              <p className="text-xs text-purple-400 break-all font-mono">{activeMirrorId}</p>
            </div>
          )}
        </div>
      </div>

      {/* 语音克隆模型 */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-3">语音克隆模型</h3>
        <div className="space-y-3">
          {models.map(m => {
            const counts = modelFileCounts[m.filename] || { base: { existing: 0, total: 6 }, aux: { existing: 0, total: 0 } }
            const baseReady = counts.base.existing === counts.base.total
            const auxReady = counts.aux.existing > 0 && counts.aux.existing === counts.aux.total
            const isDownloadingBase = downloading?.model === m.filename && downloading?.group === 'base'
            const isDownloadingAux = downloading?.model === m.filename && downloading?.group === 'aux'
            const isDownloading = isDownloadingBase || isDownloadingAux

            return (
              <div key={m.filename} className="p-3 rounded-lg bg-gray-800 border border-gray-700">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{m.name}</span>
                  <span className="text-xs text-gray-500">{m.size}</span>
                </div>
                <p className="text-xs text-gray-400 mb-1">{m.description}</p>
                <p className="text-xs text-gray-600 mb-2 font-mono truncate">{m.downloadId}</p>

                {/* Download status + buttons */}
                <div className="space-y-2">
                  {/* Base model row */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16 shrink-0">基础模型</span>
                    {isDownloadingBase ? (
                      <span className="text-xs flex items-center gap-1 text-purple-400">
                        <RefreshCw className="w-3 h-3 animate-spin" /> 下载中...
                      </span>
                    ) : baseReady ? (
                      <>
                        <span className="text-xs flex items-center gap-1 text-green-400">
                          <CheckCircle className="w-3 h-3" /> 已就绪
                        </span>
                        <button
                          onClick={() => redownloadGroup(m.filename, m.name, 'base')}
                          disabled={!!downloading}
                          className="text-xs flex items-center gap-1 px-2 py-0.5 rounded text-gray-500 hover:text-yellow-400 hover:bg-gray-700 transition disabled:opacity-40"
                          title="删除现有文件并重新下载基础模型"
                        >
                          <RotateCw className="w-3 h-3" /> 重新下载
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => downloadGroup(m.filename, m.name, 'base')}
                        disabled={!!downloading}
                        className="text-xs flex items-center gap-1 px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 transition disabled:opacity-40"
                      >
                        <Download className="w-3 h-3" /> 下载基础模型
                      </button>
                    )}
                    {counts.base.total > 0 && (
                      <span className={`text-xs ml-auto ${baseReady ? 'text-green-400' : 'text-gray-600'}`}>
                        <FileCheck className="w-3 h-3 inline mr-0.5" />
                        {counts.base.existing}/{counts.base.total} 文件
                      </span>
                    )}
                  </div>

                  {/* Aux files row */}
                  {counts.aux.total > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-16 shrink-0">辅助文件</span>
                      {isDownloadingAux ? (
                        <span className="text-xs flex items-center gap-1 text-purple-400">
                          <RefreshCw className="w-3 h-3 animate-spin" /> 下载中...
                        </span>
                      ) : auxReady ? (
                        <>
                          <span className="text-xs flex items-center gap-1 text-green-400">
                            <CheckCircle className="w-3 h-3" /> 已就绪
                          </span>
                          <button
                            onClick={() => redownloadGroup(m.filename, m.name, 'aux')}
                            disabled={!!downloading}
                            className="text-xs flex items-center gap-1 px-2 py-0.5 rounded text-gray-500 hover:text-yellow-400 hover:bg-gray-700 transition disabled:opacity-40"
                            title="删除现有文件并重新下载辅助文件"
                          >
                            <RotateCw className="w-3 h-3" /> 重新下载
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => downloadGroup(m.filename, m.name, 'aux')}
                          disabled={!!downloading || !baseReady}
                          className="text-xs flex items-center gap-1 px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 transition disabled:opacity-40"
                          title={!baseReady ? '请先下载基础模型' : '下载辅助加速文件'}
                        >
                          <Package className="w-3 h-3" /> 下载辅助文件
                        </button>
                      )}
                      {counts.aux.total > 0 && (
                        <span className={`text-xs ml-auto ${auxReady ? 'text-green-400' : 'text-gray-600'}`}>
                          <FileCheck className="w-3 h-3 inline mr-0.5" />
                          {counts.aux.existing}/{counts.aux.total} 文件
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 模型目录 */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-2">模型存储目录</h3>
        <p className="text-xs text-gray-500 mb-2">{modelsDir || '加载中...'}</p>
        <button
          onClick={() => api.openModelsDir()}
          className="text-sm flex items-center gap-2 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 transition"
        >
          <FolderOpen className="w-4 h-4" /> 打开目录
        </button>
      </div>

      <DownloadProgressModal visible={showProgress} onClose={() => setShowProgress(false)} />
    </div>
  )
}
