import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import fs from "fs/promises";
import path from "path";

// Standalone deploy script (ethers v6) with multiple signer fallbacks.
async function main() {
  const artifactPath = path.join(process.cwd(), "artifacts", "contracts", "LuxuryPassportNFT.sol", "LuxuryPassportNFT.json");
  const artifactJson = await fs.readFile(artifactPath, "utf8");
  const artifact = JSON.parse(artifactJson);

  const provider = new JsonRpcProvider("http://127.0.0.1:8545");

  const mnemonic = "test test test test test test test test test test test junk";

  let signer;
  // Try Wallet.fromPhrase / fromMnemonic
  try {
    if (Wallet.fromPhrase) {
      signer = Wallet.fromPhrase(mnemonic).connect(provider);
    } else if (Wallet.fromMnemonic) {
      signer = Wallet.fromMnemonic(mnemonic).connect(provider);
    }
  } catch (e) {
    signer = undefined;
  }

  // (no HDNode fallback) final fallback will be provider signer

  // Final fallback: try provider.getSigner(0)
  if (!signer) {
    try {
      signer = provider.getSigner(0);
    } catch (e) {
      throw new Error("No signer available for deployment. Start Hardhat node or provide mnemonic.");
    }
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  // waitForDeployment exists in ethers v6; if not, fallback
  if (contract.waitForDeployment) {
    await contract.waitForDeployment();
  } else if (contract.deployed) {
    await contract.deployed();
  }

  let address;
  try {
    address = await (contract.getAddress ? contract.getAddress() : contract.address);
  } catch {
    address = contract.address;
  }

  console.log(`LuxuryPassportNFT deployed to: ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
