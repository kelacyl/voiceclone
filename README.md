# VoiceClone

本地语音克隆助手 — 基于阿里 CosyVoice 模型，Windows 桌面应用。

## 功能

- 零样本语音克隆：提供 3-10 秒参考音频 + 目标文本，生成克隆语音
- 跨语种合成：保留音色，输出不同语言的语音
- Instruct 模式：通过自然语言指令控制情感、语速等
- 内置模型下载：支持 ModelScope / HF-Mirror 双源，断点续传
- CPU / GPU 双模式：支持无显卡机器 CPU 推理（较慢），也支持 NVIDIA GPU 加速

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + TailwindCSS 3 + Vite 5 |
| 桌面框架 | Electron 31 |
| 后端 | Python 3.10 + FastAPI + Uvicorn |
| 推理引擎 | CosyVoice3 0.5B (AutoModel) + PyTorch 2.5 |
| 打包 | PyInstaller (Python) + electron-builder (NSIS) |

## 架构

```
┌────────────────────────────────────────────┐
│  Electron (main.ts)                        │
│  ├─ 启动/管理 Python 后端子进程            │
│  ├─ IPC 桥接 (preload.ts)                  │
│  └─ 模型下载管理 (download-manager.ts)     │
├────────────────────────────────────────────┤
│  React 前端 (src/)                         │
│  ├─ Home.tsx     — 语音克隆主界面          │
│  └─ Settings.tsx — 模型下载 & 镜像配置      │
├────────────────────────────────────────────┤
│  Python FastAPI (python/cosyvoice_service) │
│  ├─ /health         — 健康检查             │
│  ├─ /models/status  — 模型状态             │
│  ├─ /models/reload  — 重新加载模型         │
│  └─ /clone          — 语音克隆推理         │
├────────────────────────────────────────────┤
│  CosyVoice AutoModel (D:\AI\CosyVoice)     │
│  支持 CosyVoice / CosyVoice2 / CosyVoice3  │
└────────────────────────────────────────────┘
```

## 支持的模型

| 模型 | 大小 | 说明 |
|---|---|---|
| `Fun-CosyVoice3-0.5B-2512` (推荐) | ~7.5 GB | 最新版，9 语种 + 18 方言，需 4GB 显存 |
| `CosyVoice2-0.5B` | ~5.0 GB | 上一代 0.5B，支持流式输出 |
| `CosyVoice-300M-Instruct` | ~2.0 GB | 轻量指令版，适合 2GB 显存低配 GPU |

## 项目结构

```
voiceclone-app/
├── electron/               # Electron 主进程
│   ├── main.ts             # 入口，Python 进程管理，IPC
│   ├── preload.ts          # contextBridge API 暴露
│   ├── download-manager.ts # 模型下载逻辑
│   ├── mirror-config.ts    # 下载源定义
│   └── db.ts               # JSON 配置读写
├── python/                 # Python 后端
│   ├── cosyvoice_service.py  # FastAPI 服务
│   ├── requirements-cpu.txt  # CPU PyTorch 依赖
│   └── requirements-gpu.txt  # GPU PyTorch + CUDA 依赖
├── src/                    # React 前端
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 布局 & 导航
│   ├── pages/
│   │   ├── Home.tsx        # 语音克隆页
│   │   └── Settings.tsx    # 设置 & 模型下载页
│   ├── components/
│   │   └── DownloadProgressModal.tsx
│   └── types/
│       ├── index.ts
│       └── electron.d.ts   # window.voiceCloneAPI 类型声明
├── scripts/
│   └── build_python.py     # PyInstaller 打包脚本
├── assets/                 # 图标等静态资源
├── release/                # 构建产物
└── package.json            # Node 依赖 & electron-builder 配置
```

## 开发

### 环境要求

- Windows 10/11
- Node.js 18+ 和 npm
- **Python 3.10** — 必须使用 3.10，与 [CosyVoice 官方推荐环境](https://github.com/FunAudioLLM/CosyVoice) 保持一致。其他版本（3.9/3.11/3.12）可能导致依赖冲突或模型加载失败。推荐使用虚拟环境 `.venv`
- CosyVoice 源码位于 `.\third_party\CosyVoice`

```bash
# 安装前端依赖
npm install

# 安装 Python 依赖（二选一）
# GPU 版
pip install -r python/requirements-gpu.txt
# CPU 版
pip install -r python/requirements-cpu.txt

# 启动开发模式
npm run dev
```

### 打包

```bash
# 1. 打包 Python 后端（生成 release/python-backend/）
python scripts/build_python.py --gpu   # GPU 版
python scripts/build_python.py --cpu   # CPU 版

# 2. 打包 Electron 应用（生成 release/VoiceClone Setup x.x.x.exe）
npm run build:win
```

### 环境变量（Python 后端）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `COSYVOICE_SRC` | `../../CosyVoice` | CosyVoice 源码路径 |
| `COSYVOICE_MODELS_DIR` | `./pretrained_models/Fun-CosyVoice3-0.5B-2512` | 模型文件目录 |
| `COSYVOICE_HOST` | `127.0.0.1` | 监听地址 |
| `COSYVOICE_PORT` | `9876` | 监听端口 |

## 许可

MIT

## 赞助
如您觉得该项目对您有帮助，欢迎赞助
<img width="779" height="1150" alt="_cgi-bin_mmwebwx-bin_webwxgetmsgimg__ MsgID=1571194012782347709 skey=@crypt_7d7e9bc1_06b7f4614ba6b06b7b2afb554d58ed8b mmweb_appid=wx_webfilehelper" src="https://github.com/user-attachments/assets/7b9183fe-0017-4a9d-9c66-cd58e4d43bd0" />

