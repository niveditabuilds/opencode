# PyInstaller spec for the bundled voice sidecar binary.
# Built by script/build-binary.sh during voxcode distribution builds.

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).resolve().parent
entry = root / "script" / "pyinstaller-entry.py"
static_dir = root / "src" / "voice_sidecar" / "static"

datas = [(str(static_dir), "voice_sidecar/static")]
binaries = []
hiddenimports = collect_submodules("voice_sidecar")

for package in ("uvicorn", "starlette", "httpx", "websockets", "anyio", "h11", "httpcore", "sniffio"):
    hiddenimports += collect_submodules(package)

for package in ("uvicorn", "starlette", "httpx", "certifi", "websockets"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

hiddenimports = sorted(set(hiddenimports))

a = Analysis(
    [str(entry)],
    pathex=[str(root / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="voice-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
