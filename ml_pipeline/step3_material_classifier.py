"""Step 3: Material classification (YOLO11n-cls).

Usage example:
    python ml_pipeline/step3_material_classifier.py train --data ./ml_pipeline/data/materials_dataset --project ./ml_pipeline/runs/classify --name material_classifier
    python ml_pipeline/step3_material_classifier.py infer --weights ./ml_pipeline/runs/classify/material_classifier/weights/best.pt --image ./some_image.jpg
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

from ultralytics import YOLO


def train_material_classifier(data_dir: str, project: str, name: str, epochs: int, imgsz: int) -> None:
    model = YOLO("yolo11n-cls.pt")
    model.train(data=data_dir, epochs=epochs, imgsz=imgsz, project=project, name=name, exist_ok=True)

    best = Path(project) / name / "weights" / "best.pt"
    print(f"Training completed. Weights: {best.resolve()}")


def infer_single_image(weights_path: str, image_path: str) -> None:
    image_file = Path(image_path)
    if not image_file.exists():
        raise FileNotFoundError(f"Image not found: {image_file.resolve()}")

    model = YOLO(weights_path)
    results = model.predict(source=str(image_file), verbose=False)

    if not results:
        print("No prediction results returned.")
        return

    result = results[0]
    if not hasattr(result, "probs") or result.probs is None:
        print("Prediction completed, but no class probabilities were returned.")
        return

    top_index = int(result.probs.top1)
    top_confidence = float(result.probs.top1conf.item())
    class_name = result.names[top_index]

    print(f"Image: {image_file.resolve()}")
    print(f"Predicted class: {class_name}")
    print(f"Confidence: {top_confidence:.4f}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Step 3: material classifier training and inference")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="Train the material classifier")
    train_parser.add_argument("--data", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\materials_dataset")
    train_parser.add_argument("--project", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\materials_dataset")  # change file path
    train_parser.add_argument("--name", default="material_classifier")
    train_parser.add_argument("--epochs", type=int, default=50)
    train_parser.add_argument("--imgsz", type=int, default=224)

    infer_parser = subparsers.add_parser("infer", help="Run inference for a single image")
    infer_parser.add_argument("--weights", required=True, help="Path to trained classifier weights (.pt)")
    infer_parser.add_argument("--image", required=True, help="Path to the image file to classify")

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.command == "train":
        train_material_classifier(args.data, args.project, args.name, args.epochs, args.imgsz)
    elif args.command == "infer":
        infer_single_image(args.weights, args.image)


if __name__ == "__main__":
    main()
