from ultralytics import YOLO
from pathlib import Path
print("Debugging training step...")
print("PY:", __import__('sys').executable)
data = Path("ml_pipeline/data/handbag_dataset/dataset.yaml")
print("data exists:", data.exists(), data)
m = YOLO("yolo11n.pt")
# short, single-epoch debug run, single-process data loading
m.train(data=str(data), epochs=1, imgsz=320, batch=8, workers=0, project="./ml_pipeline/runs", name="debug")
print("done")