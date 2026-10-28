const { ethers } = require("hardhat");

const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const DEPLOYER = "0x80a662887A616D09cFc5079005164c6f6EDDFe13";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FROM_TOPIC = "0x000000000000000000000000" + DEPLOYER.slice(2);

async function main() {
  const provider = ethers.provider;
  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);

  // Token creation block - search in recent history
  // Go back in chunks from currentBlock
  const CHUNK = 10000;
  
  for (let end = currentBlock; end > 0; end -= CHUNK) {
    const start = Math.max(0, end - CHUNK);
    try {
      const logs = await provider.getLogs({
        address: TOKEN,
        topics: [TRANSFER_TOPIC, FROM_TOPIC],
        fromBlock: start,
        toBlock: end
      });
      
      for (const log of logs) {
        const toAddr = "0x" + log.topics[2].slice(26);
        const value = ethers.toBigInt(log.data);
        const block = log.blockNumber;
        
        if (toAddr !== "0x50425684634F9AF37D1dE14Bb1140057C421b656" && value > 0n) {
          console.log(`Block ${block}: → ${toAddr}  ${ethers.formatEther(value)} ZTS (tx: ${log.transactionHash})`);
        }
      }
      
      if (start < 47000000) break; // token likely deployed around block 47M+
    } catch (e) {
      // eth_getLogs limited range - just continue
      console.log(`Range ${start}-${end}: ${e.message.substring(0, 100)}`);
    }
  }
  
  console.log("Done searching");
}

main().catch(console.error);
