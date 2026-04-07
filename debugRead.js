import { ethers } from "ethers";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC);

const contractAddress = process.env.CONTRACT_ADDRESS || process.argv[2];
const tokenId = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : (process.argv[3] ? Number(process.argv[3]) : 0);

if (!contractAddress) {
  console.error("Usage: CONTRACT_ADDRESS env var or node debugRead.js <contractAddress> [tokenId]");
  process.exit(1);
}

(async function(){
  try {
    const code = await provider.getCode(contractAddress);
    console.log("Contract code length:", code.length, code === "0x" ? "(no code)" : "(has code)");

    const iface = new ethers.Interface(["function getBagMetadata(uint256) view returns (string,string,string)"]);
    const data = iface.encodeFunctionData("getBagMetadata", [tokenId]);
    console.log("Encoded call data:", data);

    const res = await provider.call({ to: contractAddress, data });
    console.log("Raw call result:", res);

    if (res === "0x") {
      console.log("Empty result — call returned no data (revert or function missing)");
    } else {
      const decoded = iface.decodeFunctionResult("getBagMetadata", res);
      console.log("Decoded result:", decoded);
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
