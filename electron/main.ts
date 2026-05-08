import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import http from 'http'
import { getConfigValue, setConfigValue } from './db'
import { downloadModelFilesViaPython, getDownloadProgress, isModelValid, deleteModelDir, countExistingFiles, deleteFilesInDir } from './download-manager'
import { MIRRORS, getActiveMirror, getResolvedCosyVoiceModels, getModelAllUrls, getModelDownloadId, getModelFileGroups } from './mirror-config'

let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null
const PYTHON_PORT = 9876
const PYTHON_HOST = '127.0.0.1'

// ─── Paths ──────────────────────────────────────────────────────────

function getPythonDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python-backend')
  }
  return path.join(__dirname, '..', '..', 'python')
}

function getModelsDir(): string {
  const dir = path.join(app.getPath('userData'), 'cosyvoice-models')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getPythonExePath(): string {
  if (app.isPackaged) {
    // PyInstaller onedir output
    const exe = path.join(process.resourcesPath, 'python-backend', 'cosyvoice-service.exe')
    if (fs.existsSync(exe)) return exe
    // PyInstaller onefile output (fallback)
    const exe2 = path.join(process.resourcesPath, 'python-backend', 'cosyvoice-service.exe')
    return exe2
  }
  return 'python'
}

// ─── Python 后端管理 ──────────────────────────────────────────────────

function startPythonBackend(force = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pythonProcess) {
      if (!force) { resolve(); return }
      pythonProcess.kill('SIGTERM')
      pythonProcess = null
      // Brief pause to let the old process release its port
      setTimeout(() => spawnBackend(resolve, reject), 500)
      return
    }
    spawnBackend(resolve, reject)
  })
}

function spawnBackend(resolve: (v: void) => void, reject: (e: Error) => void) {
  const voiceModel = getConfigValue('voice_model') || 'Fun-CosyVoice3-0.5B-2512'
  const modelDir = path.join(getModelsDir(), voiceModel)
  const pythonExe = getPythonExePath()
  const isPackaged = app.isPackaged

  let cmd: string
  let args: string[]

  if (isPackaged && pythonExe.endsWith('.exe')) {
    // PyInstaller 打包模式：直接运行 exe
    cmd = pythonExe
    args = []
    console.log(`Starting bundled backend: ${cmd}`)
  } else {
    // 开发模式：python 运行脚本
    const scriptPath = path.join(getPythonDir(), 'cosyvoice_service.py')
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Python 服务脚本不存在: ${scriptPath}`))
      return
    }
    cmd = pythonExe
    args = [scriptPath]
    console.log(`Starting dev backend: ${cmd} ${args.join(' ')}`)
  }

  pythonProcess = spawn(cmd, args, {
    env: {
      ...process.env,
      COSYVOICE_MODELS_DIR: modelDir,
      COSYVOICE_HOST: PYTHON_HOST,
      COSYVOICE_PORT: String(PYTHON_PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Python] ${data.toString().trim()}`)
  })
  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[Python:err] ${data.toString().trim()}`)
  })
  pythonProcess.on('error', (err) => { pythonProcess = null; reject(err) })
  pythonProcess.on('exit', (code) => {
    console.log(`Python exited with code ${code}`)
    pythonProcess = null
  })

  // Poll until healthy
  let attempts = 0
  const check = () => {
    attempts++
    http.get(`http://${PYTHON_HOST}:${PYTHON_PORT}/health`, (res) => {
      if (res.statusCode === 200) { console.log('Python backend ready'); resolve() }
      else if (attempts < 30) setTimeout(check, 500)
      else reject(new Error('Backend start failed'))
    }).on('error', () => {
      if (attempts < 30) setTimeout(check, 500)
      else reject(new Error('Backend timeout'))
    })
  }
  setTimeout(check, 1000)
}

function stopPythonBackend(): void {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────

function pythonRequest(endpoint: string, method = 'GET', body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: PYTHON_HOST, port: PYTHON_PORT,
      path: endpoint, method,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => data += c.toString())
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.setTimeout(600000, () => { req.destroy(); reject(new Error('请求超时')) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ─── Window ───────────────────────────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100, height: 750,
    minWidth: 800, minHeight: 550,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, '../../dist-electron/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(() => { createMainWindow() })
app.on('before-quit', () => stopPythonBackend())
app.on('window-all-closed', () => { stopPythonBackend(); if (process.platform !== 'darwin') app.quit() })

// ─── IPC: Python backend ─────────────────────────────────────────────

ipcMain.handle('python-health', async () => {
  try { return await pythonRequest('/health') } catch {
    return { status: 'error', message: 'Python 后端未运行' }
  }
})

ipcMain.handle('model-status', async () => {
  try {
    return await pythonRequest('/models/status')
  } catch {
    const voiceModel = getConfigValue('voice_model') || 'Fun-CosyVoice3-0.5B-2512'
    const modelDir = path.join(getModelsDir(), voiceModel)
    return { loaded: false, models_dir: modelDir, model_exists: isModelValid(modelDir), gpu_available: false }
  }
})

ipcMain.handle('start-backend', async (_, force = false) => {
  try { await startPythonBackend(force); return { success: true } } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('reload-model', async () => {
  try {
    const result = await pythonRequest('/models/reload', 'POST')
    // FastAPI 返回错误时 body 为 { detail: "..." }，没有 success 字段
    if (result.detail) {
      return { success: false, error: result.detail }
    }
    return result
  } catch (e: any) {
    return { success: false, error: e.message || '模型重载失败' }
  }
})

ipcMain.handle('clone-voice', async (_, req: {
  mode: string; text: string; prompt_text?: string
  prompt_audio: string; instruct_text?: string; stream?: boolean
}) => {
  try { return await pythonRequest('/clone', 'POST', req) } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ─── IPC: File / Path ────────────────────────────────────────────────

ipcMain.handle('get-models-dir', async () => getModelsDir())
ipcMain.handle('open-models-dir', async () => shell.openPath(getModelsDir()))

ipcMain.handle('check-model-exists', async (_, filename: string) => {
  return isModelValid(path.join(getModelsDir(), filename))
})

ipcMain.handle('delete-model', async (_, filename: string) => {
  const modelPath = path.join(getModelsDir(), filename)
  if (!fs.existsSync(modelPath)) return true
  return deleteModelDir(modelPath)
})

ipcMain.handle('select-audio-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    title: '选择参考音频',
    filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }],
    properties: ['openFile'],
  })
  return r.filePaths[0] || null
})

ipcMain.handle('select-text-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    title: '选择文本文件',
    filters: [{ name: '文本文件', extensions: ['txt'] }],
    properties: ['openFile'],
  })
  if (!r.filePaths[0]) return null
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf-8') }
})

