
# PyInstaller runtime hook for CosyVoice
import sys, os
_root = os.path.join(os.path.dirname(__file__), "cosyvoice_src")
_matcha = os.path.join(_root, "third_party", "Matcha-TTS")
if os.path.isdir(_matcha):
    sys.path.insert(0, _matcha)
sys.path.insert(0, _root)
