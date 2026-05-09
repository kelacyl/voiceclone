/**
 * Minimal key-value config store with license usage tracking (JSON-file based).
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

interface LicenseUsageRecord {
  yearMonth: string
  count: number
}

interface ConfigData {
  config: Record<string, string>
  licenseUsage: LicenseUsageRecord[]
}

let configPath = ''

function getConfigPath(): string {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json')
  }
  return configPath
}

function readData(): ConfigData {
  try {
    if (fs.existsSync(getConfigPath())) {
      const raw = fs.readFileSync(getConfigPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      // Migrate old format (flat key-value only)
      if (!parsed.licenseUsage) {
        return { config: parsed, licenseUsage: [] }
      }
      return parsed
    }
  } catch { /* corrupted, ignore */ }
  return { config: {}, licenseUsage: [] }
}

function writeData(data: ConfigData): void {
  const dir = path.dirname(getConfigPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2))
}

export function getConfigValue(key: string): string | undefined {
  return readData().config[key]
}

export function setConfigValue(key: string, value: string): void {
  const data = readData()
  data.config[key] = value
  writeData(data)
}

export function getLicenseUsage(yearMonth: string): number {
  const record = readData().licenseUsage.find((r) => r.yearMonth === yearMonth)
  return record?.count || 0
}

export function incrementLicenseUsage(yearMonth: string): void {
  const data = readData()
  const record = data.licenseUsage.find((r) => r.yearMonth === yearMonth)
  if (record) {
    record.count++
  } else {
    data.licenseUsage.push({ yearMonth, count: 1 })
  }
  writeData(data)
}
