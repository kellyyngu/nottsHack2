## Files

- `step1_bag_detection.py`: handbag detection dataset prep, training, and crop inference
- `step2_real_vs_ai.py`: real-vs-AI dataset extraction and ResNet50 training
- `step3_material_classifier.py`: YOLO11 classification for material type
- `step4_defect_classifier.py`: defect dataset split, training, and inference
- `run_step.py`: tiny dispatcher to run any step
- `requirements-ml.txt`: Python dependencies

## Setup

```bash
pip install -r ml_pipeline/requirements-ml.txt
```

## Step 1: Bag Detection

```bash
python ml_pipeline/step1_bag_detection.py prepare --export-dir ./data/handbag_dataset
python ml_pipeline/step1_bag_detection.py train --data ./data/handbag_dataset/dataset.yaml --project ./runs/detect --name bag_detector
python ml_pipeline/step1_bag_detection.py infer --weights ./runs/detect/bag_detector/weights/best.pt --image ./sample.jpg
```

## Step 2: Real vs AI

```bash
python ml_pipeline/step2_real_vs_ai.py extract --zip ./ai-generated-images-vs-real-images.zip --target ./data/mscoco_security
python ml_pipeline/step2_real_vs_ai.py train --data-dir ./data/mscoco_security/train --save ./weights/ai_detector_weights.pth
```

## Step 3: Material Classifier

```bash
python ml_pipeline/step3_material_classifier.py --data ./materials_dataset --project ./runs/classify --name material_classifier
```

## Step 4: Defect Classifier

```bash
python ml_pipeline/step4_defect_classifier.py prepare --source ./raw/Leather_Defect_Classification --out ./data/leather_yolo_data
python ml_pipeline/step4_defect_classifier.py train --data ./data/leather_yolo_data --project ./runs/classify --name defect_classifier
python ml_pipeline/step4_defect_classifier.py infer --weights ./runs/classify/defect_classifier/weights/best.pt --image ./sample.jpg
```

## Optional: Run via dispatcher

```bash
python ml_pipeline/run_step.py step1 train --data ./data/handbag_dataset/dataset.yaml
python ml_pipeline/run_step.py step4 infer --weights ./runs/classify/defect_classifier/weights/best.pt --image ./sample.jpg
```

## Notes

- These scripts are designed for standard Python, not notebook magics.
- Keep dataset paths local and adjust command paths to your environment.
- For Kaggle downloads, ensure your Kaggle auth credentials are configured.
