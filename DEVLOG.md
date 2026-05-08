# VoiceClone 开发日志

## 2026-05-08 — 模型加载 bug 修复

### 项目状态

- 项目可正常启动 Electron 前端
- Python 后端 (FastAPI + CosyVoice AutoModel) 通过 PyInstaller 打包为独立 exe
- 模型下载功能可用（ModelScope / HF-Mirror 双源）
- 语音克隆前端 UI 已基本完成（Home + Settings 页）

### 已修复问题

#### Bug 1: `'Loader' object has no attribute 'max_depth'`

- **文件**: `python/cosyvoice_service.py:41-120`
- **根因**: `hyperpyyaml==1.2.2` 的函数签名默认使用 `ruamel.yaml.Loader`（非 PyYAML）。
  `ruamel.yaml.Composer.compose_node()` 在第 121 行访问 `self.loader.max_depth`，但 `ruamel.yaml.Loader`
  没有此属性。项目中原有补丁只 patch 了 `yaml.Loader`（PyYAML），未处理 `ruamel.yaml`。
- **修复**: 扩展 Loader 补丁逻辑，同时覆盖 `yaml` (PyYAML) 和 `ruamel.yaml` 的所有 Loader 变体。
  补丁通过包装子类在 `__init__` 中注入 `max_depth = 0`。

#### Bug 2: `ModuleNotFoundError: No module named 'PIL'`

- **文件**: `scripts/build_python.py:189`
- **根因**: `diffusers` 库导入 `PIL.Image`，但 PyInstaller 打包脚本将其排除 (`--exclude-module PIL`)。
- **修复**: 移除 `--exclude-module PIL`。Pillow 已在虚拟环境中作为依赖安装，体积约 3MB。

#### Bug 3: 训练依赖缺失导致模块导入链断裂

- **文件**: `python/cosyvoice_service.py:34-104`
- **根因**: CosyVoice 和 Matcha-TTS 在模块 import 阶段无条件加载训练专用包（hydra, lightning, matplotlib,
  pyarrow, gdown, wget），虽然推理时不调用这些包的功能，但 `hyperpyyaml` 的 YAML 配置解析阶段
  通过 `pydoc.locate()` 触发完整 import 链，任一缺失都会导致 `pydoc.ErrorDuringImport`。
  直接 mock 这些模块比安装它们更合适（这些是训练依赖，体积大且推理不需要）。
- **修复**: 添加完整的训练依赖 mock 模块（6 组），使用 `importlib.machinery.ModuleSpec` 确保
  `importlib.util.find_spec()` 不会因为 `__spec__ is None` 而抛 ValueError。
  - **hydra**: package mock，含 `hydra.utils.instantiate`
  - **hydra.core**: package mock，含 `hydra.core.hydra_config.HydraConfig`
  - **lightning / pytorch_lightning**: 含 `Callback`, `Logger`, `rank_zero_only`
  - **matplotlib**: package mock，含 `pyplot`, `pylab` 子模块, `use` 函数
  - **pyarrow**: 含 `__version__ = "0.0.0"`, `parquet` 子模块
  - **pkg_resources**: 含 `get_distribution`（返回带 `.version` 的假对象）
  - **gdown / wget**: 空 mock（仅下载用）

### 待处理问题

1. **临时文件泄漏** — `/clone` 接口用 `NamedTemporaryFile(delete=False)` 创建 WAV 文件，从未删除，
   长期使用会占满磁盘。
2. **instruct 模式缺失** — 前端 Home.tsx 只展示 `zero_shot` 和 `cross_lingual` 模式，
   后端支持 `instruct`（CosyVoice3 的 `inference_instruct2`），UI 缺少入口。
3. **IPC 类型不一致** — `main.ts:331` 的 `getModelAllUrls` handler 返回 `Record<string, string>`
   （mirror→downloadId），但 `electron.d.ts` 类型声明为 `{ url: string; mirrorName: string }[]`。
4. **instruct 模式对 CosyVoice v1 不兼容** — `CosyVoice`（v1）只有 `inference_instruct`，
   `CosyVoice2/3` 才有 `inference_instruct2`。当前代码硬编码调用 `inference_instruct2`，
   如果用户使用 CosyVoice-300M-Instruct 模型会报错。
5. **Matcha-TTS 子模块未初始化** — `D:\AI\CosyVoice\third_party\Matcha-TTS` 为空目录，
   git submodule 未拉取（`git submodule status` 显示 `-` 前缀）。开发环境下需要
   `git submodule update --init`（打包时由 build_python.py 复制源码，不依赖本地）。

### 验证状态

- 开发环境 `python cosyvoice_service.py` 模型加载：通过
- 模型: CosyVoice-300M-Instruct (sample_rate=22050)
- 打包后: 待用户重新构建并验证

#### Bug 4: 模型下载 `ModuleNotFoundError: No module named 'modelscope'`

- **文件**: `python/cosyvoice_service.py`, `electron/download-manager.ts`
- **根因**: `download-manager.ts` 通过 `spawn('python', ['-c', 'from modelscope import ...'])` 调用系统 Python，
  但系统 Python 没有 modelscope。打包后更是没有 `python` 解释器。
- **修复**: 将下载逻辑迁移到 Python 后端 HTTP API（`POST /download/start` + `GET /download/status/{id}`），
  Electron 端改为 HTTP 请求+轮询。后端使用线程池异步执行 modelscope/huggingface_hub 下载，
  彻底消除对外部 Python 子进程的依赖。

### 代码变更（本次会话）

---

## 2026-05-08 — 长文本自动分句 & 输出管理

### 新增功能

#### 功能 1: 文本文件导入 + 自动分句

- **涉及文件**: `python/cosyvoice_service.py`, `src/pages/Home.tsx`, `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`
- **说明**: 用户可通过「从 txt 文件导入」按钮选择 `.txt` 文件，文本自动加载到输入框。
  后端 `/clone` 接口新增 `split_text` 参数（默认 true），按自然语句边界拆分长文本：
  - 中英文标点：`。！？；.!?;…‥`
  - 保持分段在 5-200 字符之间
  - 超出 200 字符的句子按逗号/分号二次拆分
  - 不足 5 字符的短片段合并到前句

#### 功能 2: 输出目录指定 + 音频合并 + 临时文件清理

- **涉及文件**: `python/cosyvoice_service.py`
- **说明**: `/clone` 接口新增 `output_dir` 参数。指定后：
  1. 所有片段音频合并为一个 WAV 文件，命名为 `voiceclone_YYYYMMDD_HHMMSS.wav`
  2. 保存到指定目录
  3. 删除临时中间文件
  未指定则保持旧行为（返回各片段临时路径，不清理）。

### 新增 IPC

| IPC | 方向 | 说明 |
|---|---|---|
| `select-text-file` | renderer → main | 打开 .txt 文件选择对话框，返回 `{ path, content }` |

### 代码变更

```
python/cosyvoice_service.py  — +100 行 (split_text, concat_wavs, 更新 /clone)
electron/main.ts             — +7 行   (select-text-file handler)
electron/preload.ts          — +1 行   (暴露 selectTextFile)
src/types/electron.d.ts      — +5 行   (类型更新)
src/pages/Home.tsx           — 重写    (UI: 文本文件按钮、输出目录、分段预览、合并结果)
```

