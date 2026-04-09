"""Step 2: Real vs AI image detector (ResNet50 binary classifier).

Usage examples:
  python ml_pipeline/step2_real_vs_ai.py extract --zip ./ai-generated-images-vs-real-images.zip --target ./data/mscoco_security
  python ml_pipeline/step2_real_vs_ai.py train --data-dir ./data/mscoco_security/train --save ./weights/ai_detector_weights.pth
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
import zipfile
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms
from PIL import ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True


def build_model() -> nn.Module:
    model = models.resnet50(weights=models.ResNet50_Weights.DEFAULT)
    num_ftrs = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Linear(num_ftrs, 512),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(512, 2),
    )
    return model


def selective_extract_from_zip(zip_path: str, target_base: str, train_count: int, val_count: int, seed: int) -> None:
    random.seed(seed)
    target = Path(target_base)
    target.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as z:
        all_files = z.namelist()

        train_fake = [f for f in all_files if "train/fake/" in f and f.lower().endswith((".jpg", ".jpeg", ".png"))]
        train_real = [f for f in all_files if "train/real/" in f and f.lower().endswith((".jpg", ".jpeg", ".png"))]
        test_fake = [f for f in all_files if "test/fake/" in f and f.lower().endswith((".jpg", ".jpeg", ".png"))]
        test_real = [f for f in all_files if "test/real/" in f and f.lower().endswith((".jpg", ".jpeg", ".png"))]

        plan = {
            "train/fake": random.sample(train_fake, min(train_count, len(train_fake))),
            "train/real": random.sample(train_real, min(train_count, len(train_real))),
            "val/fake": random.sample(test_fake, min(val_count, len(test_fake))),
            "val/real": random.sample(test_real, min(val_count, len(test_real))),
        }

        for target_folder, file_list in plan.items():
            dest_dir = target / target_folder
            dest_dir.mkdir(parents=True, exist_ok=True)
            for file_path in file_list:
                filename = os.path.basename(file_path)
                with z.open(file_path) as src, open(dest_dir / filename, "wb") as dst:
                    shutil.copyfileobj(src, dst)

    print(f"Dataset extracted to: {target.resolve()}")


def copy_dataset_dir(src_dir: str, target_base: str) -> None:
    """Copy an existing dataset directory into the target location."""
    src = Path(src_dir)
    target = Path(target_base)
    if not src.exists():
        raise FileNotFoundError(f"Source dataset dir does not exist: {src}")
    target.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        dest = target / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest)

    print(f"Dataset copied to: {target.resolve()}")


def train_model(data_dir: str, save_path: str, epochs: int, batch_size: int, lr: float) -> None:
    transform = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )

    dataset = datasets.ImageFolder(data_dir, transform=transform)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    model = build_model()
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    print(f"Training on device={device}")
    for epoch in range(epochs):
        running_loss = 0.0
        for inputs, labels in loader:
            inputs, labels = inputs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()

        print(f"Epoch {epoch + 1}/{epochs} loss={running_loss / max(1, len(loader)):.4f}")

    save_file = Path(save_path)
    save_file.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), save_file)
    print(f"Saved model: {save_file.resolve()}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Step 2: real-vs-ai detector")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_extract = sub.add_parser("extract", help="Prepare dataset from zip or existing folder")
    p_extract.add_argument("--zip", required=False, dest="zip_path", help="Path to source zip (optional)")
    p_extract.add_argument("--data-dir", required=False, dest="data_dir", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step2\\train", help="Existing dataset folder to copy from (optional)")
    p_extract.add_argument("--target", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step2")
    p_extract.add_argument("--train-count", type=int, default=1000)
    p_extract.add_argument("--val-count", type=int, default=500)
    p_extract.add_argument("--seed", type=int, default=51)

    p_train = sub.add_parser("train", help="Train binary classifier")
    p_train.add_argument("--data-dir", default="C:\\Users\\User\\Downloads\\nottsHack4\\ml_pipeline\\step2\\train") # change file path
    p_train.add_argument("--save", default="weights/ai_detector_weights.pth")
    p_train.add_argument("--epochs", type=int, default=10)
    p_train.add_argument("--batch-size", type=int, default=32)
    p_train.add_argument("--lr", type=float, default=1e-4)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.cmd == "extract":
        # Support either extracting from a zip or copying from an existing dataset folder
        if getattr(args, "zip_path", None):
            selective_extract_from_zip(args.zip_path, args.target, args.train_count, args.val_count, args.seed)
        else:
            # use provided data_dir (defaults to ml_pipeline/.../step2/train)
            copy_dataset_dir(args.data_dir, args.target)
    elif args.cmd == "train":
        train_model(args.data_dir, args.save, args.epochs, args.batch_size, args.lr)


if __name__ == "__main__":
    main()
