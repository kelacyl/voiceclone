import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('voiceCloneAPI', {
  // Python 后端
  pythonHealth: () => ipcRenderer.invoke('python-health'),
  modelStatus: () => ipcRenderer.invoke('model-status'),
  startBackend: (force?: boolean) => ipcRenderer.invoke('start-backend', force),
  reloadModel: () => ipcRenderer.invoke('reload-model'),

  // 语音克隆
  cloneVoice: (req: {
    mode: string
    text: string
    prompt_text?: string
    prompt_audio: string
    instruct_text?: string
    stream?: boolean
  }) => ipcRenderer.invoke('clone-voice', req),

  // 文件操作
  getModelsDir: () => ipcRenderer.invoke('get-models-dir'),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  selectTextFile: () => ipcRenderer.invoke('select-text-file'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  openModelsDir: () => ipcRenderer.invoke('open-models-dir'),
  checkModelExists: (filename: string) => ipcRenderer.invoke('check-model-exists', filename),
  deleteModel: (filename: string) => ipcRenderer.invoke('delete-model', filename),

  // 配置 & 模型切换
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config: Record<string, string>) => ipcRenderer.invoke('set-config', config),
  listDownloadedModels: () => ipcRenderer.invoke('list-downloaded-models'),
  switchModel: (modelName: string) => ipcRenderer.invoke('switch-model', modelName),

  // 模型下载
  getRecommendedModels: () => ipcRenderer.invoke('get-recommended-models'),
  downloadModel: (modelId: string, modelName: string, group: string) => ipcRenderer.invoke('download-model', modelId, modelName, group),
  getModelFileCounts: (filename: string) => ipcRenderer.invoke('get-model-file-counts', filename),
  deleteModelGroup: (filename: string, group: string) => ipcRenderer.invoke('delete-model-group', filename, group),
  getDownloadProgress: (id: string) => ipcRenderer.invoke('get-download-progress', id),

  // 下载进度监听 (主进程 -> 渲染进程)
  onDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('download-progress', (_, progress) => callback(progress))
  },

  // 镜像
  getMirrors: () => ipcRenderer.invoke('get-mirrors'),
  getActiveMirror: () => ipcRenderer.invoke('get-active-mirror'),
  setActiveMirror: (mirrorId: string) => ipcRenderer.invoke('set-active-mirror', mirrorId),
  getModelAllUrls: (filename: string) => ipcRenderer.invoke('get-model-all-urls', filename),

  // 版本
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 序列码激活
  validateLicense: (key: string) => ipcRenderer.invoke('validate-license', key),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  incrementUsage: () => ipcRenderer.invoke('increment-usage'),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
})
