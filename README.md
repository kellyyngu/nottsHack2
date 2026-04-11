# Luxury Passport NFT

Hybrid payment/storage demo where users settle in Dash while the backend sponsor writes NFT data on Sepolia using ETH gas.

The app uses a backend signer (server-side private key) to mint NFTs on Sepolia and exposes read endpoints used by a simple web UI.

Hybrid model:

- Users pay and receive value in Dash.
- Backend verifies Dash TXIDs against the configured merchant address.
- Developer backend signer pays a small ETH fee to store NFT data on Sepolia.

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
- `BASE_SEPOLIA_RPC_URL`: Base Sepolia RPC endpoint for deployment (optional if using Base)
- `BASE_SEPOLIA_PRIVATE_KEY`: deployer private key for Base Sepolia (optional if using Base)
- `DASH_NETWORK`: `testnet` or `mainnet` (used for payment verification)
- `DASH_MERCHANT_ADDRESS`: Dash address that receives user payments
- `DASH_MIN_PAYMENT`: minimum required Dash amount before minting
- `DASH_EXPLORER_BASE_URL`: optional explorer API override
- `STORAGE_CHAIN_NAME`: chain name for NFT storage metadata (default: `sepolia`)
- `STORAGE_CHAIN_ID`: expected chain ID for storage signer (default: `11155111`)
- `ENFORCE_STORAGE_CHAIN`: when `true`, reject mints if signer RPC is not on configured storage chain

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
- `npm run deploy:ignition:localhost`: deploy via Hardhat Ignition to localhost
- `npm run deploy:ignition:base-sepolia`: deploy via Hardhat Ignition to Base Sepolia
- `npm run deploy:node`: deploy using `deploy.js`
- `npm start`: start Express backend

## Base Sepolia Deployment (Hardhat Ignition)

1. Set deployment environment variables:

```bash
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
export BASE_SEPOLIA_PRIVATE_KEY="0xYOUR_BASE_DEPLOYER_PRIVATE_KEY"
```

2. Compile and deploy with Ignition:

```bash
npm run compile
npm run deploy:ignition:base-sepolia
```

3. Copy the deployed contract address from Ignition output and set `CONTRACT_ADDRESS` for the backend.

## Dash Payment TXID Mint Flow (Hybrid)

The mint flow now requires a verified Dash payment transaction ID (`dashTxId`) before minting.

1. User opens the sell page and gets the merchant Dash address from `GET /dash/payment-info`.
2. User sends Dash payment from their own wallet.
3. User pastes the resulting Dash TXID into the sell form and clicks verify.
4. Backend validates TXID via Dash explorer and confirms payment to `DASH_MERCHANT_ADDRESS`.
5. If valid, backend signer submits the mint transaction and stores `dashTxId` on-chain in NFT metadata.
6. NFT record is stored on Sepolia; gas fee is paid by backend signer in ETH.

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
  "material": "Lambskin",
  "imageURI": "/uploads/example.jpg",
  "dashTxId": "<64-char-dash-transaction-id>"
}
```

Success response:

```json
{
  "success": true,
  "paymentModel": "dash-user-payments + developer-sponsored-sepolia-storage",
  "txHash": "0x...",
  "dashTxId": "...",
  "tokenId": "0",
  "blockNumber": 6,
  "nftStorage": {
    "chain": "sepolia",
    "chainId": 11155111,
    "contractAddress": "0x...",
    "owner": "0x...",
    "storageFeeCurrency": "ETH",
    "storageFeePayer": "0x...",
    "estimatedStorageFeeEth": "0.000123"
  }
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
    "material": "Lambskin",
    "imageURI": "/uploads/example.jpg",
    "dashTxId": "..."
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

