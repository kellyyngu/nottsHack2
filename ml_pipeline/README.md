# ML Verifier Backend (FastAPI)

This service provides the image verification endpoint used by the mint flow.

## Start The Backend Connection

1. Open a terminal in the project root and activate your environment:

```bash
source .venv/Scripts/activate
```

2. Start the verifier API from the `ml_pipeline` folder:

```bash
cd ml_pipeline
uvicorn main:app --host 0.0.0.0 --port 8000
```

3. Keep this terminal running. The mint page sends verification requests to:

`http://127.0.0.1:8000/verify`

## Also Start The Main App Backend

In a second terminal, run the Node/Express backend from the repository root:

```bash
npm start
```

The frontend needs both services:

- Express app: handles `/mint`, `/upload-image`, `/catalog`, etc.
- FastAPI verifier: handles `/verify`

## Quick Connectivity Checks

Verifier health:

```bash
curl http://127.0.0.1:8000/
```

Expected response includes:

```json
{"status":"online","model":"HashBag v1.0"}
```

If `Cannot POST /verify` appears, confirm:

1. Uvicorn is running on port `8000`
2. Frontend is calling `http://127.0.0.1:8000/verify`
3. No firewall/proxy is blocking localhost calls