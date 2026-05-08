"""
CosyVoice 语音克隆服务 — FastAPI HTTP 后端。

基于 CosyVoice AutoModel，模型加载后常驻内存。支持零样本语音克隆。
"""

import os
import sys
import time
import logging
import tempfile
import types
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch

# ─── 将 CosyVoice 及依赖加入 Python路径 ──────────────────────────────────

_COSYVOICE_ROOT = Path(os.environ.get(
    "COSYVOICE_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "third_party", "CosyVoice"),
)).resolve()

_MATCHA_TTS = str(_COSYVOICE_ROOT / "third_party" / "Matcha-TTS")
if os.path.isdir(_MATCHA_TTS):
    sys.path.insert(0, _MATCHA_TTS)
sys.path.insert(0, str(_COSYVOICE_ROOT))

# ─── PyInstaller 兼容性修补 ─────────────────────────────────────────────

# ─── 训练用依赖 mock ─────────────────────────────────────────────────
# CosyVoice/Matcha-TTS 的部分模块会无条件导入 hydra / lightning / matplotlib /
# pyarrow 等训练专用包。推理时不需要这些包，但 import 不能失败（否则 YAML 配置
# 解析阶段就会出错）。
#
# 注意：mock 模块必须足够完整，否则反而比模块缺失更糟（第三方库看到 mock 存在
# 就会尝试使用，mock 属性不全则崩溃）。
import types as _types
import importlib.machinery as _im

def _typed_class(_name):
    return type(_name, (), {})

def _mock_module(_name, *, _package=False, **attrs):
    m = _types.ModuleType(_name)
    m.__version__ = attrs.pop("__version__", "0.0.0")
    if _package:
        m.__path__ = []
    # ModuleSpec 避免 importlib.util.find_spec() 抛 ValueError
    m.__spec__ = _im.ModuleSpec(_name, None)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[_name] = m
    return m

# -- hydra (matcha.utils.instantiators) --
_mock_module("hydra", _package=True,
    utils=_mock_module("hydra.utils",
        instantiate=lambda cfg: cfg))

# -- hydra.core / hydra.core.hydra_config (matcha.utils.rich_utils) --
_mock_module("hydra.core", _package=True)
_HydraConfig = _typed_class("HydraConfig")
_HydraConfig.cfg = _typed_class("HydraCfg")
_HydraConfig.cfg.hydra = _typed_class("Hydra")
_mock_module("hydra.core.hydra_config", HydraConfig=_HydraConfig)

# -- lightning / pytorch_lightning (matcha.utils.*) --
_mock_module("pytorch_lightning")

_lit = _mock_module("lightning",
    Callback=_typed_class("Callback"))
_lit_pt = _mock_module("lightning.pytorch")
_lit_pt_loggers = _mock_module("lightning.pytorch.loggers",
    Logger=_typed_class("Logger"))
_lit_pt_utils = _mock_module("lightning.pytorch.utilities",
    rank_zero_only=lambda fn: fn)
_lit.pytorch = _lit_pt
_lit_pt.loggers = _lit_pt_loggers
_lit_pt.utilities = _lit_pt_utils

# -- matplotlib (cosyvoice.hifigan.hifigan) -- 需要是 package 以支持子模块导入
_mock_module("matplotlib", _package=True,
    use=lambda backend: None)
_mock_module("matplotlib.pyplot")
_mock_module("matplotlib.pylab")

# -- pyarrow (sklearn 会检查其 __version__，必须提供) --
_mock_module("pyarrow",
    parquet=_mock_module("pyarrow.parquet"))

# -- pkg_resources (pyworld / cosyvoice.dataset.processor) --
try:
    import pkg_resources  # noqa: F401
except ImportError:
    _FakeDist = _typed_class("FakeDist")
    _FakeDist.version = "0.0.0"
    _mock_module("pkg_resources",
        get_distribution=lambda name: _FakeDist,
        require=lambda *req: None)

# -- gdown / wget (matcha.utils.utils 中用于下载的无关 import) --
_mock_module("gdown")
_mock_module("wget")

# -- typeguard: inflect 使用 @typechecked 装饰器 --
_tg = _types.ModuleType("typeguard")
_tg.typechecked = lambda *a, **kw: (lambda f: f)
sys.modules["typeguard"] = _tg

