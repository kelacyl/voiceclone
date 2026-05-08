/**
 * Minimal key-value config store (JSON-file based).
 * Used by mirror-config and settings.
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let configPath = ''

function getConfigPath(): string {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json')
  }
  return configPath
}

function readConfig(): Record<string, string> {
  try {
    if (fs.existsSync(getConfigPath())) {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
    }
  } catch { /* corrupted, ignore */ }
  return {}
}

function writeConfig(data: Record<string, string>): void {
  const dir = path.dirname(getConfigPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2))
}

export function getConfigValue(key: string): string | undefined {
  return readConfig()[key]
}

export function setConfigValue(key: string, value: string): void {
  const data = readConfig()
  data[key] = value
  writeConfig(data)
}
