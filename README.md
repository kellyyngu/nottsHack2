# Luxury Passport NFT

Production-style local demo for minting and reading ERC-721 bag passports without MetaMask.

The app uses a backend signer (server-side private key) to mint NFTs, then exposes read endpoints used by a simple web UI.

## Overview

Architecture flow:

`index.html -> Express API (/mint, /read) -> ethers.js -> Hardhat local chain`

Core components:

- `contracts/LuxuryPassportNFT.sol`: ERC-721 contract with bag metadata (`bagName`, `condition`, `material`)
- `server.js`: Express server for minting and reading token data
- `mint.js`: Mint helper used by the backend
- `deploy.js`: Contract deployment script
- `index.html`: Frontend UI served by Express

## Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm

## Install

```bash
npm install
```

## Environment Variables

You can set environment variables directly in PowerShell (or use `.env.example` as reference).

- `RPC_URL`: JSON-RPC endpoint (default local Hardhat node)
- `CONTRACT_ADDRESS`: deployed NFT contract address
- `PRIVATE_KEY`: backend signer private key (for minting)
- `PORT`: Express server port

PowerShell example:

```powershell
$env:RPC_URL="http://127.0.0.1:8545"
$env:CONTRACT_ADDRESS="0xYOUR_DEPLOYED_CONTRACT"
$env:PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
$env:PORT="3003"
```

## Run Locally (End-to-End)

1. Start local blockchain:

```bash
npx hardhat node
```

2. Deploy contract (in a second terminal):

```bash
npm run deploy:node
```

3. Copy the deployed address and set env vars (example above).

4. Start backend:

```bash
npm start
```

5. Open UI:

`http://localhost:<PORT>/index.html`

Important: open the frontend through the same backend port so `/mint` and `/read` resolve correctly.

## Available Scripts

- `npm run compile`: compile Solidity contracts with Hardhat
- `npm run deploy:localhost`: deploy using Hardhat runtime on `localhost`
- `npm run deploy:node`: deploy using `deploy.js`
- `npm start`: start Express backend

## API Reference

### Health Check

`GET /health`

Response:

```json
{ "ok": true }
```

### Mint NFT

`POST /mint`

Request body:

```json
{
  "bagName": "Lady Dior",
  "condition": "Excellent",
  "material": "Lambskin"
}
```

Success response:

```json
{
  "success": true,
  "txHash": "0x...",
  "tokenId": "0",
  "blockNumber": 6
}
```

### Read NFT Metadata

`GET /read?tokenId=<id>`

Success response:

```json
{
  "success": true,
  "tokenId": 0,
  "owner": "0x...",
  "metadata": {
    "bagName": "Lady Dior",
    "condition": "Excellent",
    "material": "Lambskin"
  }
}
```

If token is not minted, API returns `404`:

```json
{
  "success": false,
  "error": "Token 4 does not exist (not minted yet)."
}
```

## Quick Verification Commands (PowerShell)

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3003/health"
Invoke-RestMethod -Method Post -Uri "http://localhost:3003/mint" -ContentType "application/json" -Body '{"bagName":"Speedy 25","condition":"Very Good","material":"Canvas"}'
Invoke-RestMethod -Method Get -Uri "http://localhost:3003/read?tokenId=0"
curl.exe -i "http://localhost:3003/read?tokenId=999"
```

## How to get `CONTRACT_ADDRESS` and `PRIVATE_KEY`

Follow these steps to obtain the values you need to set in your environment.

- CONTRACT_ADDRESS
  - When you deploy the contract with `npm run deploy:node` (or `node deploy.js`) the deploy script prints the deployed address to the console. Example output:

```text
LuxuryPassportNFT deployed to: 0xe7f1725E7734CE288F8367e1Bb143E90dd3F0521
```

  - Copy that address and set `CONTRACT_ADDRESS` to it.

- PRIVATE_KEY (local development only)
  - If you run a local Hardhat node with `npx hardhat node`, the node prints unlocked accounts and their private keys; copy the one you want to use. Example Hardhat console snippet:

```text
Accounts
========
WARNING: These accounts, and their private keys, are publicly known. Any funds sent to them on Mainnet WILL BE LOST.

Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000.0 ETH)
Private Key: 0xac0974bec39a28e36ba5b6b4d238ff944bacb478cbed5efcae784d7bf4f2gg90
```

  - Copy the `Private Key:` value and set `PRIVATE_KEY` to it.

