"""Tiny runner for step scripts.

        Examples:
    python ml_pipeline/run_step.py step1 train --data ./ml_pipeline/data/handbag_dataset/dataset.yaml
    python ml_pipeline/run_step.py step3 --data ./ml_pipeline/data/materials_dataset
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SCRIPT_MAP = {
    "step1": "step1_bag_detection.py",
    "step2": "step2_real_vs_ai.py",
    "step3": "step3_material_classifier.py",
    "step4": "step4_defect_classifier.py",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one pipeline step script")
    parser.add_argument("step", choices=SCRIPT_MAP.keys())
    parser.add_argument("args", nargs=argparse.REMAINDER, help="Arguments passed to step script")
    parsed = parser.parse_args()

    script = Path(__file__).parent / SCRIPT_MAP[parsed.step]
    cmd = [sys.executable, str(script)] + parsed.args
    print("Running:", " ".join(cmd))

    result = subprocess.run(cmd)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
