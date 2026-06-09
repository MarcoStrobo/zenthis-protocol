/**
 * Zenthis Protocol — Full Deploy + Integration Test (single run)
 *
 * Usage: npx hardhat run scripts/deploy-and-test.js --network hardhat
 */

const hre = require("hardhat");
const { ethers } = hre;

function hashlock(preimage) {
  return ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
}
function randomPreimage() {
  return ethers.randomBytes(32);
}

function getSwapId(htlc, receipt) {
  const event = receipt.logs
    .map((log) => {
      try {
        return htlc.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "SwapCreated");
  return event.args[0];
}

async function main() {
  const [deployer, seed, ido, liquidity, team, treasury, founderOps, airdrops] =
    await ethers.getSigners();

  const deployerAddr = await deployer.getAddress();
  const teamAddr = await team.getAddress();
  const seedAddr = await seed.getAddress();
  const idoAddr = await ido.getAddress();
  const liquidityAddr = await liquidity.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const founderOpsAddr = await founderOps.getAddress();
  const airdropsAddr = await airdrops.getAddress();

  let passed = 0,
    failed = 0;
  function check(name, condition) {
    if (condition) {
      console.log(`   ✅ ${name}`);
      passed++;
    } else {
      console.log(`   ❌ ${name}`);
      failed++;
    }
  }

  // ═════════════════════════════════════════════════════════
  //  PHASE 1: DEPLOY
  // ═════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(55));
  console.log("  🚀 PHASE 1: Deploy All Contracts");
  console.log("═".repeat(55) + "\n");

  // ZenthisToken mints MAX_SUPPLY to treasury param; deployer becomes owner
  console.log("📦 Deploying ZenthisToken (treasury = deployer)...");
  const TokenFactory = await ethers.getContractFactory("ZenthisToken");
  const token = await TokenFactory.deploy(deployerAddr);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`   ✓ Token      : ${tokenAddr}`);

  // Verify initial balances
  const deployerBal = await token.balanceOf(deployerAddr);
  const totalSup = await token.totalSupply();
  console.log(`   ✓ Supply     : ${ethers.formatEther(totalSup)} ZENTHIS`);
  console.log(`   ✓ Deployer   : ${ethers.formatEther(deployerBal)} ZENTHIS`);
  console.log(`   ✓ Owner      : ${await token.owner()}`);

  if (deployerBal === 0n) {
    throw new Error("Deployer has 0 tokens — treasury param mismatch");
  }

  console.log("📦 Deploying ZenthisVesting...");
  const vesting = await (
    await ethers.getContractFactory("ZenthisVesting")
  ).deploy(tokenAddr, deployerAddr);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`   ✓ Vesting    : ${vestingAddr}`);

  console.log("📦 Deploying ZenthisHTLC...");
  const htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`   ✓ HTLC       : ${htlcAddr}`);

  console.log("📦 Funding vesting (97M ZENTHIS)...");
  await (await token.transfer(vestingAddr, ethers.parseEther("97000000"))).wait();
  console.log(`   ✓ Funded`);
  console.log(
    `   ✓ Deployer remaining: ${ethers.formatEther(await token.balanceOf(deployerAddr))} ZENTHIS\n`,
  );

  console.log("📦 Creating 7 vesting schedules...");
  const MONTH = 30 * 24 * 3600;
  const TGE = Math.floor(Date.now() / 1000) + 3600;

  const scheduleDefs = [
    { id: ethers.id("SEED"), addr: seedAddr, total: "10000000", tge: "0", cliff: 12, vest: 24 },
    { id: ethers.id("IDO"), addr: idoAddr, total: "12000000", tge: "1200000", cliff: 0, vest: 12 },
    {
      id: ethers.id("LIQUIDITY"),
      addr: liquidityAddr,
      total: "20000000",
      tge: "10000000",
      cliff: 0,
      vest: 6,
    },
    { id: ethers.id("TEAM"), addr: teamAddr, total: "10000000", tge: "0", cliff: 12, vest: 36 },
    {
      id: ethers.id("TREASURY"),
      addr: treasuryAddr,
      total: "18200000",
      tge: "2000000",
      cliff: 0,
      vest: 48,
    },
    {
      id: ethers.id("FOUNDER_OPS"),
      addr: founderOpsAddr,
      total: "8000000",
      tge: "0",
      cliff: 6,
      vest: 30,
    },
    {
      id: ethers.id("AIRDROPS"),
      addr: airdropsAddr,
      total: "0",
      tge: "5000000",
      cliff: 0,
      vest: 0,
    },
  ];

  for (const s of scheduleDefs) {
    await (
      await vesting.createSchedule(
        s.id,
        s.addr,
        ethers.parseEther(s.total),
        ethers.parseEther(s.tge),
        TGE,
        s.cliff,
        s.vest,
      )
    ).wait();
  }
  console.log(`   ✓ ${(await vesting.getScheduleIds()).length} schedules created\n`);

  // ═════════════════════════════════════════════════════════
  //  PHASE 2: INTEGRATION TESTS
  // ═════════════════════════════════════════════════════════
  console.log("═".repeat(55));
  console.log("  🔬 PHASE 2: Integration Tests");
  console.log("═".repeat(55) + "\n");

  // ── Token ────────────────────────────────────────────────
  console.log("📋 Token");
  check("Total supply = 100M", totalSup === ethers.parseEther("100000000"));
  check("Deployer is owner", (await token.owner()) === deployerAddr);

  await token.transfer(teamAddr, ethers.parseEther("1000"));
  check("Transfer 1000 ZENTHIS", (await token.balanceOf(teamAddr)) === ethers.parseEther("1000"));

  await token.connect(team).approve(deployerAddr, ethers.parseEther("300"));
  await token.transferFrom(teamAddr, seedAddr, ethers.parseEther("300"));
  check(
    "TransferFrom via allowance",
    (await token.balanceOf(seedAddr)) === ethers.parseEther("300"),
  );

  const preBurnSupply = await token.totalSupply();
  await token.burn(ethers.parseEther("500"));
  check(
    "Burn reduces supply",
    (await token.totalSupply()) === preBurnSupply - ethers.parseEther("500"),
  );

  // ── HTLC ─────────────────────────────────────────────────
  console.log("\n📋 HTLC");
  check("HTLC owner", (await htlc.owner()) === deployerAddr);

  // Fee management
  await htlc.setFeeBps(200); // 2%
  check("setFeeBps 2%", (await htlc.feeBps()) === 200n);

  // ETH swap → redeem
  const preimage = randomPreimage();
  const hash = hashlock(preimage);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const amount = ethers.parseEther("2");
  const fee = (amount * 200n) / 10000n;
  const net = amount - fee;

  const swapTx1 = await htlc.newSwap(teamAddr, hash, now + 600, { value: amount });
  const swapRcpt1 = await swapTx1.wait();
  const swapId = getSwapId(htlc, swapRcpt1);
  check("ETH swap active", await htlc.isActive(swapId));
  check("Fee deducted", (await htlc.getSwap(swapId)).amount === net);

  await htlc.connect(team).redeem(swapId, preimage);
  check("ETH swap redeemed", (await htlc.getSwap(swapId)).status === 2n);

  // Fee withdrawal
  await htlc.withdrawEthFees(deployerAddr);
  check("ETH fees withdrawn", (await htlc.collectedEthFees()) === 0n);

  // Refund scenario
  const pre2 = randomPreimage();
  const now2 = (await ethers.provider.getBlock("latest")).timestamp;
  await htlc.setFeeBps(0); // 0% fee for clean test
  const swapTx2 = await htlc.newSwap(teamAddr, hashlock(pre2), now2 + 400, {
    value: ethers.parseEther("0.5"),
  });
  const swapRcpt2 = await swapTx2.wait();
  const swapId2 = getSwapId(htlc, swapRcpt2);
  await ethers.provider.send("evm_increaseTime", [420]);
  await ethers.provider.send("evm_mine");
  await htlc.refund(swapId2);
  check("ETH refund works", (await htlc.getSwap(swapId2)).status === 3n);

  // Reset fee
  await htlc.setFeeBps(0);

  // ERC20 swap → redeem
  const pre3 = randomPreimage();
  const now3 = (await ethers.provider.getBlock("latest")).timestamp;
  const tokenAmount = ethers.parseEther("5000");
  await token.approve(htlcAddr, tokenAmount);
  const swapTx3 = await htlc.newSwapToken(
    teamAddr,
    tokenAddr,
    tokenAmount,
    hashlock(pre3),
    now3 + 600,
  );
  const swapRcpt3 = await swapTx3.wait();
  const swapId3 = getSwapId(htlc, swapRcpt3);
  check("ERC20 swap active", await htlc.isActive(swapId3));
  await htlc.connect(team).redeem(swapId3, pre3);
  check("ERC20 swap redeemed", (await htlc.getSwap(swapId3)).status === 2n);
  check("Team received tokens", (await token.balanceOf(teamAddr)) >= tokenAmount);

  // Pause
  await htlc.pause();
  check("HTLC paused", await htlc.paused());
  await htlc.unpause();
  check("HTLC unpaused", !(await htlc.paused()));

  // ── Vesting ──────────────────────────────────────────────
  console.log("\n📋 Vesting");
  const ids = await vesting.getScheduleIds();
  check("7 schedules", ids.length === 7);

  // Check all schedule constants
  check("SEED constant", (await vesting.SEED()) === ethers.id("SEED"));
  check("IDO constant", (await vesting.IDO()) === ethers.id("IDO"));
  check("LIQUIDITY constant", (await vesting.LIQUIDITY()) === ethers.id("LIQUIDITY"));
  check("TEAM constant", (await vesting.TEAM()) === ethers.id("TEAM"));
  check("TREASURY constant", (await vesting.TREASURY()) === ethers.id("TREASURY"));
  check("FOUNDER_OPS const", (await vesting.FOUNDER_OPS()) === ethers.id("FOUNDER_OPS"));
  check("AIRDROPS constant", (await vesting.AIRDROPS()) === ethers.id("AIRDROPS"));

  // Before TGE — nothing releasable
  check(
    "No releasable before TGE (IDO)",
    (await vesting.releasableAmount(ethers.id("IDO"))) === 0n,
  );
  check(
    "No releasable before TGE (TEAM)",
    (await vesting.releasableAmount(ethers.id("TEAM"))) === 0n,
  );

  // Jump to TGE
  await ethers.provider.send("evm_setNextBlockTimestamp", [TGE + 10]);
  await ethers.provider.send("evm_mine");

  // AIRDROPS: pure TGE release
  const airdropRel = await vesting.releasableAmount(ethers.id("AIRDROPS"));
  check("Airdrops 5M TGE releasable", airdropRel === ethers.parseEther("5000000"));
  await vesting.connect(airdrops).release(ethers.id("AIRDROPS"));
  check(
    "Airdrops released",
    (await token.balanceOf(airdropsAddr)) === ethers.parseEther("5000000"),
  );

  // IDO: TGE + partial vesting
  const idoRel = await vesting.releasableAmount(ethers.id("IDO"));
  check("IDO has TGE (1.2M)", idoRel >= ethers.parseEther("1200000"));
  await vesting.connect(ido).release(ethers.id("IDO"));
  check("IDO released", (await token.balanceOf(idoAddr)) > 0n);

  // LIQUIDITY: 50% TGE
  const liqRel = await vesting.releasableAmount(ethers.id("LIQUIDITY"));
  check("Liquidity 10M TGE releasable", liqRel >= ethers.parseEther("10000000"));

  // Jump 6 months past TGE
  await ethers.provider.send("evm_setNextBlockTimestamp", [TGE + 6 * MONTH]);
  await ethers.provider.send("evm_mine");

  // IDO: total 13.2M, ~50% linearly vested → ~7.2M total vested, ~1.2M already released → ~6M releasable
  const idoRel2 = await vesting.releasableAmount(ethers.id("IDO"));
  check("IDO ~50% vested", idoRel2 >= ethers.parseEther("5990000")); // close to 6M

  // Jump past full vesting
  await ethers.provider.send("evm_setNextBlockTimestamp", [TGE + 13 * MONTH]);
  await ethers.provider.send("evm_mine");

  const idoVested = await vesting.vestedAmount(ethers.id("IDO"));
  check("IDO fully vested (13.2M)", idoVested === ethers.parseEther("13200000"));

  // ── Summary ──────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  const total = passed + failed;
  if (failed === 0) {
    console.log(`  🎉 ALL ${total} INTEGRATION TESTS PASSED`);
  } else {
    console.log(`  Results: ${passed} ✅ / ${failed} ❌ (${total} total)`);
  }
  console.log("═".repeat(55) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message);
  process.exit(1);
});