# PyYAML 6.0+ 和 ruamel.yaml 的 Loader 都没有 max_depth 属性，
# 但 ruamel.yaml.Composer.compose_node() 会访问 self.loader.max_depth（第 121 行）。
# hyperpyyaml==1.2.2 默认使用 ruamel.yaml.Loader，所以必须同时 patch 两个包的 Loader。
import yaml as _yaml
import ruamel.yaml as _ruamel_yaml

def _make_patched_loader(_name, _orig_cls, _orig_init):
    """创建 Loader 包装子类，在 __init__ 中注入 max_depth 属性。"""
    class _Patched(_orig_cls):
        def __init__(self, stream, *args, **kwargs):
            _orig_init(self, stream, *args, **kwargs)
            if not hasattr(self, 'max_depth'):
                self.max_depth = 0
    _Patched.__name__ = _name
    _Patched.__qualname__ = _name
    _Patched.__module__ = _orig_cls.__module__
    return _Patched

def _patch_yaml_loaders(_module, _loader_names, _label, _logger):
    _patched = []
    for _name in _loader_names:
        _orig_cls = getattr(_module, _name, None)
        if _orig_cls is None:
            continue
        # 检查类本身或其实例是否已有 max_depth
        _has_max_depth = hasattr(_orig_cls, 'max_depth')
        if not _has_max_depth:
            try:
                _inst = _orig_cls.__new__(_orig_cls)
                _has_max_depth = hasattr(_inst, 'max_depth')
            except Exception:
                pass
        if _has_max_depth:
            continue
        _patched_cls = _make_patched_loader(_name, _orig_cls, _orig_cls.__init__)
        setattr(_module, _name, _patched_cls)
        _patched.append(_name)
    if _patched:
        _logger.info("%s Loaders patched for max_depth: %s", _label, _patched)
    return _patched

_patch_logger = logging.getLogger("cosyvoice")
_patch_yaml_loaders(_yaml,
    ('Loader', 'SafeLoader', 'FullLoader', 'CLoader', 'CSafeLoader', 'CFullLoader'),
    "PyYAML", _patch_logger)
_patch_yaml_loaders(_ruamel_yaml,
    ('Loader', 'SafeLoader', 'RoundTripLoader', 'RoundTripSafeLoader'),
    "ruamel.yaml", _patch_logger)

# ─── 确保 modelscope 可导入 (PyInstaller 环境下懒加载可能失败) ──────────

_modelscope_ok = False
try:
    from modelscope import snapshot_download  # noqa: F401

    # modelscope 的 LazyImportModule 在类定义时调用 load_index()，该函数依赖
    # ast_indexer 预编译索引文件。PyInstaller 打包后该文件缺失，load_index()
    # 返回 None，导致后续 AST_INDEX[key] 报 'NoneType' object is not subscriptable。
    # 此处补一个最小有效索引，确保所有 AST_INDEX 访问不会崩溃。
    from modelscope.utils.import_utils import LazyImportModule as _LazyMod
    if _LazyMod.AST_INDEX is None:
        _LazyMod.AST_INDEX = {
            "index": {}, "requirements": {}, "files_mtime": {},
            "version": "0.0.0", "md5": "",
        }

    _modelscope_ok = True
except Exception:
    pass

if not _modelscope_ok:
    # 创建最小 mock。CosyVoice AutoModel 仅调用 snapshot_download（模型目录在
    # Electron 端已预下载，不会被触发），下载功能需要 model_file_download。
    _mock_ms = types.ModuleType("modelscope")
    _mock_ms.snapshot_download = lambda model_id, local_dir=None, **kw: model_id
    _mock_ms.model_file_download = lambda model_id, file, local_dir=None, **kw: os.path.join(local_dir or "", file)
    _mock_ms.hub = types.ModuleType("modelscope.hub")
    _mock_ms.hub.snapshot_download = lambda model_id, local_dir=None, **kw: model_id
    _mock_ms.utils = types.ModuleType("modelscope.utils")
    _mock_ms.utils.import_utils = types.ModuleType("modelscope.utils.import_utils")
    sys.modules["modelscope"] = _mock_ms
    sys.modules["modelscope.hub"] = _mock_ms.hub
    sys.modules["modelscope.utils"] = _mock_ms.utils
    sys.modules["modelscope.utils.import_utils"] = _mock_ms.utils.import_utils

