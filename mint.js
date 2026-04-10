import { ethers } from "ethers";
import { fileURLToPath } from "url";

// Minimal ABI containing only the safeMint function.
const LUXURY_PASSPORT_ABI = [
  "function safeMint(address to, string bagName, string condition, string material, string imageURI) external returns (uint256 tokenId)"
];

/**
 * Calls safeMint on LuxuryPassportNFT and waits for confirmation.
 *
 * @param {Object} params
 * @param {string} params.contractAddress Deployed contract address
 * @param {ethers.Signer} params.signer Ethers signer
 * @param {string} params.to Recipient wallet address
 * @param {string} params.bagName Bag name
 * @param {string} params.condition Bag condition
 * @param {string} params.material Bag material
 * @param {string} params.imageURI Bag image URI/data URI
 * @returns {Promise<{hash: string, receipt: any}>}
 */
export async function mintLuxuryPassport({
  contractAddress,
  signer,
  to,
  bagName,
  condition,
  material,
  imageURI
}) {
  const contract = new ethers.Contract(contractAddress, LUXURY_PASSPORT_ABI, signer);

  const tx = await contract.safeMint(to, bagName, condition, material, imageURI);
  const receipt = await tx.wait();

  return {
    hash: tx.hash,
    receipt
  };
}

// Optional Node usage example:
// Set CONTRACT_ADDRESS and PRIVATE_KEY in environment variables, then run `node mint.js`
const __filename = fileURLToPath(import.meta.url);

if (__filename === process.argv[1]) {
  const RPC_URL = "http://127.0.0.1:8545";
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const privateKey = process.env.PRIVATE_KEY;

  if (!contractAddress || !privateKey) {
    console.error("Set CONTRACT_ADDRESS and PRIVATE_KEY before running this file directly.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(privateKey, provider);

  const result = await mintLuxuryPassport({
    contractAddress,
    signer,
    to: await signer.getAddress(),
    bagName: "Lady Dior",
    condition: "Excellent",
    material: "Lambskin",
    imageURI: "https://example.com/lady-dior.png"
  });

  console.log("Mint tx hash:", result.hash);
}
