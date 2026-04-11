/**
 * create-identity.mjs
 *
 * Standalone script to create a Dash Platform identity on testnet.
 *
 * What it does:
 *   1. Generates a new random BIP39 mnemonic and wallet
 *   2. Attempts to fund the wallet from the testnet faucet
 *   3. Falls back to manual funding if the faucet is unavailable
 *   4. Registers a Platform identity
 *   5. Tops up the identity with remaining wallet funds
 *   6. Prints the final identity ID, mnemonic, and credit balance
 *
 * Usage:
 *   node create-identity.mjs                 # faucet with manual fallback, convert all funds
 *   node create-identity.mjs --amount 1.5    # specify DASH amount for top-up
 *   node create-identity.mjs --amount all    # convert all remaining funds (default)
 *   node create-identity.mjs --manual        # skip faucet, wait for manual funding
 *
 * Configuration:
 *   Network settings (DAPI addresses, faucet URL) are loaded from testnet-config.json
 *   in the same directory. Edit that file if the testnet infrastructure changes.
 *
 * Dependencies:
 *   npm install   # installs the Dash SDK from the public npm registry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUFFS_PER_DASH = 100000000;

// ---------------------------------------------------------------------------
// Global error handlers — catch anything the script might miss
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err) => {
  console.error('\n[FATAL] Uncaught exception:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n[FATAL] Unhandled promise rejection:', reason?.message || reason);
  if (reason?.stack) console.error(reason.stack);
  process.exit(1);
});

// Warn if the process is about to exit before main() completes
let mainCompleted = false;
process.on('exit', (code) => {
  if (!mainCompleted && code === 0) {
    console.error('\n[WARNING] Process exited before completion with no error.');
    console.error('This usually indicates a native module failure or environment issue.');
    console.error('Troubleshooting:');
    console.error('  1. Verify Node.js version: node --version (should be >= 20)');
    console.error('  2. Reinstall dependencies: rm -rf node_modules package-lock.json && npm install');
    console.error('  3. Check for native module errors in a fresh install:');
    console.error('     npm install --verbose 2>&1 | grep -iE "error|fail|gyp"');
    console.error('  4. Try loading the SDK directly to see any errors:');
    console.error('     node -e "import(\'dash\').then(m => console.log(\'dash loaded:\', typeof m.default))"');
  }
});

// ---------------------------------------------------------------------------
// Load Dash SDK with error handling
// ---------------------------------------------------------------------------

let Dash;
try {
  Dash = (await import('dash')).default;
} catch (err) {
  console.error('\n[FATAL] Failed to load the Dash SDK.');
  console.error('Error:', err?.message || err);
  console.error('\nPossible causes:');
  console.error('  - `npm install` was not run in this directory');
  console.error('  - Node.js version is too old (requires >= 20)');
  console.error('  - Native module compilation failed during install');
  console.error('  - node_modules is corrupted (try: rm -rf node_modules && npm install)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load testnet config
// ---------------------------------------------------------------------------

function loadConfig() {
  const configPath = path.join(__dirname, 'testnet-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`testnet-config.json not found at ${configPath}`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`Using testnet config (last verified ${config.lastKnownGoodDate})`);
  console.log(`DAPI addresses: ${config.dapiAddresses.join(', ')}`);
  return config;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { amount: 'all', manual: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--amount' && args[i + 1]) {
      opts.amount = args[++i];
    } else if (args[i] === '--manual') {
      opts.manual = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage:
  node create-identity.mjs [options]

Options:
  --amount <value>   DASH amount to convert to Platform credits after identity
                     registration. Use "all" to convert everything (default).
  --manual           Skip the faucet and wait for manual funding.
  --help             Show this help message.

Examples:
  node create-identity.mjs
  node create-identity.mjs --amount 1.5
  node create-identity.mjs --manual
`);
      process.exit(0);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Faucet funding
// ---------------------------------------------------------------------------

async function fundFromFaucet(address, faucetUrl) {
  console.log(`\nAttempting to fund wallet from faucet for address: ${address}`);
  console.log(`Endpoint: ${faucetUrl}`);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = { rawStatus: res.status };
      }

      if (data.txid) {
        console.log(`Faucet funded successfully. TX: ${data.txid}`);
        return { success: true, txid: data.txid };
      }

      // Detect CAPTCHA requirement — the current faucet requires a browser-based
      // challenge that cannot be solved from a headless script.
      const errMsg = data?.detail?.error || data?.detail || data?.error || '';
      const isCaptcha = typeof errMsg === 'string' && /captcha/i.test(errMsg);
      if (isCaptcha) {
        console.log(`\nFaucet requires a CAPTCHA challenge that cannot be solved from this script.`);
        console.log(`This is a known limitation of the current testnet faucet implementation.`);
        return { success: false, reason: 'captcha_required' };
      }

      console.log(`Faucet response (attempt ${attempt}): HTTP ${res.status}`, data);
    } catch (err) {
      console.log(`Faucet request failed (attempt ${attempt}): ${err.message}`);
    }

    if (attempt < maxAttempts) {
      console.log('Retrying in 5 seconds...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  return { success: false, reason: 'unreachable' };
}

function promptManualFunding(address, config) {
  console.log('\n========================================');
  console.log('  MANUAL FUNDING REQUIRED');
  console.log('========================================');
  console.log(`\n  Send tDash to the following address:\n`);
  console.log(`  ${address}\n`);
  console.log(`  Recommended amount: 1.0 tDash (minimum 0.1 tDash)`);
  console.log(`\n  Option 1: Use the testnet faucet in your browser`);
  console.log(`    ${config.faucetWebUrl}`);
  for (const alt of config.alternativeFaucets || []) {
    console.log(`    ${alt}`);
  }
  console.log(`    (The faucet requires a browser-based CAPTCHA, which is why`);
  console.log(`     this script cannot fund the wallet automatically.)`);
  console.log(`\n  Option 2: Send tDash manually from an existing wallet you control`);
  console.log(`\n  Waiting for funds to arrive (polling every 10 seconds)...`);
  console.log(`  Will timeout after 30 minutes.`);
  console.log('========================================');
}

// ---------------------------------------------------------------------------
// Wait for balance
// ---------------------------------------------------------------------------

async function waitForBalance(account, timeoutSec = 180) {
  const startTime = Date.now();
  let balance = 0;

  while (balance === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > timeoutSec) {
      throw new Error(`Timed out waiting for funds to arrive after ${Math.round(elapsed)}s`);
    }
    await new Promise(r => setTimeout(r, 10000));
    balance = account.getTotalBalance();
    console.log(`  Balance: ${balance} duffs (${(balance / DUFFS_PER_DASH).toFixed(4)} DASH) — ${Math.round(elapsed)}s elapsed`);
  }

  return balance;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const config = loadConfig();

  console.log('\n=== Dash Platform Identity Creation (Testnet) ===\n');

  // mnemonic: null tells the SDK to generate a new random mnemonic.
  // Note: skipSynchronizationBeforeHeight is NOT compatible with a new mnemonic —
  // the SDK throws because there's no history to skip. It's only applied in
  // topup-identity.mjs where we restore an existing wallet.
  const walletOpts = { mnemonic: null };

  console.log('Creating Dash SDK client...');
  let client;
  try {
    client = new Dash.Client({
      network: config.network,
      dapiAddresses: config.dapiAddresses,
      wallet: walletOpts,
    });
  } catch (err) {
    console.error('\n[FATAL] Failed to construct Dash.Client:');
    console.error('Error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    console.error('\nThis typically indicates a Dash SDK native module failure.');
    console.error('Try: rm -rf node_modules package-lock.json && npm install');
    process.exit(1);
  }

  try {
    console.log('Initializing wallet...');
    const account = await client.wallet.getAccount();
    const mnemonic = client.wallet.exportWallet();

    console.log('\n--- WALLET ---');
    console.log(`Mnemonic: ${mnemonic}`);

    const address = account.getUnusedAddress().address;
    console.log(`Funding address: ${address}`);

    // Try faucet first (unless --manual flag is set)
    let faucetResult = { success: false };
    if (!opts.manual) {
      faucetResult = await fundFromFaucet(address, config.faucetUrl);
    }

    let balance;
    if (faucetResult.success) {
      console.log('\nWaiting for faucet transaction to confirm (this may take 2-3 minutes)...');
      balance = await waitForBalance(account, 180);
    } else {
      if (!opts.manual) {
        if (faucetResult.reason === 'captcha_required') {
          console.log('\nFalling back to manual funding (the faucet requires a browser-based CAPTCHA).');
        } else {
          console.log('\nFaucet unreachable — falling back to manual funding.');
        }
      }
      promptManualFunding(address, config);
      balance = await waitForBalance(account, 1800); // 30 minute timeout
    }
    console.log(`\nWallet funded! Balance: ${balance} duffs (${(balance / DUFFS_PER_DASH).toFixed(4)} DASH)`);

    // Register identity
    console.log('\nRegistering Platform identity...');
    const identity = await client.platform.identities.register();

    const identityId = identity.getId().toString();
    const initialCredits = identity.getBalance();

    console.log('\n--- IDENTITY REGISTERED ---');
    console.log(`  Identity ID: ${identityId}`);
    console.log(`  Credits:     ${initialCredits}`);

    // Top up with remaining funds
    const postRegBalance = account.getTotalBalance();
    console.log(`\n--- TOP-UP ---`);
    console.log(`  Wallet balance after registration: ${postRegBalance} duffs (${(postRegBalance / DUFFS_PER_DASH).toFixed(4)} DASH)`);

    let topUpDuffs;
    if (opts.amount === 'all') {
      const txFeeReserve = 10000; // 0.0001 DASH reserve for tx fee
      topUpDuffs = postRegBalance - txFeeReserve;
      console.log(`  Top-up amount: ${topUpDuffs} duffs (all remaining minus ${txFeeReserve} duffs fee reserve)`);
    } else {
      topUpDuffs = Math.round(parseFloat(opts.amount) * DUFFS_PER_DASH);
      if (topUpDuffs > postRegBalance) {
        console.log(`  Warning: requested ${topUpDuffs} duffs but only ${postRegBalance} available. Using max available.`);
        topUpDuffs = postRegBalance - 10000;
      }
      console.log(`  Top-up amount: ${topUpDuffs} duffs (${(topUpDuffs / DUFFS_PER_DASH).toFixed(4)} DASH)`);
    }

    if (topUpDuffs > 0) {
      console.log('  Broadcasting top-up transaction...');
      await client.platform.identities.topUp(identityId, topUpDuffs);

      const updatedIdentity = await client.platform.identities.get(identityId);
      const finalCredits = updatedIdentity.getBalance();

      console.log(`  Top-up complete!`);
      console.log(`  Credits before top-up: ${initialCredits}`);
      console.log(`  Credits after top-up:  ${finalCredits}`);
    } else {
      console.log('  No funds available for top-up.');
    }

    const finalIdentity = await client.platform.identities.get(identityId);

    console.log('\n========================================');
    console.log('  IDENTITY CREATED & FUNDED');
    console.log('========================================');
    console.log(`  Identity ID:   ${identityId}`);
    console.log(`  Mnemonic:      ${mnemonic}`);
    console.log(`  Credits:       ${finalIdentity.getBalance()}`);
    console.log(`  Remaining L1:  ${account.getTotalBalance()} duffs`);
    console.log('========================================');
    console.log('\nSave the mnemonic and identity ID — they are needed for all future operations.');
  } catch (err) {
    console.error('\nError:', err.message || err);
    throw err;
  } finally {
    await client.disconnect();
  }
}

main()
  .then(() => {
    mainCompleted = true;
  })
  .catch((err) => {
    mainCompleted = true;
    console.error('\n[FATAL] Script failed:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  });
