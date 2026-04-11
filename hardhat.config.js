import dotenv from "dotenv";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatIgnitionEthers from "@nomicfoundation/hardhat-ignition-ethers";

dotenv.config();

const baseSepoliaUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const deployerPk = process.env.BASE_SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const accounts = deployerPk ? [deployerPk] : [];

export default defineConfig({
  plugins: [hardhatEthers, hardhatIgnition, hardhatIgnitionEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true
        }
      },
      production: {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true
        }
      }
    }
  },
  networks: {
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545"
    },
    baseSepolia: {
      type: "http",
      url: baseSepoliaUrl,
      accounts
    }
  }
});