# ─── 导入 CosyVoice ─────────────────────────────────────────────────────

from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import uvicorn  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cosyvoice")

# ─── 配置 ────────────────────────────────────────────────────────────────

MODELS_DIR = os.environ.get("COSYVOICE_MODELS_DIR", "./pretrained_models/Fun-CosyVoice3-0.5B-2512")
HOST = os.environ.get("COSYVOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("COSYVOICE_PORT", "9876"))

# ─── 全局状态 ────────────────────────────────────────────────────────────

_cosyvoice = None   # AutoModel 实例
_models_loaded = False
_last_error = None  # 最近一次加载失败的错误信息

# ─── FastAPI ─────────────────────────────────────────────────────────────

app = FastAPI(title="CosyVoice Clone Service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class CloneRequest(BaseModel):
    mode: str = "zero_shot"                # "zero_shot" | "cross_lingual" | "instruct"
    text: str                              # 要合成的目标文本
    prompt_text: Optional[str] = None      # 参考音频对应文本（零样本推荐提供）
    prompt_audio: str                      # 参考音频路径
    instruct_text: Optional[str] = None    # instruct 模式用的指令文本
    stream: bool = False                   # 是否流式输出
    split_text: bool = True                # 是否自动按自然语句拆分长文本
    output_dir: Optional[str] = None       # 最终音频保存目录（不为空则合并并保存到此）


class ModelStatus(BaseModel):
    loaded: bool
    models_dir: str
    model_exists: bool
    gpu_available: bool
    last_error: Optional[str] = None


_REQUIRED_FILES: dict = {
    "cosyvoice": ["llm.pt", "flow.pt", "hift.pt", "campplus.onnx", "speech_tokenizer_v1.onnx"],
    "cosyvoice2": ["llm.pt", "flow.pt", "hift.pt", "campplus.onnx", "speech_tokenizer_v2.onnx"],
    "cosyvoice3": ["llm.pt", "flow.pt", "hift.pt", "campplus.onnx", "speech_tokenizer_v3.onnx"],
}


def _check_model_integrity(model_dir: str) -> bool:
    """验证模型目录是否包含所有必要文件（非仅 yaml）。"""
    if not os.path.isdir(model_dir):
        return False
    for version_key, required in _REQUIRED_FILES.items():
        yaml_path = os.path.join(model_dir, f"{version_key}.yaml")
        if not os.path.exists(yaml_path):
            continue
        for f in required:
            if not os.path.exists(os.path.join(model_dir, f)):
                return False
        # CosyVoice-BlankEN required for v2/v3
        if version_key != "cosyvoice":
            if not os.path.isdir(os.path.join(model_dir, "CosyVoice-BlankEN")):
                return False
        return True
    return False


def _load_model():
    """懒加载 CosyVoice 模型。"""
    global _cosyvoice, _models_loaded, _last_error

    if _models_loaded:
        return

    if not _check_model_integrity(MODELS_DIR):
        missing = []
        for version_key, required in _REQUIRED_FILES.items():
            yaml_path = os.path.join(MODELS_DIR, f"{version_key}.yaml")
            if os.path.exists(yaml_path):
                for f in required:
                    if not os.path.exists(os.path.join(MODELS_DIR, f)):
                        missing.append(f)
                if version_key != "cosyvoice" and not os.path.isdir(os.path.join(MODELS_DIR, "CosyVoice-BlankEN")):
                    missing.append("CosyVoice-BlankEN/")
                break
        _last_error = f"模型文件不完整，缺少: {', '.join(missing)}" if missing else f"模型目录不存在或缺少 yaml 配置: {MODELS_DIR}"
        raise RuntimeError(_last_error)

    gpu_ok = torch.cuda.is_available()
    logger.info(f"Loading CosyVoice model from {MODELS_DIR}...")
    logger.info(f"GPU available: {gpu_ok}")

    if not gpu_ok:
        logger.warning(
            "未检测到 GPU，将使用 CPU 推理。"
            "CPU 推理速度较慢 (RTF ~3-8)，单句文本约需 10-30 秒，请耐心等待。"
        )

    t0 = time.time()
    try:
        _cosyvoice = AutoModel(model_dir=MODELS_DIR)
    except Exception as e:
        _last_error = f"AutoModel 初始化失败: {e}"
        raise

    _models_loaded = True
    _last_error = None

    logger.info(f"Model loaded in {time.time() - t0:.1f}s (sample_rate={_cosyvoice.sample_rate}, gpu={gpu_ok})")


@app.on_event("startup")
async def startup():
    global _last_error
    try:
        _load_model()
    except Exception as e:
        _last_error = str(e)
        logger.warning(f"Startup load failed (will retry on first request): {e}")


@app.get("/health")
async def health():
    gpu_ok = torch.cuda.is_available()
    return {
        "status": "ok",
        "models_loaded": _models_loaded,
        "gpu_available": gpu_ok,
        "warning": (
            None if gpu_ok else
            "CPU 推理 CosyVoice3-0.5B 极慢 (RTF 15-30)，一句话可能需 3-10 分钟。"
            "建议切换到 CosyVoice-300M-Instruct 模型（RTF 3-8），或安装 NVIDIA GPU。"
            if "0.5B" in os.path.basename(MODELS_DIR) or "CosyVoice3" in os.path.basename(MODELS_DIR)
            else "CPU 推理模式，速度较慢 (RTF ~3-8)，单句文本预计 10-30 秒"
        ),
    }


@app.get("/models/status", response_model=ModelStatus)
async def model_status():
    return ModelStatus(
        loaded=_models_loaded,
        models_dir=str(MODELS_DIR),
        model_exists=_check_model_integrity(MODELS_DIR),
        gpu_available=torch.cuda.is_available(),
        last_error=_last_error,
    )


@app.post("/models/reload")
async def reload_model():
    """强制重新加载模型（如果模型文件已就绪）。"""
    global _models_loaded, _cosyvoice
    _models_loaded = False
    _cosyvoice = None
    try:
        _load_model()
        return {"success": True, "message": "模型加载成功"}
    except Exception as e:
        logger.error(f"Reload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── 文本分句 ─────────────────────────────────────────────────────────

import re as _re

_SPLIT_PATTERN = _re.compile(
    r'(?<=[。！？；\n\.\!\?\;…‥])'
    r'\s*'
    r'(?=[^\s。！？；\.\!\?\;…‥])',
    _re.UNICODE,
)
_MIN_SEGMENT_CHARS = 5
_MAX_SEGMENT_CHARS = 200


def _split_long_sentence(sentence: str) -> list:
    """对单个超长句子按逗号/分句进一步拆分。"""
    sub_parts = _re.split(r'(?<=[，,：:])\s*', sentence)
    chunks = []
    buf = ""
    for part in sub_parts:
        if buf and len(buf) + len(part) > _MAX_SEGMENT_CHARS:
            chunks.append(buf.strip())
            buf = part
        else:
            buf += part
    if buf.strip():
        chunks.append(buf.strip())
    return chunks or [sentence]


def split_text(text: str) -> list:
    """按自然语句边界拆分长文本，返回分句列表。"""
    raw = [s.strip() for s in _SPLIT_PATTERN.split(text) if s.strip()]
    if not raw:
        return [text]

    result = []
    for seg in raw:
        # 超长句按逗号二次拆分
        if len(seg) > _MAX_SEGMENT_CHARS:
            result.extend(_split_long_sentence(seg))
        else:
            result.append(seg)

    # 合并过短的片段到前一句
    merged = []
    for seg in result:
        if merged and len(seg) < _MIN_SEGMENT_CHARS:
            merged[-1] = merged[-1] + seg
        else:
            merged.append(seg)

    return merged


# ─── 音频合并 ─────────────────────────────────────────────────────────

def concat_wavs(input_paths: list, output_path: str, sample_rate: int):
    """将多个 WAV 文件拼接为一个，写入 output_path。"""
    pieces = []
    for p in input_paths:
        data, sr = sf.read(p)
        if sr != sample_rate:
            logger.warning(f"Sample rate mismatch in {p}: expected {sample_rate}, got {sr}")
        pieces.append(data)
    merged = np.concatenate(pieces)
    sf.write(output_path, merged, sample_rate)
    logger.info(f"Merged {len(pieces)} segments → {output_path} ({len(merged)/sample_rate:.1f}s)")
    return output_path


# ─── 端点 ─────────────────────────────────────────────────────────────

@app.post("/clone")
async def clone_voice(req: CloneRequest):
    """语音克隆 / 合成接口，支持长文本自动分句、多段合成、合并输出。"""
    if not _models_loaded:
        try:
            _load_model()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))

    if not os.path.exists(req.prompt_audio):
        raise HTTPException(status_code=400, detail=f"参考音频不存在: {req.prompt_audio}")

    try:
        t0 = time.time()
        prompt_text = req.prompt_text or ""

        # 决定文本片段：自动分句 vs 整体
        text_segments = split_text(req.text) if req.split_text else [req.text]
        logger.info(
            f"Clone [{req.mode}]: {len(text_segments)} text segments, "
            f"prompt_audio={req.prompt_audio}"
        )

        def _run_inference(text):
            if req.mode == "zero_shot":
                return _cosyvoice.inference_zero_shot(
                    text, prompt_text, req.prompt_audio, stream=req.stream)
            elif req.mode == "cross_lingual":
                return _cosyvoice.inference_cross_lingual(
                    text, req.prompt_audio, stream=req.stream)
            elif req.mode == "instruct":
                instruct = req.instruct_text or ""
                return _cosyvoice.inference_instruct2(
                    text, instruct, req.prompt_audio, stream=req.stream)
            else:
                raise HTTPException(status_code=400, detail=f"不支持的克隆模式: {req.mode}")

        # 逐段生成
        all_output_paths = []
        total_duration = 0.0

        for seg_idx, seg_text in enumerate(text_segments):
            seg_t0 = time.time()
            seg_paths = []
            gen = _run_inference(seg_text)
            for result in gen:
                speech = result["tts_speech"]
                audio_np = speech.squeeze(0).cpu().numpy()
                duration = len(audio_np) / _cosyvoice.sample_rate
                total_duration += duration

                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    sf.write(f.name, audio_np, _cosyvoice.sample_rate)
                    seg_paths.append(f.name)

            all_output_paths.extend(seg_paths)
            logger.info(
                f"Segment {seg_idx+1}/{len(text_segments)}: "
                f"\"{seg_text[:40]}...\" → {len(seg_paths)} audio(s), "
                f"{time.time()-seg_t0:.1f}s"
            )

        elapsed = time.time() - t0
        sample_rate = _cosyvoice.sample_rate

        # 合并 & 输出
        merged_path = None
        temp_cleaned = False

        if req.output_dir:
            os.makedirs(req.output_dir, exist_ok=True)
            ts = time.strftime("%Y%m%d_%H%M%S")
            merged_name = f"voiceclone_{ts}.wav"
            merged_path = os.path.join(req.output_dir, merged_name)

            if len(all_output_paths) > 1:
                concat_wavs(all_output_paths, merged_path, sample_rate)
            else:
                # 只有一个片段，直接拷贝
                import shutil
                shutil.copy2(all_output_paths[0], merged_path)

            # 清理临时文件
            for p in all_output_paths:
                try:
                    os.unlink(p)
                except Exception:
                    pass
            temp_cleaned = True
            logger.info(
                f"Output saved to {merged_path}, temp files cleaned: {temp_cleaned}"
            )

        logger.info(
            f"Clone done: {len(text_segments)} text segs → {len(all_output_paths)} audio files, "
            f"{total_duration:.1f}s audio in {elapsed:.1f}s (RTF: {elapsed/total_duration:.2f})"
        )

        return {
            "success": True,
            "output_paths": all_output_paths,
            "merged_path": merged_path,
            "sample_rate": sample_rate,
            "duration": total_duration,
            "elapsed": elapsed,
            "segment_count": len(text_segments),
            "text_segments": text_segments,
            "temp_files_cleaned": temp_cleaned,
        }

    except Exception as e:
        logger.error(f"Clone failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── 模型下载 ─────────────────────────────────────────────────────────

import threading as _threading
import hashlib as _hashlib
import shutil as _shutil

_download_tasks: dict = {}  # task_id → { status, progress, error, ... }
_download_lock = _threading.Lock()


class DownloadStartRequest(BaseModel):
    download_id: str                    # modelscope model ID 或 HF repo ID
    mirror: str = "modelscope"          # "modelscope" | "hf-mirror"
    dest_dir: str                       # 目标根目录
    files: list = []                    # 要下载的文件名列表
    dirs: list = []                     # 要下载的目录名列表
    local_name: str = ""                # 子目录名


def _run_download(task_id: str, req: DownloadStartRequest):
    """在后台线程中执行下载。"""
    try:
        model_dest = os.path.join(req.dest_dir, req.local_name) if req.local_name else req.dest_dir
        os.makedirs(model_dest, exist_ok=True)

        total = len(req.files) + len(req.dirs)
        completed = 0

        with _download_lock:
            _download_tasks[task_id] = {
                "status": "downloading", "progress": 0,
                "total": total, "completed": 0,
                "current": "", "error": None,
            }

        def _update(current_name, done):
            with _download_lock:
                t = _download_tasks.get(task_id)
                if t:
                    t["current"] = current_name
                    t["completed"] = done
                    t["progress"] = int(done / total * 100) if total else 100

        if req.mirror == "hf-mirror":
            from huggingface_hub import hf_hub_download, snapshot_download

            for fname in req.files:
                _update(fname, completed)
                dest_path = os.path.join(model_dest, fname)
                if not os.path.exists(dest_path):
                    hf_hub_download(req.download_id, fname, local_dir=model_dest,
                                    endpoint="https://hf-mirror.com")
                completed += 1
                _update(fname, completed)

            for dname in req.dirs:
                _update(f"{dname}/ (目录)", completed)
                dir_path = os.path.join(model_dest, dname)
                if not os.path.isdir(dir_path) or not os.listdir(dir_path):
                    snapshot_download(req.download_id, local_dir=model_dest,
                                      allow_patterns=[f"{dname}/**"],
                                      endpoint="https://hf-mirror.com")
                completed += 1
                _update(f"{dname}/", completed)
        else:
            from modelscope import model_file_download, snapshot_download

            for fname in req.files:
                _update(fname, completed)
                dest_path = os.path.join(model_dest, fname)
                if not os.path.exists(dest_path):
                    model_file_download(req.download_id, fname, local_dir=model_dest)
                completed += 1
                _update(fname, completed)

            for dname in req.dirs:
                _update(f"{dname}/ (目录)", completed)
                dir_path = os.path.join(model_dest, dname)
                if not os.path.isdir(dir_path) or not os.listdir(dir_path):
                    snapshot_download(req.download_id, local_dir=model_dest,
                                      allow_patterns=[f"{dname}/**"])
                completed += 1
                _update(f"{dname}/", completed)

        with _download_lock:
            _download_tasks[task_id]["status"] = "completed"
            _download_tasks[task_id]["progress"] = 100

    except Exception as e:
        logger.error(f"Download task {task_id} failed: {e}")
        with _download_lock:
            t = _download_tasks.get(task_id)
            if t:
                t["status"] = "error"
                t["error"] = str(e)


@app.post("/download/start")
async def download_start(req: DownloadStartRequest):
    task_id = _hashlib.md5(
        f"{req.download_id}{req.mirror}{req.local_name}{time.time()}".encode()
    ).hexdigest()[:12]
    t = _threading.Thread(target=_run_download, args=(task_id, req), daemon=True)
    t.start()
    return {"task_id": task_id}


@app.get("/download/status/{task_id}")
async def download_status(task_id: str):
    with _download_lock:
        t = _download_tasks.get(task_id)
    if t is None:
        return {"status": "not_found"}
    return t


@app.post("/download/cleanup")
async def download_cleanup():
    """清除超过 1 小时的已完成任务状态。"""
    # 简单实现：清除所有非 downloading 的任务
    with _download_lock:
        expired = [k for k, v in _download_tasks.items() if v["status"] != "downloading"]
        for k in expired:
            del _download_tasks[k]
    return {"cleaned": len(expired)}


# ─── 入口 ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # PyInstaller --windowed 模式下 sys.stdout/stderr 为 None，
    # 导致 uvicorn 日志初始化时调用 sys.stdout.isatty() 崩溃。
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
