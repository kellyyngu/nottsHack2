# Dash Wallet Payments

This project has been reduced to a Dash L1 payment flow.

It uses a mnemonic-derived Dash wallet to generate unique receive addresses for invoices, then checks incoming payments through a public block explorer.

## What it does

- Derives a Dash receive address from `DASH_MNEMONIC`
- Creates unique invoice addresses for checkout requests
- Stores invoices locally in `data/wallet-payments.json`
- Verifies payment status against a public explorer

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file with at least:

```env
DASH_NETWORK=testnet
DASH_MNEMONIC=your 12 or 24 word mnemonic here
PORT=3000
```

Optional settings:

```env
DASH_WALLET_PASSPHRASE=
DASH_DERIVATION_PATH=m/44'/1'/0'/0
DASH_EXPLORER_BASE_URL=https://api.blockchair.com
DASH_EXPLORER_NETWORK_PREFIX=dash
```

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## API

### `GET /health`

Returns server status and the primary receive address.

### `GET /api/wallet`

Returns the active network and receive address.

### `GET /api/invoices`

Lists saved invoices.

### `POST /api/invoices`

Creates a payment request.

Request body:

```json
{
  "amountDash": 0.25,
  "reference": "Order #1042",
  "memo": "Optional note"
}
```

### `GET /api/invoices/:id/verify`

Re-checks the invoice address against the explorer and updates the stored payment state.

## Notes

- This repo no longer depends on Dash Platform identities or contracts.
- The remaining NFT and marketplace files are legacy and are not used by the wallet payment server.