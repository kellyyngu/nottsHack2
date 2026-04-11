import "dotenv/config";
import { setupDashClient } from "./setupDashClient.mjs";

const recipientId = process.env.RECIPIENT_IDENTITY_ID;
const amount = BigInt(process.env.TRANSFER_CREDITS || "1000000");

async function main() {
  if (!recipientId) {
    throw new Error("RECIPIENT_IDENTITY_ID is missing");
  }

  const { sdk, keyManager } = await setupDashClient({ identityIndex: 0 });
  const { identity, signer } = await keyManager.getTransfer();

  console.log("Sender identity:", identity.id.toString());
  console.log("Recipient identity:", recipientId);
  console.log("Amount:", amount.toString());

  const result = await sdk.identities.creditTransfer({
    identity,
    recipientId,
    amount,
    signer,
  });

  console.log("Credit transfer submitted:");
  console.dir(result, { depth: null });
}

try {
  console.log("JSON:", JSON.stringify(result, null, 2));
} catch {}

main().catch((e) => {
  console.error("Transfer failed:");
  console.error("message =", e?.message || e);
  console.error("string =", e?.toString?.() || String(e));
  console.dir(e, { depth: null });
  process.exit(1);
});