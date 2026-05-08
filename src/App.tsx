import { Outlet, Link, useLocation } from 'react-router-dom'
import { Mic, Settings } from 'lucide-react'

export default function App() {
  const loc = useLocation()

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">V</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold">VoiceClone</h1>
            <p className="text-xs text-gray-400">本地语音克隆助手</p>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            to="/"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
              loc.pathname === '/' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Mic className="w-4 h-4" /> 克隆
          </Link>
          <Link
            to="/settings"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
              loc.pathname === '/settings' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Settings className="w-4 h-4" /> 设置
          </Link>
        </nav>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">v0.1.0</span>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
