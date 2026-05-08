export {}

declare global {
  interface ModelInfo {
    filename: string
    name: string
    size: string
    description: string
    downloadId: string
    webUrl?: string
    allSources: Record<string, string>
  }

  interface MirrorInfo {
    id: string
    name: string
    description: string
  }

  interface Config {
    voiceModel: string
    modelMirror: string
  }

  interface DownloadState {
    id: string
    filename: string
    status: 'idle' | 'downloading' | 'completed' | 'error'
    progress: number
    downloadedBytes: number
    totalBytes: number
    speed: string
    eta: string
    error?: string
  }

  interface Window {
    voiceCloneAPI: {
      // Python backend
      pythonHealth: () => Promise<{ status: string; models_loaded?: boolean; gpu_available?: boolean }>
      modelStatus: () => Promise<{ loaded: boolean; models_dir: string; model_exists: boolean; gpu_available: boolean; last_error?: string }>
      startBackend: (force?: boolean) => Promise<{ success: boolean; error?: string }>
      reloadModel: () => Promise<{ success: boolean; message?: string; error?: string }>

      // Voice clone
      cloneVoice: (req: {
        mode: string
        text: string
        prompt_text?: string
        prompt_audio: string
        instruct_text?: string
        stream?: boolean
        split_text?: boolean
        output_dir?: string
      }) => Promise<{
        success: boolean
        output_paths?: string[]
        merged_path?: string
        sample_rate?: number
        duration?: number
        elapsed?: number
        segment_count?: number
        text_segments?: string[]
        temp_files_cleaned?: boolean
        error?: string
      }>

      // File
      getModelsDir: () => Promise<string>
      selectAudioFile: () => Promise<string | null>
      selectTextFile: () => Promise<{ path: string; content: string } | null>
      selectOutputDir: () => Promise<string | null>
      openModelsDir: () => Promise<void>
      checkModelExists: (filename: string) => Promise<boolean>
      deleteModel: (filename: string) => Promise<boolean>

      // Config
      getConfig: () => Promise<Config>
      setConfig: (cfg: Record<string, string>) => Promise<void>
      listDownloadedModels: () => Promise<string[]>
      switchModel: (modelName: string) => Promise<{ success: boolean; error?: string }>

      // Model download
      getRecommendedModels: () => Promise<ModelInfo[]>
      downloadModel: (id: string, name: string, group: string) => Promise<{ success: boolean; path?: string; error?: string }>
      getModelFileCounts: (filename: string) => Promise<{ base: { existing: number; total: number }; aux: { existing: number; total: number } }>
      deleteModelGroup: (filename: string, group: string) => Promise<boolean>
      getDownloadProgress: (id: string) => Promise<DownloadState | null>
      onDownloadProgress: (cb: (p: DownloadState) => void) => void

      // Mirrors
      getMirrors: () => Promise<MirrorInfo[]>
      getActiveMirror: () => Promise<string>
      setActiveMirror: (id: string) => Promise<void>
      getModelAllUrls: (filename: string) => Promise<{ url: string; mirrorName: string }[]>

      // App
      getAppVersion: () => Promise<string>
    }
  }
}
