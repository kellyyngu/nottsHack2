"""Step 1: Bag detection and cropping (YOLO11n detection).

Usage examples:
    python ml_pipeline/step1_bag_detection.py prepare --export-dir ./ml_pipeline/data/handbag_dataset
    python ml_pipeline/step1_bag_detection.py train --data ./ml_pipeline/data/handbag_dataset/dataset.yaml
    python ml_pipeline/step1_bag_detection.py infer --weights ./runs/detect/bag_detector/weights/best.pt --image ./sample.jpg
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Optional

import cv2
from ultralytics import YOLO


def prepare_openimages_dataset(export_dir: str, train_samples: int, val_samples: int, seed: int) -> None:
    import fiftyone as fo
    import fiftyone.zoo as foz

    split_targets = {"train": train_samples, "validation": val_samples}
    export_classes = ["Handbag"]

    for oi_split, count in split_targets.items():
        print(f"Downloading {count} samples for split={oi_split}")
        dataset = foz.load_zoo_dataset(
            "open-images-v7",
            split=oi_split,
            label_types=["detections"],
            classes=["Handbag"],
            max_samples=count,
            shuffle=True,
            seed=seed,
        )

        yolo_split = "val" if oi_split == "validation" else "train"
        dataset.export(
            export_dir=export_dir,
            dataset_type=fo.types.YOLOv5Dataset,
            label_field="ground_truth",
            split=yolo_split,
            classes=export_classes,
        )
        dataset.delete()

    print(f"Dataset exported at: {os.path.abspath(export_dir)}")


def train_detector(data_yaml: str, project: str, name: str, epochs: int, imgsz: int, workers: int = 0) -> None:
    model = YOLO("yolo11n.pt")
    # On Windows multiprocessing with multiple DataLoader workers can cause
    # worker subprocesses to exit unexpectedly depending on dataset I/O.
    # Use workers=0 (single-process data loading) for stability.
    model.train(data=data_yaml, epochs=epochs, imgsz=imgsz, project=project, name=name, workers=workers)
    best = Path(project) / name / "weights" / "best.pt"
    print(f"Training completed. Weights: {best.resolve()}")


def detect_and_crop_bag(weights: str, image_path: str, output_folder: str, conf: float = 0.5) -> Optional[str]:
    model = YOLO(weights)
    os.makedirs(output_folder, exist_ok=True)

    # COCO classes: backpack=24, handbag=26
    results = model.predict(source=image_path, classes=[24, 26], conf=conf)

    for r in results:
        if len(r.boxes) == 0:
            print("No bag detected.")
            return None

        box = r.boxes[0]
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
        img = cv2.imread(image_path)
        cropped = img[y1:y2, x1:x2]

        save_path = os.path.join(output_folder, f"cropped_{Path(image_path).name}")
        cv2.imwrite(save_path, cropped)
        print(f"Detected with confidence={float(box.conf[0]):.2f}")
        print(f"Saved: {save_path}")
        return save_path

    return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Step 1: bag detection pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_prepare = sub.add_parser("prepare", help="Download/export Open Images handbag dataset")
    p_prepare.add_argument("--export-dir", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step1")
    p_prepare.add_argument("--train-samples", type=int, default=1000)
    p_prepare.add_argument("--val-samples", type=int, default=200)
    p_prepare.add_argument("--seed", type=int, default=51)

    p_train = sub.add_parser("train", help="Train YOLO detector")
    p_train.add_argument("--data", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step1\\dataset.yaml")
    p_train.add_argument("--project", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step1")
    p_train.add_argument("--name", default="bag_detector")
    p_train.add_argument("--epochs", type=int, default=30)
    p_train.add_argument("--imgsz", type=int, default=640)
    p_train.add_argument("--workers", type=int, default=0, help="DataLoader workers (0 = single-process, safer on Windows)")

    p_infer = sub.add_parser("infer", help="Detect and crop a bag from one image")
    p_infer.add_argument("--weights", required=True)
    p_infer.add_argument("--image", required=True)
    p_infer.add_argument("--output-folder", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step1\\cropped_bags")
    p_infer.add_argument("--conf", type=float, default=0.5)

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.cmd == "prepare":
        prepare_openimages_dataset(args.export_dir, args.train_samples, args.val_samples, args.seed)
    elif args.cmd == "train":
        train_detector(args.data, args.project, args.name, args.epochs, args.imgsz, args.workers)
    elif args.cmd == "infer":
        detect_and_crop_bag(args.weights, args.image, args.output_folder, args.conf)


if __name__ == "__main__":
    main()
