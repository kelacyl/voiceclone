/**
 * Vite plugin: obfuscates Electron main/preload output via javascript-obfuscator.
 */
import type { Plugin } from 'vite'
import { obfuscate, type ObfuscationOptions } from 'javascript-obfuscator'
import fs from 'fs'
import path from 'path'

export interface ObfuscatorPluginOptions {
  include?: RegExp
  outDir?: string
  obfuscatorOptions?: ObfuscationOptions
  verbose?: boolean
}

const DEFAULT_OPTIONS: ObfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  deadCodeInjection: false,
  splitStrings: true,
  splitStringsChunkLength: 10,
  reservedStrings: [
    'voiceCloneAPI',
    'python-health',
    'model-status',
    'start-backend',
    'reload-model',
    'clone-voice',
    'get-models-dir',
    'select-audio-file',
    'select-text-file',
    'select-output-dir',
    'open-models-dir',
    'check-model-exists',
    'delete-model',
    'get-config',
    'set-config',
    'list-downloaded-models',
    'switch-model',
    'get-recommended-models',
    'download-model',
    'get-model-file-counts',
    'delete-model-group',
    'get-download-progress',
    'download-progress',
    'get-mirrors',
    'get-active-mirror',
    'set-active-mirror',
    'get-model-all-urls',
    'get-app-version',
    // License
    'validate-license',
    'get-license-info',
    'increment-usage',
    'get-machine-id',
    'license_key',
    // Config keys
    'voice_model',
    'model_mirror',
  ],
}

export function electronObfuscatorPlugin(options: ObfuscatorPluginOptions = {}): Plugin {
  const {
    include = /\.js$/,
    outDir,
    obfuscatorOptions,
    verbose = true,
  } = options

  const mergedOptions: ObfuscationOptions = {
    ...DEFAULT_OPTIONS,
    ...obfuscatorOptions,
  }

  return {
    name: 'electron-obfuscator',
    apply: 'build',
    enforce: 'post',

    writeBundle(bundleOptions, bundle) {
      const resolvedOutDir = outDir || bundleOptions.dir || ''
      if (!resolvedOutDir) {
        console.warn('[electron-obfuscator] No outDir specified, skipping obfuscation')
        return
      }

      const filesToProcess: string[] = []

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && include.test(fileName)) {
          const filePath = path.resolve(resolvedOutDir, fileName)
          if (fs.existsSync(filePath)) {
            filesToProcess.push(filePath)
          }
        }
      }

      if (filesToProcess.length === 0) {
        if (verbose) {
          console.log('[electron-obfuscator] No matching files found to obfuscate')
        }
        return
      }

      for (const filePath of filesToProcess) {
        try {
          const originalCode = fs.readFileSync(filePath, 'utf-8')
          const result = obfuscate(originalCode, mergedOptions)
          fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf-8')

          if (verbose) {
            const originalSize = (Buffer.byteLength(originalCode) / 1024).toFixed(1)
            const obfuscatedSize = (Buffer.byteLength(result.getObfuscatedCode()) / 1024).toFixed(1)
            console.log(
              `[electron-obfuscator] ${path.basename(filePath)}: ${originalSize} KB → ${obfuscatedSize} KB`,
            )
          }
        } catch (err: any) {
          console.error(`[electron-obfuscator] Failed to obfuscate ${filePath}:`, err.message)
        }
      }
    },
  }
}
