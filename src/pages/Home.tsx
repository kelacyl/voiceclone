import { useState, useEffect, useRef } from 'react'
import { Mic, Play, RefreshCw, AlertCircle, CheckCircle, FolderOpen, RotateCw, FileText, FolderOutput, Package, Loader2 } from 'lucide-react'

const api = window.voiceCloneAPI

type Step = 'idle' | 'ready' | 'cloning' | 'done' | 'error'

const MODEL_NAMES: Record<string, string> = {
  'Fun-CosyVoice3-0.5B-2512': 'CosyVoice3 0.5B',
  'CosyVoice2-0.5B': 'CosyVoice2 0.5B',
  'CosyVoice-300M-Instruct': 'CosyVoice 300M',
}

export default function Home() {
  const [step, setStep] = useState<Step>('idle')
  const [backendReady, setBackendReady] = useState(false)
  const [modelsOk, setModelsOk] = useState(false)
  const [modelExists, setModelExists] = useState(false)
  const [modelDir, setModelDir] = useState('')
  const [lastError, setLastError] = useState('')
  const [gpuAvailable, setGpuAvailable] = useState(false)
  const [loadingModel, setLoadingModel] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [switchingModel, setSwitchingModel] = useState(false)

  // Startup modal
  const [showStartupModal, setShowStartupModal] = useState(false)
  const [startupStage, setStartupStage] = useState<'starting' | 'loading'>('starting')
  const [startupElapsed, setStartupElapsed] = useState(0)
  const startupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [activeModel, setActiveModel] = useState('')
  const [downloadedModels, setDownloadedModels] = useState<string[]>([])

  const [refAudioPath, setRefAudioPath] = useState('')
  const [refAudioName, setRefAudioName] = useState('')
  const [promptText, setPromptText] = useState('')
  const [targetText, setTargetText] = useState('')
  const [cloneMode, setCloneMode] = useState<'zero_shot' | 'cross_lingual'>('zero_shot')

  const [textFileName, setTextFileName] = useState('')
  const [textSegmentCount, setTextSegmentCount] = useState(0)
  const [outputDir, setOutputDir] = useState('')
  const [outputDirName, setOutputDirName] = useState('')
  const [mergedPath, setMergedPath] = useState('')
  const [textSegments, setTextSegments] = useState<string[]>([])

  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => { checkStatus() }, [])

  async function checkStatus() {
    try {
      const health = await api.pythonHealth()
      setBackendReady(health.status === 'ok')

      const ms = await api.modelStatus()
      setModelsOk(ms.loaded)
      setModelExists(ms.model_exists)
      setModelDir(ms.models_dir)
      setLastError(ms.last_error || '')
      setGpuAvailable(ms.gpu_available)
      setStep(health.status === 'ok' && ms.loaded ? 'ready' : 'idle')

      await loadModelList()
    } catch {
      setBackendReady(false)
    }
  }

  async function switchModel(modelName: string) {
    if (modelName === activeModel) return
    setSwitchingModel(true)
    try {
      const result = await api.switchModel(modelName)
      if (result.success) {
        setActiveModel(modelName)
        await new Promise(r => setTimeout(r, 5000))
        await checkStatus()
      } else {
        setError(result.error || '切换模型失败')
        setStep('error')
      }
    } catch (e: any) {
      setError(e.message || '切换请求异常')
      setStep('error')
    } finally {
      setSwitchingModel(false)
    }
  }

  async function startBackend() {
    setShowStartupModal(true)
    setStartupStage('starting')
    setStartupElapsed(0)
    const result = await api.startBackend()
    if (result.success) {
      setStartupStage('loading')
      await pollUntilReady()
    } else {
      setShowStartupModal(false)
      setError(result.error || '启动失败')
      setStep('error')
    }
  }

  async function restartBackend() {
    setShowStartupModal(true)
    setStartupStage('starting')
    setStartupElapsed(0)
    const result = await api.startBackend(true)
    if (result.success) {
      setStartupStage('loading')
      await pollUntilReady()
    } else {
      setShowStartupModal(false)
      setError(result.error || '重启失败')
      setStep('error')
    }
  }

  async function pollUntilReady() {
    // Poll /models/status until model is loaded or timeout (5 min for CPU mode)
    setLoadingModel(true)
    let ready = false

    const startTime = Date.now()
    startupTimerRef.current = setInterval(() => {
      setStartupElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    const maxAttempts = 150
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const ms = await api.modelStatus()
        setBackendReady(true)
        setModelExists(ms.model_exists)
        setLastError(ms.last_error || '')
        setGpuAvailable(ms.gpu_available)
        if (ms.loaded) {
          setModelsOk(true)
          setModelDir(ms.models_dir)
          setStep('ready')
          await loadModelList()
          ready = true
          break
        }
      } catch {
        // Backend not reachable yet
      }
      await new Promise(r => setTimeout(r, 2000))
    }

    // Clean up timer and modal
    if (startupTimerRef.current) {
      clearInterval(startupTimerRef.current)
      startupTimerRef.current = null
    }
    setShowStartupModal(false)
    setLoadingModel(false)

    // On timeout, fall back to checkStatus for error display
    if (!ready) {
      await checkStatus()
    }
  }

  async function loadModelList() {
    try {
      const [models, cfg] = await Promise.all([
        api.listDownloadedModels(),
        api.getConfig(),
      ])
      setDownloadedModels(models)
      setActiveModel(cfg.voiceModel)
    } catch { /* ignore */ }
  }

  async function reloadModel() {
    setReloading(true)
    try {
      const result = await api.reloadModel()
      if (result.success) {
        await checkStatus()
      } else {
        setError(result.error || '模型重载失败，尝试重启后端')
        setStep('error')
      }
    } catch (e: any) {
      setError(e.message || '重载请求失败')
      setStep('error')
    } finally {
      setReloading(false)
    }
  }

  async function selectReference() {
    const filePath = await api.selectAudioFile()
    if (filePath) {
      setRefAudioPath(filePath)
      setRefAudioName(filePath.split(/[/\\]/).pop() || filePath)
    }
  }

  async function selectTextFile() {
    const result = await api.selectTextFile()
    if (result) {
      setTargetText(result.content)
      setTextFileName(result.path.split(/[/\\]/).pop() || result.path)
      // 估算分段数：按中文标点切分
      const estimated = result.content.split(/[。！？；\n\.\!\?\;]/).filter(s => s.trim()).length
      setTextSegmentCount(estimated)
    }
  }

  async function selectOutputDir() {
    const dir = await api.selectOutputDir()
    if (dir) {
      setOutputDir(dir)
      setOutputDirName(dir.split(/[/\\]/).pop() || dir)
    }
  }

  async function startClone() {
    if (!targetText.trim() || !refAudioPath) return
    setStep('cloning')
    setError('')
    setMergedPath('')
    setTextSegments([])
    try {
      const result = await api.cloneVoice({
        mode: cloneMode,
        text: targetText.trim(),
        prompt_text: promptText.trim() || undefined,
        prompt_audio: refAudioPath,
        stream: false,
        split_text: true,
        output_dir: outputDir || undefined,
      })
      if (result.success) {
        setOutputPaths(result.output_paths || [])
        setMergedPath(result.merged_path || '')
        setTextSegments(result.text_segments || [])
        setElapsed(result.elapsed || 0)
        setDuration(result.duration || 0)
        setStep('done')
      } else {
        setError(result.error || '克隆失败')
        setStep('error')
      }
    } catch (err: any) {
      setError(err.message || '请求异常')
      setStep('error')
    }
  }

  return (
    <>
    <div className="max-w-2xl mx-auto p-6">
      {/* 状态栏 */}
      <div className="flex items-center gap-4 mb-6 p-3 rounded-lg bg-gray-900 border border-gray-800">
        <StatusDot ok={backendReady} label="后端" />
        <StatusDot ok={modelsOk} label="模型" />
        {modelExists && !modelsOk && <span className="text-xs text-yellow-400">文件就绪</span>}
        {gpuAvailable && <span className="text-xs px-2 py-0.5 rounded bg-green-900 text-green-300">GPU</span>}

        {/* 模型选择器 */}
        {downloadedModels.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-gray-500" />
            <select
              value={activeModel}
              onChange={(e) => switchModel(e.target.value)}
              disabled={switchingModel || step === 'cloning'}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500 disabled:opacity-40 max-w-[180px] truncate"
            >
              {downloadedModels.map(m => (
                <option key={m} value={m}>{MODEL_NAMES[m] || m}</option>
              ))}
            </select>
            {switchingModel && <RefreshCw className="w-3 h-3 animate-spin text-purple-400" />}
          </div>
        )}

        <div className="flex-1" />
        {!backendReady && (
          <button onClick={startBackend} className="text-xs px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 transition">
            启动后端
          </button>
        )}
        {backendReady && !modelsOk && modelExists && (
          <button onClick={reloadModel} disabled={reloading} className="text-xs px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 transition disabled:opacity-50 flex items-center gap-1">
            <RotateCw className={`w-3 h-3 ${reloading ? 'animate-spin' : ''}`} /> 加载模型
          </button>
        )}
        {backendReady && !modelsOk && (
          <button onClick={restartBackend} className="text-xs px-2 py-1 rounded bg-yellow-700 hover:bg-yellow-600 transition">
            重启后端
          </button>
        )}
        <button onClick={checkStatus} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
      </div>

      {/* 未就绪 */}
      {!modelsOk && (
        <div className="text-center py-12 space-y-4">
          <p className="text-gray-400">
            {!backendReady ? 'Python 后端未启动，请点击下方按钮启动' : ''}
            {backendReady && !modelExists ? `模型 "${MODEL_NAMES[activeModel] || activeModel}" 尚未下载，请前往设置页下载` : ''}
            {backendReady && modelExists && loadingModel ? (
              <span className="flex items-center justify-center gap-2">
                <RotateCw className="w-4 h-4 animate-spin" />
                模型加载中...
              </span>
            ) : backendReady && modelExists ? `模型 "${MODEL_NAMES[activeModel] || activeModel}" 加载失败` : ''}
          </p>
          {lastError && !loadingModel && (
            <div className="p-3 rounded bg-red-900/30 border border-red-800 text-left max-w-lg mx-auto">
              <p className="text-xs text-red-400 mb-1 font-medium">错误详情:</p>
              <pre className="text-xs text-red-300 whitespace-pre-wrap break-all">{lastError}</pre>
            </div>
          )}
          {!backendReady && (
            <button onClick={startBackend} className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 transition font-medium">
              启动 CosyVoice 服务
            </button>
          )}
          {backendReady && modelExists && !loadingModel && (
            <button onClick={reloadModel} disabled={reloading} className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium disabled:opacity-50">
              <RotateCw className={`w-4 h-4 inline mr-2 ${reloading ? 'animate-spin' : ''}`} />
              {reloading ? '加载中...' : '重新加载模型'}
            </button>
          )}
          {backendReady && !modelExists && (
            <p className="text-sm text-yellow-400">请前往设置页下载模型文件</p>
          )}
          <button onClick={() => api.openModelsDir()} className="block mx-auto text-sm px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 transition">
            <FolderOpen className="w-4 h-4 inline mr-2" />打开模型目录
          </button>
        </div>
      )}

      {/* 主界面 */}
      {modelsOk && (
        <div className="space-y-5">
          {/* 参考音频 */}
          <Card label="参考音频（3-10 秒，用于提取音色）">
            <div className="flex items-center gap-3">
              <button onClick={selectReference} className="flex items-center gap-2 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 transition text-sm">
                <Mic className="w-4 h-4" /> 选择音频文件
              </button>
              {refAudioName && <span className="text-sm text-purple-400 truncate max-w-xs">{refAudioName}</span>}
            </div>
            <input
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="参考音频对应文本（可选，推荐填写以提升效果）"
              className="mt-3 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </Card>

          {/* 克隆模式 */}
          <div className="flex gap-2">
            {(['zero_shot', 'cross_lingual'] as const).map(m => (
              <button
                key={m}
                onClick={() => setCloneMode(m)}
                className={`px-4 py-1.5 rounded text-sm transition ${
                  cloneMode === m
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {m === 'zero_shot' ? '零样本克隆' : '跨语种合成'}
              </button>
            ))}
          </div>

          {/* 目标文本 */}
          <Card label="要合成的文本">
            <div className="flex items-center gap-2 mb-3">
              <button onClick={selectTextFile} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 transition text-xs">
                <FileText className="w-3.5 h-3.5" /> 从 txt 文件导入
              </button>
              {textFileName && (
                <span className="text-xs text-cyan-400 truncate max-w-[180px]">{textFileName}</span>
              )}
              {textSegmentCount > 0 && (
                <span className="text-xs text-gray-500 ml-auto">
                  约 {textSegmentCount} 段
                </span>
              )}
            </div>
            <textarea
              value={targetText}
              onChange={(e) => {
                setTargetText(e.target.value)
                setTextFileName('')
                setTextSegmentCount(0)
              }}
              placeholder="输入要克隆朗读的文本内容，或点击上方按钮从 txt 文件导入。长文本将自动按语句拆分。"
              rows={5}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </Card>

          {/* 输出目录 */}
          <Card label="输出目录（可选，不选则仅返回临时路径）">
            <div className="flex items-center gap-3">
              <button onClick={selectOutputDir} className="flex items-center gap-2 px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 transition text-sm">
                <FolderOutput className="w-4 h-4" /> 选择保存目录
              </button>
              {outputDirName && <span className="text-sm text-green-400 truncate max-w-xs">{outputDirName}</span>}
            </div>
          </Card>

          {/* 克隆按钮 */}
          <button
            onClick={startClone}
            disabled={step === 'cloning' || !targetText.trim() || !refAudioPath}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 transition font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {step === 'cloning' ? (
              <><RefreshCw className="w-5 h-5 animate-spin" /> 正在生成...</>
            ) : (
              <><Play className="w-5 h-5" /> 开始克隆</>
            )}
          </button>

          {/* 结果 */}
          {step === 'done' && (
            <Card label="">
              <div className="flex items-center gap-2 text-green-400 mb-2">
                <CheckCircle className="w-4 h-4" /><span className="font-medium">克隆完成</span>
              </div>
              <p className="text-sm text-gray-400 mb-2">
                {duration.toFixed(1)}s 音频 / {elapsed.toFixed(1)}s 耗时 / RTF: {(elapsed / duration).toFixed(2)}
                {textSegments.length > 0 && (
                  <span className="ml-2">/ {textSegments.length} 个文本片段</span>
                )}
              </p>

              {/* 合并后的输出 */}
              {mergedPath && (
                <div className="mb-3 p-3 rounded bg-green-900/20 border border-green-800">
                  <p className="text-xs text-green-400 mb-1">已保存到:</p>
                  <p className="text-xs text-green-300 font-mono break-all">{mergedPath}</p>
                  <audio controls className="w-full mt-2" src={`file://${mergedPath}`} />
                </div>
              )}

              {/* 文本片段预览 */}
              {textSegments.length > 0 && (
                <details className="mb-3">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    文本分段预览 ({textSegments.length} 段)
                  </summary>
                  <div className="mt-2 max-h-32 overflow-auto text-xs text-gray-400 space-y-1">
                    {textSegments.map((s, i) => (
                      <p key={i} className="px-2 py-0.5 rounded bg-gray-800/50">
                        <span className="text-gray-600">[{i + 1}]</span> {s}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              {/* 各段音频（无合并时展示） */}
              {!mergedPath && outputPaths.map((p, i) => (
                <div key={i} className="mb-2">
                  <p className="text-xs text-gray-500 mb-1">片段 {i + 1}</p>
                  <audio controls className="w-full" src={`file://${p}`} />
                </div>
              ))}
            </Card>
          )}

          {/* 错误 */}
          {step === 'error' && (
            <Card label="">
              <div className="flex items-center gap-2 text-red-400 mb-2">
                <AlertCircle className="w-4 h-4" /><span className="font-medium">生成失败</span>
              </div>
              <p className="text-sm text-red-300 whitespace-pre-wrap">{error}</p>
              <button onClick={() => { setStep('ready'); setError('') }} className="mt-3 text-sm px-4 py-1 rounded bg-gray-700 hover:bg-gray-600 transition">
                重试
              </button>
            </Card>
          )}
        </div>
      )}
    </div>

      {/* 启动加载弹窗 */}
      {showStartupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto mb-4" />
            <p className="text-gray-200 font-medium text-lg mb-2">
              {startupStage === 'starting' ? '正在启动 Python 后端...' : '正在加载模型...'}
            </p>
            {startupStage === 'loading' && (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  模型加载中，首次加载可能需要较长时间（CPU 模式下大型模型约需 1-3 分钟），请耐心等待
                </p>
                <p className="text-xs text-gray-600">
                  已等待 <span className="text-gray-400 font-mono">{startupElapsed}</span> 秒
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? <CheckCircle className="w-4 h-4 text-green-400" /> : <AlertCircle className="w-4 h-4 text-yellow-400" />}
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
      {label && <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>}
      {children}
    </div>
  )
}
