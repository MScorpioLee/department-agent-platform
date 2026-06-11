from __future__ import annotations

import argparse
import platform
import subprocess
import sys
from pathlib import Path


def binary_name() -> str:
    return "agent-runner.exe" if platform.system() == "Windows" else "agent-runner"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Agent Runner single-file executable")
    parser.add_argument("--clean", action="store_true", help="Remove PyInstaller cache before building")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", str(root / "agent-runner.spec")]
    if args.clean:
        command.insert(3, "--clean")

    subprocess.run(command, cwd=root, check=True)
    output = root / "dist" / binary_name()
    print(f"Built {output}")


if __name__ == "__main__":
    main()
