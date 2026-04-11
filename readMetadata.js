import { ethers } from "ethers";

// Usage:
// node readMetadata.js <contractAddress> <txHash> [tokenId]
// or set env vars: CONTRACT_ADDRESS, TX_HASH, TOKEN_ID

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC);

const contractAddress = process.env.CONTRACT_ADDRESS || process.argv[2];
const txHash = process.env.TX_HASH || process.argv[3];
const tokenId = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : (process.argv[4] ? Number(process.argv[4]) : 0);

if (!contractAddress) {
  console.error("Missing contract address. Usage: node readMetadata.js <contractAddress> [txHash] [tokenId]");
  process.exit(1);
}

(async function main(){
  try {
    if (txHash) {
      const receipt = await provider.getTransactionReceipt(txHash);
      console.log("Transaction receipt:", receipt);
    }

    // getBagMetadata returns a struct; use tuple return type to decode correctly
    const ABI = [
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,uint256 startBidWei,uint256 bidEndTime))"
    ];
    const contract = new ethers.Contract(contractAddress, ABI, provider);

    const meta = await contract.getBagMetadata(tokenId);
    // meta will be an array-like [bagName, condition, material, imageURI, startBidWei, bidEndTime]
    const startBidWei = meta[4];
    const bidEndTime = meta[5];
    console.log(`Metadata for token ${tokenId}:`);
    console.log({
      bagName: meta[0],
      condition: meta[1],
      material: meta[2],
      imageURI: meta[3],
      startBidWei: startBidWei.toString(),
      startBidEth: ethers.formatUnits(startBidWei, 18),
      bidEndTime: bidEndTime.toString(),
      bidEndTimeIso: new Date(Number(bidEndTime) * 1000).toISOString()
    });
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
