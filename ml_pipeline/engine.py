import torch
from ultralytics import YOLO
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

class EcoTraceEngine:
    def __init__(self, gatekeeper_path, security_path, material_path, defect_path):
        self.gatekeeper = YOLO(gatekeeper_path)
        self.security = self._load_resnet(security_path)
        self.material_model = YOLO(material_path)
        self.defect_model = YOLO(defect_path)
        
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])

    def _load_resnet(self, path):
        model = models.resnet50(weights=models.ResNet50_Weights.DEFAULT)
        num_ftrs = model.fc.in_features
        model.fc = nn.Sequential(
            nn.Linear(num_ftrs, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 2),
        )
        
        model.load_state_dict(torch.load(path, map_location='cpu'))
        model.eval()
        return model

    def _get_tiles(self, img):
        """Splits the image into a 2x2 grid (4 tiles)"""
        w, h = img.size
        mid_w, mid_h = w // 2, h // 2
        
        # left, top, right, bottom
        quadrants = [
            (0, 0, mid_w, mid_h),          # Top-Left
            (mid_w, 0, w, mid_h),          # Top-Right
            (0, mid_h, mid_w, h),          # Bottom-Left
            (mid_w, mid_h, w, h)           # Bottom-Right
        ]
        return [img.crop(q) for q in quadrants]
    
    def run_full_audit(self, image_path):
        # Bag Detection (Gatekeeper)
        det_results = self.gatekeeper(image_path)
        first_result = det_results[0]
        boxes = first_result.boxes
        detected_objects = []
        allowed_classes = {"handbag", "bag", "suitcase"}

        if boxes:
            for box in boxes:
                class_id = int(box.cls.item()) if box.cls is not None else None
                class_name = first_result.names[class_id] if class_id is not None else "unknown"
                detected_objects.append({
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": round(float(box.conf.item()), 2),
                    "bbox": [round(float(value), 2) for value in box.xyxy[0].tolist()]
                })

        handbag_detection = next(
            (
                detection for detection in detected_objects
                if detection["class_name"].lower().strip() in allowed_classes
            ),
            None
        )

        if not boxes:
            return {
                "error": "No handbag found",
                "gatekeeper_detections": detected_objects
            }

        if handbag_detection is None:
            return {
                "error": "No handbag found",
                "gatekeeper_detections": detected_objects,
                "reason": "Gatekeeper detected objects, but none were classified as handbag."
            }
        
        # Crop the bag for the next steps
        crop_indices = handbag_detection["bbox"]
        img = Image.open(image_path).convert('RGB')
        bag_crop = img.crop(crop_indices)

        # AI vs Real Check
        input_tensor = self.transform(bag_crop).unsqueeze(0)
        with torch.no_grad():
            security_out = self.security(input_tensor)
            security_probs = torch.softmax(security_out, dim=1)[0]
            real_confidence = float(security_probs[0].item())
            synthetic_confidence = float(security_probs[1].item())
            is_real = torch.argmax(security_out) == 0 # 0=Real, 1=Synthetic

        print(
            f"AI vs Real check - real confidence: {real_confidence:.4f}, synthetic confidence: {synthetic_confidence:.4f}"
        )
        
        if not is_real:
            return {"verification": "FAILED", "reason": "AI-Generated Image Detected"}

        # Material analysis
        mat_results = self.material_model(bag_crop)
        material = mat_results[0].names[mat_results[0].probs.top1]
        
        # Tile-based defect analysis
        tiles = self._get_tiles(bag_crop)
        detected_defects = []

        for i, tile in enumerate(tiles):
            def_results = self.defect_model(tile)
            top_class = def_results[0].names[def_results[0].probs.top1]
            confidence = def_results[0].probs.top1conf.item()

            # Logic: If it's NOT the 'Normal' class and confidence is high, record it
            if top_class.lower() != "normal" and confidence > 0.5:
                detected_defects.append({
                    "quadrant": i + 1,
                    "type": top_class,
                    "confidence": round(confidence, 2)
                })

        # Construct final Blockchain Metadata
        return {
            "verification": "PASSED",
            "gatekeeper_detections": detected_objects,
            "material": material,
            "defects": detected_defects,
            "audit_summary": f"Detected {len(detected_defects)} potential issues.",
            "requires_human_grading": True
        }