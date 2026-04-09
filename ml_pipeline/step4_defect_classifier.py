"""Step 4: Defect classification (YOLO11n-cls).

Usage examples:
    python ml_pipeline/step4_defect_classifier.py prepare --source ./raw/Leather_Defect_Classification --out ./ml_pipeline/data/leather_yolo_data
    python ml_pipeline/step4_defect_classifier.py train --data ./ml_pipeline/data/leather_yolo_data
  python ml_pipeline/step4_defect_classifier.py infer --weights ./runs/classify/defect_classifier/weights/best.pt --image ./sample.jpg
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
from pathlib import Path

from ultralytics import YOLO


def prepare_train_val_split(source_root: str, out_root: str, train_ratio: float, seed: int) -> None:
    random.seed(seed)
    source = Path(source_root)
    out = Path(out_root)
    train_dir = out / "train"
    val_dir = out / "val"
    train_dir.mkdir(parents=True, exist_ok=True)
    val_dir.mkdir(parents=True, exist_ok=True)

    classes = [d for d in os.listdir(source) if (source / d).is_dir()]
    for cls in classes:
        src_folder = source / cls
        (train_dir / cls).mkdir(parents=True, exist_ok=True)
        (val_dir / cls).mkdir(parents=True, exist_ok=True)

        images = [f for f in os.listdir(src_folder) if (src_folder / f).is_file() and f.lower().endswith((".jpg", ".jpeg", ".png"))]
        random.shuffle(images)
        split_idx = int(len(images) * train_ratio)

        for img in images[:split_idx]:
            shutil.copy(src_folder / img, train_dir / cls / img)
        for img in images[split_idx:]:
            shutil.copy(src_folder / img, val_dir / cls / img)

    print(f"Prepared dataset at: {out.resolve()}")


def train_defect_classifier(data_dir: str, project: str, name: str, epochs: int, imgsz: int) -> None:
    model = YOLO("yolo11n-cls.pt")
    model.train(data=data_dir, epochs=epochs, imgsz=imgsz, project=project, name=name, plots=True, exist_ok=True)
    best = Path(project) / name / "weights" / "best.pt"
    print(f"Training completed. Weights: {best.resolve()}")


def classify_image(weights: str, image_path: str) -> None:
    model = YOLO(weights)
    results = model(image_path)

    for r in results:
        if r.probs is None:
            print("No class probabilities found.")
            continue

        top5_indices = r.probs.top5
        top5_conf = r.probs.top5conf.tolist()
        names = r.names
        print(f"Classification results for {Path(image_path).name}:")
        for idx, conf in zip(top5_indices, top5_conf):
            print(f"  - {names[idx]}: {conf:.2f}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Step 4: defect classifier")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_prepare = sub.add_parser("prepare")
    p_prepare.add_argument("--source", required=True, help="Folder with class subfolders")
    p_prepare.add_argument("--out", default="./ml_pipeline/data/leather_yolo_data")
    p_prepare.add_argument("--train-ratio", type=float, default=0.8)
    p_prepare.add_argument("--seed", type=int, default=51)

    p_train = sub.add_parser("train")
    p_train.add_argument("--data", default="./ml_pipeline/data/leather_yolo_data")
    p_train.add_argument("--project", default="./ml_pipeline/runs/classify")
    p_train.add_argument("--name", default="defect_classifier")
    p_train.add_argument("--epochs", type=int, default=30)
    p_train.add_argument("--imgsz", type=int, default=224)

    p_infer = sub.add_parser("infer")
    p_infer.add_argument("--weights", required=True)
    p_infer.add_argument("--image", required=True)

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.cmd == "prepare":
        prepare_train_val_split(args.source, args.out, args.train_ratio, args.seed)
    elif args.cmd == "train":
        train_defect_classifier(args.data, args.project, args.name, args.epochs, args.imgsz)
    elif args.cmd == "infer":
        classify_image(args.weights, args.image)


if __name__ == "__main__":
    main()
