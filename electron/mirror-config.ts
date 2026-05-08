/**
 * Mirror configuration — CosyVoice model download sources.
 * Supports ModelScope SDK and HuggingFace (via HF-Mirror) for model downloads.
 */
import { getConfigValue } from './db'

// ─── Mirror definitions ──────────────────────────────────────────

export interface MirrorDef {
  id: string
  name: string
  description: string
}

export const MIRRORS: MirrorDef[] = [
  {
    id: 'modelscope',
    name: 'ModelScope 魔搭社区',
    description: '阿里云魔搭社区，CosyVoice3-0.5B 官方发布源',
  },
  {
    id: 'hf-mirror',
    name: 'HF-Mirror (HuggingFace 镜像)',
    description: 'HuggingFace 国内镜像站，CosyVoice3-0.5B-2512 代理下载',
  },
]

export const DEFAULT_MIRROR = 'modelscope'

export function getActiveMirror(): string {
  return getConfigValue('model_mirror') || DEFAULT_MIRROR
}

// ─── CosyVoice model definitions ─────────────────────────────────

interface RawModelDef {
  /** Local directory name for the downloaded model */
  filename: string
  /** Display name */
  name: string
  /** Approximate download size */
  size: string
  /** Description */
  description: string
  /** Download IDs per mirror source.
   *  - modelscope: ModelScope model ID for modelscope.snapshot_download()
   *  - hf-mirror: HuggingFace repo ID for huggingface_hub.snapshot_download() */
  sources: Record<string, string>
  /** Web page URL for more info */
  webUrl?: string
  /** Essential files required for model inference */
  baseFiles: string[]
  /** Optional accelerator/auxiliary files */
  auxFiles: string[]
  /** Directories to download (for base group only, e.g. CosyVoice-BlankEN/) */
  baseDirs: string[]
}

const COSYVOICE_MODEL_DEFS: RawModelDef[] = [
  {
    filename: 'Fun-CosyVoice3-0.5B-2512',
    name: 'CosyVoice3 0.5B (推荐)',
    size: '~7.5 GB',
    description: 'CosyVoice3 零样本语音克隆模型，0.5B 参数。支持中英日粤韩等 9 种语言、18+ 中文方言。需要 CUDA GPU，约 4GB 显存。',
    webUrl: 'https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    sources: {
      'modelscope': 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
      'hf-mirror': 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    },
    baseFiles: ['cosyvoice3.yaml', 'campplus.onnx', 'speech_tokenizer_v3.onnx', 'llm.pt', 'flow.pt', 'hift.pt'],
    auxFiles: ['llm.rl.pt', 'speech_tokenizer_v3.batch.onnx', 'flow.decoder.estimator.fp32.onnx'],
    baseDirs: ['CosyVoice-BlankEN'],
  },
  {
    filename: 'CosyVoice2-0.5B',
    name: 'CosyVoice2 0.5B',
    size: '~5.0 GB',
    description: 'CosyVoice2 零样本语音克隆模型，0.5B 参数。支持流式输出，轻量于 CosyVoice3。',
    webUrl: 'https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B',
    sources: {
      'modelscope': 'iic/CosyVoice2-0.5B',
      'hf-mirror': 'FunAudioLLM/CosyVoice2-0.5B',
    },
    baseFiles: ['cosyvoice2.yaml', 'campplus.onnx', 'speech_tokenizer_v2.onnx', 'llm.pt', 'flow.pt', 'hift.pt'],
    auxFiles: ['flow.cache.pt', 'flow.decoder.estimator.fp32.onnx', 'flow.encoder.fp16.zip', 'flow.encoder.fp32.zip', 'speech_tokenizer_v2.batch.onnx'],
    baseDirs: ['CosyVoice-BlankEN'],
  },
  {
    filename: 'CosyVoice-300M-Instruct',
    name: 'CosyVoice 300M Instruct (轻量)',
    size: '~2.0 GB',
    description: 'CosyVoice 300M 指令微调版，支持情感控制。适合低配 GPU（2GB 显存），效果略低于 0.5B 版本。',
    webUrl: 'https://huggingface.co/FunAudioLLM/CosyVoice-300M-Instruct',
    sources: {
      'modelscope': 'iic/CosyVoice-300M-Instruct',
      'hf-mirror': 'FunAudioLLM/CosyVoice-300M-Instruct',
    },
    baseFiles: ['cosyvoice.yaml', 'campplus.onnx', 'speech_tokenizer_v1.onnx', 'llm.pt', 'flow.pt', 'hift.pt'],
    auxFiles: ['flow.decoder.estimator.fp32.onnx', 'flow.encoder.fp16.zip', 'flow.encoder.fp32.zip', 'llm.llm.fp16.zip', 'llm.llm.fp32.zip', 'llm.text_encoder.fp16.zip', 'llm.text_encoder.fp32.zip'],
    baseDirs: [],
  },
]

// ─── URL / ID resolution ─────────────────────────────────────────

function resolveSourceId(sources: Record<string, string>, preferredMirror: string): string {
  if (sources[preferredMirror]) return sources[preferredMirror]
  for (const id of ['modelscope', 'hf-mirror']) {
    if (sources[id]) return sources[id]
  }
  return ''
}

// ─── Public API ───────────────────────────────────────────────────

export interface ModelSource {
  filename: string
  name: string
  size: string
  description: string
  /** Download ID for the currently active mirror (modelscope model ID or HF repo ID) */
  downloadId: string
  /** Web page for model info */
  webUrl?: string
  /** Mirror IDs → download IDs */
  allSources: Record<string, string>
}

export function getResolvedCosyVoiceModels(): ModelSource[] {
  const mirror = getActiveMirror()
  return COSYVOICE_MODEL_DEFS.map((m) => ({
    filename: m.filename,
    name: m.name,
    size: m.size,
    description: m.description,
    downloadId: resolveSourceId(m.sources, mirror),
    webUrl: m.webUrl,
    allSources: { ...m.sources },
  }))
}

export function getModelAllUrls(filename: string): Record<string, string> {
  const m = COSYVOICE_MODEL_DEFS.find((d) => d.filename === filename)
  return m ? { ...m.sources } : {}
}

/** Get the download ID for a specific model + mirror combination. */
export function getModelDownloadId(filename: string, mirror: string): string {
  const m = COSYVOICE_MODEL_DEFS.find((d) => d.filename === filename)
  if (!m) return ''
  if (m.sources[mirror]) return m.sources[mirror]
  return resolveSourceId(m.sources, mirror)
}

export interface ModelFileGroups {
  baseFiles: string[]
  auxFiles: string[]
  baseDirs: string[]
}

/** Get file groups (base/aux/dirs) for a specific model. */
export function getModelFileGroups(filename: string): ModelFileGroups | null {
  const m = COSYVOICE_MODEL_DEFS.find((d) => d.filename === filename)
  if (!m) return null
  return { baseFiles: [...m.baseFiles], auxFiles: [...m.auxFiles], baseDirs: [...m.baseDirs] }
}
