# check_cuda.py
import torch
print("cuda available:", torch.cuda.is_available())
print("cuda devices:", torch.cuda.device_count())
if torch.cuda.is_available():
    print("device0:", torch.cuda.get_device_name(0))