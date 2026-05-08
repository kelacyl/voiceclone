#!/usr/bin/env python3
"""
PyInstaller 打包脚本 — 将 CosyVoice Python 后端打包为独立可执行程序。

用法:
    python scripts/build_python.py             # 自动检测 (有 CUDA → GPU, 否则 CPU)
    python scripts/build_python.py --cpu        # 强制 CPU 版 (兼容所有机器, ~500MB)
    python scripts/build_python.py --gpu        # 强制 GPU 版 (需要 CUDA, ~2.5GB)

CPU vs GPU 说明:
    - CPU 版: 打包体积小, 可在任何 Windows 机器上运行。推理速度慢 (RTF ~3-8),
      一句 10 字的文本约需 10-20 秒。适合没有 NVIDIA 显卡的笔记本/台式机。
    - GPU 版: 打包体积大 (含 CUDA 运行时 ~2GB), 需要 NVIDIA 显卡 + 4GB 以上显存。
      推理速度快 (RTF ~0.2), 适合有独显的开发/工作站。

产物:
    release/python-backend/cosyvoice-service.exe
"""

import os
import sys
import shutil
import subprocess
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COSYVOICE_SRC = PROJECT_ROOT / "third_party" / "CosyVoice"
PYTHON_DIR = PROJECT_ROOT / "python"
RELEASE_DIR = PROJECT_ROOT / "release" / "python-backend"


def ensure_pyinstaller():
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller>=6.0"])


