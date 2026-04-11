import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LuxuryPassportNFTModule = buildModule("LuxuryPassportNFTModule", (m) => {
  const luxuryPassportNFT = m.contract("LuxuryPassportNFT", []);
  return { luxuryPassportNFT };
});

export default LuxuryPassportNFTModule;