ipcMain.handle('select-output-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
  return r.filePaths[0] || null
})

ipcMain.handle('get-app-version', async () => app.getVersion())

// ─── IPC: Models ──────────────────────────────────────────────────────

ipcMain.handle('list-downloaded-models', async () => {
  const dir = getModelsDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && isModelValid(path.join(dir, d.name)))
    .map(d => d.name)
})

ipcMain.handle('switch-model', async (_, modelName: string) => {
  const modelDir = path.join(getModelsDir(), modelName)
  if (!isModelValid(modelDir)) {
    return { success: false, error: `模型 ${modelName} 文件不完整` }
  }
  setConfigValue('voice_model', modelName)
  // 重启后端以加载新模型
  try {
    await startPythonBackend(true)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ─── IPC: Config ─────────────────────────────────────────────────────

ipcMain.handle('get-config', async () => {
  const voiceModel = getConfigValue('voice_model') || 'Fun-CosyVoice3-0.5B-2512'
  return {
    voiceModel,
    modelMirror: getConfigValue('model_mirror') || 'modelscope',
  }
})

ipcMain.handle('set-config', async (_, config: Record<string, string>) => {
  for (const [key, value] of Object.entries(config)) {
    setConfigValue(key, value)
  }
})

// ─── IPC: Model download ─────────────────────────────────────────────

ipcMain.handle('get-recommended-models', async () => getResolvedCosyVoiceModels())

ipcMain.handle('download-model', async (_, modelId: string, modelName: string, group: string) => {
  try {
    const mirror = getActiveMirror()
    const downloadId = getModelDownloadId(modelId, mirror)
    if (!downloadId) {
      return { success: false, error: `模型 ${modelId} 在当前镜像源中不可用` }
    }
    const fileGroups = getModelFileGroups(modelId)
    if (!fileGroups) {
      return { success: false, error: `未找到模型 ${modelId} 的文件分组配置` }
    }
    const dest = await downloadModelFilesViaPython(
      downloadId, mirror, getModelsDir(),
      fileGroups.baseFiles, fileGroups.auxFiles, fileGroups.baseDirs,
      modelId, modelName, group as 'base' | 'aux',
    )
    return { success: true, path: dest }
  } catch (e: any) {
    return { success: false, error: e.message || '下载失败' }
  }
})

ipcMain.handle('get-model-file-counts', async (_, filename: string) => {
  const modelDir = path.join(getModelsDir(), filename)
  const fileGroups = getModelFileGroups(filename)
  if (!fileGroups) {
    return { base: { existing: 0, total: 0 }, aux: { existing: 0, total: 0 } }
  }
  return countExistingFiles(modelDir, fileGroups.baseFiles, fileGroups.auxFiles)
})

ipcMain.handle('delete-model-group', async (_, filename: string, group: string) => {
  const modelDir = path.join(getModelsDir(), filename)
  const fileGroups = getModelFileGroups(filename)
  if (!fileGroups) return false
  if (group === 'base') {
    // Delete base files + dirs
    const files = [...fileGroups.baseFiles, ...fileGroups.baseDirs]
    deleteFilesInDir(modelDir, files)
    // Also delete base directories recursively
    for (const d of fileGroups.baseDirs) {
      deleteModelDir(path.join(modelDir, d))
    }
  } else {
    deleteFilesInDir(modelDir, fileGroups.auxFiles)
  }
  return true
})

ipcMain.handle('get-download-progress', async (_, id: string) => getDownloadProgress(id) || null)

// ─── IPC: Mirrors ────────────────────────────────────────────────────

ipcMain.handle('get-mirrors', async () => MIRRORS)
ipcMain.handle('get-active-mirror', async () => getActiveMirror())
ipcMain.handle('set-active-mirror', async (_, mirrorId: string) => {
  setConfigValue('model_mirror', mirrorId)
})
ipcMain.handle('get-model-all-urls', async (_, filename: string) => getModelAllUrls(filename))