def has_cuda() -> bool:
    """Detect if CUDA is available on this machine."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        pass
    # Fallback: check if nvidia-smi works
    try:
        subprocess.run(["nvidia-smi"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def install_deps(cpu_only: bool):
    """Install the correct PyTorch version for the target."""
    req_file = PYTHON_DIR / ("requirements-cpu.txt" if cpu_only else "requirements-gpu.txt")

    if cpu_only:
        print("\n─── Installing CPU PyTorch (small ~200MB) ───")
    else:
        print("\n─── Installing GPU PyTorch + CUDA (~2GB) ───")

    # Ensure setuptools is recent enough (Python 3.12 compat)
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--upgrade", "setuptools", "pip", "wheel"],
        cwd=str(PROJECT_ROOT),
    )
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-r", str(req_file)],
        cwd=str(PROJECT_ROOT),
    )
    print("Dependencies installed.\n")


def clean_release():
    if RELEASE_DIR.exists():
        shutil.rmtree(RELEASE_DIR)
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)


def write_runtime_hook():
    hook_content = '''
# PyInstaller runtime hook for CosyVoice
import sys, os
_root = os.path.join(os.path.dirname(__file__), "cosyvoice_src")
_matcha = os.path.join(_root, "third_party", "Matcha-TTS")
if os.path.isdir(_matcha):
    sys.path.insert(0, _matcha)
sys.path.insert(0, _root)
'''
    hooks_dir = PYTHON_DIR / "_hooks"
    hooks_dir.mkdir(exist_ok=True)
    hook_path = hooks_dir / "cosyvoice_hook.py"
    hook_path.write_text(hook_content)
    return hook_path


def build(cpu_only: bool):
    ensure_pyinstaller()
    install_deps(cpu_only)
    clean_release()

    hook_path = write_runtime_hook()
    main_script = PYTHON_DIR / "cosyvoice_service.py"
    icon = PROJECT_ROOT / "assets" / "icon.ico"

    flavor = "CPU" if cpu_only else "GPU"
    print(f"\n{'='*60}")
    print(f"  Building CosyVoice backend — {flavor} version")
    print(f"{'='*60}\n")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onedir",
        "--name", "cosyvoice-service",
        "--distpath", str(RELEASE_DIR.parent),
        "--workpath", str(PROJECT_ROOT / "build" / "pyinstaller"),
        "--specpath", str(PROJECT_ROOT / "build"),
        "--noconfirm", "--clean",
        # 不显示控制台 (FastAPI 输出走 stdout pipe, 不需要窗口)
        "--windowed",
        "--add-data", f"{COSYVOICE_SRC}{os.pathsep}cosyvoice_src",
        "--paths", str(COSYVOICE_SRC),
        "--paths", str(COSYVOICE_SRC / "third_party" / "Matcha-TTS"),
        "--runtime-hook", str(hook_path),
        # ── 隐藏导入 ──
        "--hidden-import", "torch",
        "--hidden-import", "torchaudio",
        "--hidden-import", "numpy",
        "--hidden-import", "scipy",
        "--hidden-import", "soundfile",
        "--hidden-import", "librosa",
        "--hidden-import", "transformers",
        "--hidden-import", "onnxruntime",
        "--hidden-import", "conformer",
        "--hidden-import", "diffusers",
        "--hidden-import", "tqdm",
        "--hidden-import", "rich",
        "--hidden-import", "hyperpyyaml",
        "--collect-all", "modelscope",
        "--hidden-import", "lightning",
        "--hidden-import", "hydra",
        "--hidden-import", "omegaconf",
        "--hidden-import", "networkx",
        "--hidden-import", "sklearn",
        # ── cosyvoice top-level ──
        "--hidden-import", "cosyvoice",
        "--hidden-import", "cosyvoice.cli",
        "--hidden-import", "cosyvoice.cli.cosyvoice",
        "--hidden-import", "cosyvoice.cli.frontend",
        "--hidden-import", "cosyvoice.cli.model",
        # ── cosyvoice llm (yaml: !new:cosyvoice.llm.llm.TransformerLM) ──
        "--hidden-import", "cosyvoice.llm",
        "--hidden-import", "cosyvoice.llm.llm",
        # ── cosyvoice flow (yaml: !new:cosyvoice.flow.flow.MaskedDiffWithXvec, etc.) ──
        "--hidden-import", "cosyvoice.flow",
        "--hidden-import", "cosyvoice.flow.flow",
        "--hidden-import", "cosyvoice.flow.decoder",
        "--hidden-import", "cosyvoice.flow.flow_matching",
        "--hidden-import", "cosyvoice.flow.length_regulator",
        # ── cosyvoice hifigan (yaml: !new:cosyvoice.hifigan.generator.HiFTGenerator, etc.) ──
        "--hidden-import", "cosyvoice.hifigan",
        "--hidden-import", "cosyvoice.hifigan.generator",
        "--hidden-import", "cosyvoice.hifigan.f0_predictor",
        "--hidden-import", "cosyvoice.hifigan.hifigan",
        "--hidden-import", "cosyvoice.hifigan.discriminator",
        # ── cosyvoice transformer (yaml: !new:cosyvoice.transformer.encoder.ConformerEncoder, etc.) ──
        "--hidden-import", "cosyvoice.transformer",
        "--hidden-import", "cosyvoice.transformer.encoder",
        # ── cosyvoice tokenizer ──
        "--hidden-import", "cosyvoice.tokenizer",
        "--hidden-import", "cosyvoice.tokenizer.tokenizer",
        # ── cosyvoice dataset (yaml: !name:cosyvoice.dataset.processor.*) ──
        "--hidden-import", "cosyvoice.dataset",
        "--hidden-import", "cosyvoice.dataset.processor",
        # ── cosyvoice utils (yaml: !name:cosyvoice.utils.common.ras_sampling) ──
        "--hidden-import", "cosyvoice.utils",
        "--hidden-import", "cosyvoice.utils.common",
        # ── matcha (third_party, yaml: !name:matcha.utils.audio.mel_spectrogram) ──
        "--hidden-import", "matcha",
        "--hidden-import", "matcha.utils",
        "--hidden-import", "matcha.utils.audio",
        "--hidden-import", "matcha.hifigan",
        "--hidden-import", "matcha.hifigan.models",
        "--exclude-module", "matplotlib",
        "--exclude-module", "tensorboard",
        "--exclude-module", "cv2",
        "--exclude-module", "pandas",
        "--copy-metadata", "modelscope",
        "--collect-all", "huggingface_hub",
        "--hidden-import", "einops",
        "--hidden-import", "tiktoken",
        "--hidden-import", "x_transformers",
        "--hidden-import", "regex",
        "--hidden-import", "inflect",
        "--hidden-import", "pyworld",
        "--hidden-import", "scipy",
        "--collect-all", "whisper",
        "--collect-all", "cosyvoice",
        str(main_script),
    ]

    if icon.exists():
        cmd.insert(-8, "--icon")
        cmd.insert(-8, str(icon))

    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))

    if result.returncode != 0:
        print("\n✗ Build FAILED! Check output above.")
        sys.exit(1)

    # PyInstaller onedir outputs to <distpath>/<name>/ — rename to target path
    built_dir = RELEASE_DIR.parent / "cosyvoice-service"
    if built_dir.is_dir() and built_dir != RELEASE_DIR:
        if RELEASE_DIR.exists():
            shutil.rmtree(RELEASE_DIR)
        shutil.move(str(built_dir), str(RELEASE_DIR))
        print(f"Moved: {built_dir} -> {RELEASE_DIR}")

    # Verify
    exe = RELEASE_DIR / "cosyvoice-service.exe"
    if exe.exists():
        exe_mb = exe.stat().st_size / (1024 * 1024)
        internal = RELEASE_DIR / "_internal"
        internal_gb = sum(
            f.stat().st_size for f in internal.rglob("*") if f.is_file()
        ) / (1024 * 1024 * 1024) if internal.exists() else 0
        print(f"\n✓ {flavor} Build successful!")
        print(f"  Executable : {exe} ({exe_mb:.0f} MB)")
        print(f"  Dependencies: ~{internal_gb:.1f} GB")
        print(f"  GPU required: {'No (runs on any machine)' if cpu_only else 'Yes (NVIDIA + CUDA 12.1)'}")
        print(f"  Output     : {RELEASE_DIR}")
    else:
        print(f"\n✗ Build failed — exe not found at {exe}")
        print(f"  Contents of {RELEASE_DIR.parent}: {list(RELEASE_DIR.parent.iterdir()) if RELEASE_DIR.parent.exists() else 'N/A'}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build CosyVoice Python backend")
    parser.add_argument("--cpu", action="store_true", help="Build CPU-only version (no GPU required)")
    parser.add_argument("--gpu", action="store_true", help="Build GPU version (requires CUDA)")
    args = parser.parse_args()

    if args.cpu:
        cpu_only = True
    elif args.gpu:
        cpu_only = False
    else:
        # Auto-detect
        cpu_only = not has_cuda()
        if cpu_only:
            print("No GPU detected — building CPU version.")
            print("Use --gpu to force GPU build (requires CUDA to be installed).\n")

    build(cpu_only=cpu_only)
