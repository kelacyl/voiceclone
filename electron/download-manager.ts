/**
 * Download manager — handles in-app model downloads with progress events.
 *
 * Supports file-level downloads via ModelScope SDK and HuggingFace (HF-Mirror).
 * Downloads are split into base (essential) and aux (optional) groups.
 * Each file is checked locally before download to avoid re-downloading.
 */
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

export interface DownloadProgress {
  id: string
  filename: string
  url: string
  status: 'idle' | 'downloading' | 'completed' | 'error'
  progress: number
  downloadedBytes: number
  totalBytes: number
  speed: string
  eta: string
  error?: string
}

const activeDownloads = new Map<string, DownloadProgress>()

function broadcastProgress(progress: DownloadProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('download-progress', progress)
    }
  }
}

// ─── Model integrity check ──────────────────────────────────────────

/** Files that MUST exist for each CosyVoice version.
 *  spk2info.pt is auto-generated at first run, NOT required in the download. */
const REQUIRED_FILES_BY_VERSION: Record<string, string[]> = {
  cosyvoice: ['llm.pt', 'flow.pt', 'hift.pt', 'campplus.onnx', 'speech_tokenizer_v1.onnx'],
  cosyvoice2: ['llm.pt', 'flow.pt', 'hift.pt', 'campplus.onnx', 'speech_tokenizer_v2.onnx'],
  cosyvoice3: ['llm.pt', 'flow.pt', 'hift.pt', 'campplus.onnx', 'speech_tokenizer_v3.onnx'],
}

/** Check if a model directory contains all essential files (not just the yaml). */
export function isModelValid(modelDir: string): boolean {
  if (!fs.existsSync(modelDir)) return false

  for (const [yaml, required] of Object.entries(REQUIRED_FILES_BY_VERSION)) {
    const yamlPath = path.join(modelDir, `${yaml}.yaml`)
    if (!fs.existsSync(yamlPath)) continue

    for (const file of required) {
      if (!fs.existsSync(path.join(modelDir, file))) return false
    }
    if (yaml !== 'cosyvoice' && !fs.existsSync(path.join(modelDir, 'CosyVoice-BlankEN'))) {
      return false
    }
    return true
  }
  return false
}

/** Check if a model directory seems partially downloaded (has yaml but missing essential files). */
export function isModelBroken(modelDir: string): boolean {
  if (!fs.existsSync(modelDir)) return false

  for (const yaml of ['cosyvoice.yaml', 'cosyvoice2.yaml', 'cosyvoice3.yaml']) {
    if (fs.existsSync(path.join(modelDir, yaml))) {
      return !isModelValid(modelDir)
    }
  }
  return false
}

/** Delete a model directory entirely. Returns true on success. */
export function deleteModelDir(modelDir: string): boolean {
  if (!fs.existsSync(modelDir)) return true
  try {
    fs.rmSync(modelDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// ─── HTTP download (via Python backend) ────────────────────────────

const BACKEND_HOST = '127.0.0.1'
const BACKEND_PORT = 9876

function backendRequest(endpoint: string, method = 'GET', body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const http = require('http')
    const req = http.request({
      hostname: BACKEND_HOST, port: BACKEND_PORT,
      path: endpoint, method,
      headers: { 'Content-Type': 'application/json' },
    }, (res: any) => {
      let data = ''
      res.on('data', (c: string) => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('请求超时')) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ─── Main download API ─────────────────────────────────────────────

export async function downloadModelFilesViaPython(
  modelId: string,
  mirror: string,
  destDir: string,
  baseFiles: string[],
  auxFiles: string[],
  baseDirs: string[],
  localName: string,
  modelName: string,
  group: 'base' | 'aux',
): Promise<string> {
  const modelDest = path.join(destDir, localName)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

  const files = group === 'base' ? [...baseFiles] : [...auxFiles]
  const dirs = group === 'base' ? [...baseDirs] : []

  // Filter: skip files and dirs that already exist locally
  const pendingFiles = files.filter(f => !fs.existsSync(path.join(modelDest, f)))
  const pendingDirs = dirs.filter(d => {
    const dirPath = path.join(modelDest, d)
    return !fs.existsSync(dirPath) || fs.readdirSync(dirPath).length === 0
  })

  const groupId = `${localName}-${group}`
  const totalTasks = pendingFiles.length + pendingDirs.length

  if (totalTasks === 0) {
    broadcastProgress({
      id: groupId, filename: modelName, url: `${mirror}:${modelId}`,
      status: 'completed', progress: 100,
      downloadedBytes: 0, totalBytes: 0,
      speed: '0 B/s', eta: '已完成',
    })
    return modelDest
  }

  // Start download via HTTP backend
  const progress: DownloadProgress = {
    id: groupId, filename: modelName, url: `${mirror}:${modelId}`,
    status: 'downloading', progress: 0,
    downloadedBytes: 0, totalBytes: 0,
    speed: '初始化...', eta: '计算中...',
  }
  activeDownloads.set(groupId, progress)
  broadcastProgress({ ...progress })

  try {
    const { task_id } = await backendRequest('/download/start', 'POST', {
      download_id: modelId,
      mirror,
      dest_dir: destDir,
      files: pendingFiles,
      dirs: pendingDirs,
      local_name: localName,
    })

    // Poll until done
    while (true) {
      await new Promise(r => setTimeout(r, 1000))
      const status = await backendRequest(`/download/status/${task_id}`)

      if (status.status === 'downloading') {
        progress.progress = status.progress || 0
        progress.speed = status.current ? `下载 ${status.current}` : '下载中...'
        progress.eta = `${status.completed || 0}/${status.total || totalTasks}`
        broadcastProgress({ ...progress })
      } else if (status.status === 'completed') {
        progress.progress = 100
        progress.status = 'completed'
        progress.eta = '已完成'
        progress.speed = `已下载 ${totalTasks} 个文件`
        broadcastProgress({ ...progress })
        activeDownloads.delete(groupId)

        // Verify integrity for base group
        if (group === 'base' && !isModelValid(modelDest)) {
          throw new Error('下载完成但基础模型文件不完整，请重试')
        }
        return modelDest
      } else if (status.status === 'error') {
        throw new Error(status.error || '下载失败')
      }
    }
  } catch (err: any) {
    progress.status = 'error'
    progress.error = err.message
    broadcastProgress({ ...progress })
    activeDownloads.delete(groupId)
    throw err
  }
}

export function getDownloadProgress(id: string): DownloadProgress | null {
  return activeDownloads.get(id) || null
}

/** Delete specified files from a directory. Returns count of deleted files. */
export function deleteFilesInDir(dir: string, files: string[]): number {
  let deleted = 0
  for (const f of files) {
    const p = path.join(dir, f)
    if (fs.existsSync(p)) {
      try { fs.rmSync(p); deleted++ } catch { /* skip locked files */ }
    }
  }
  return deleted
}

/** Count existing files in a model directory. */

export function countExistingFiles(
  modelDir: string,
  baseFiles: string[],
  auxFiles: string[],
): { base: { existing: number; total: number }; aux: { existing: number; total: number } } {
  let baseExisting = 0
  let auxExisting = 0

  for (const f of baseFiles) {
    if (fs.existsSync(path.join(modelDir, f))) baseExisting++
  }
  for (const f of auxFiles) {
    if (fs.existsSync(path.join(modelDir, f))) auxExisting++
  }

  return {
    base: { existing: baseExisting, total: baseFiles.length },
    aux: { existing: auxExisting, total: auxFiles.length },
  }
}
