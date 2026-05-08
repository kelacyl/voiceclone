export interface CloneRequest {
  text: string
  referenceAudioPath: string
  referenceText?: string
  speed?: number
}

export interface CloneResult {
  success: boolean
  output_path?: string
  sample_rate?: number
  duration?: number
  elapsed?: number
  error?: string
}

export interface ModelStatus {
  loaded: boolean
  models_dir: string
  missing_files: string[]
}

export interface BackendHealth {
  status: string
  models_loaded?: boolean
}
