"""Step 3: Material classification (YOLO11n-cls).

Usage example:
    python ml_pipeline/step3_material_classifier.py train --data ./ml_pipeline/data/materials_dataset --project ./ml_pipeline/runs/classify --name material_classifier
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def train_material_classifier(data_dir: str, project: str, name: str, epochs: int, imgsz: int) -> None:
    model = YOLO("yolo11n-cls.pt")
    model.train(data=data_dir, epochs=epochs, imgsz=imgsz, project=project, name=name, exist_ok=True)

    best = Path(project) / name / "weights" / "best.pt"
    print(f"Training completed. Weights: {best.resolve()}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Step 3: material classifier training")
    parser.add_argument("train", nargs="?", default="train")
    parser.add_argument("--data", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\materials_dataset")
    parser.add_argument("--project", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\materials_dataset") # change file path
    parser.add_argument("--name", default="material_classifier")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=224)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    train_material_classifier(args.data, args.project, args.name, args.epochs, args.imgsz)


if __name__ == "__main__":
    main()
