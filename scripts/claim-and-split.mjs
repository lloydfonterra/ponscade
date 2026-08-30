import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function loadEnv() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const env = loadEnv();
const RPC = env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const OPERATOR = env.OPERATOR_ADDRESS;
const KEY = env.OPERATOR_PRIVATE_KEY;
const TOKEN = env.PONSCADE_TOKEN;
const CURVE = env.PONSCADE_CURVE;
const POT = env.POT_ADDRESS;
const PONS = env.PONS_TOKEN;
const AIRDROP_MIN = BigInt(env.AIRDROP_MIN || "1500000") * 10n ** 18n;
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";
const QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
const FEES = [100, 500, 3000, 10000];
const DRY = process.argv.includes("--probe");

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const publicClient = createPublicClient({
  chain: robinhood,
  transport: http(RPC),
});
const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({
  account,
  chain: robinhood,
  transport: http(RPC),
});

const factoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
  "function feeEscrow() view returns (address)",
]);
const escrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function balanceOfToken(address recipient, address token) view returns (uint256)",
  "function claim()",
]);
const curveAbi = parseAbi([
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBalance() view returns (uint256)",
  "function sweepFees(uint256 minBuybackTokensOut)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function graduated() view returns (bool)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const v3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

async function tryRead(label, fn) {
  try {
    return { label, ok: true, value: await fn() };
  } catch (err) {
    return { label, ok: false, error: err.shortMessage || err.message };
  }
}

async function holders(token) {
  const skip = new Set([
    CURVE.toLowerCase(),
    TOKEN.toLowerCase(),
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
  ]);
  const launchTx = env.PONSCADE_LAUNCH_TX;
  const launch = await publicClient.getTransactionReceipt({ hash: launchTx });
  const latest = await publicClient.getBlockNumber();
  const addrs = new Set();
  const transfer = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );
  const step = 50_000n;
  for (let from = launch.blockNumber; from <= latest; from += step) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    const logs = await publicClient.getLogs({
      address: token,
      event: transfer,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      if (log.args.to) addrs.add(log.args.to);
      if (log.args.from) addrs.add(log.args.from);
    }
  }
  const eligible = [];
  for (const addr of addrs) {
    if (skip.has(addr.toLowerCase())) continue;
    const raw = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    });
    if (raw >= AIRDROP_MIN) eligible.push({ address: addr, raw });
  }
  eligible.sort((a, b) => (a.raw === b.raw ? 0 : a.raw > b.raw ? -1 : 1));
  return eligible;
}

const poolAbi = parseAbi([
  "function liquidity() view returns (uint128)",
]);

async function findPonsPool() {
  const found = [];
  for (const fee of FEES) {
    const pool = await publicClient.readContract({
      address: V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [WETH, PONS, fee],
    });
    if (!pool || pool === "0x0000000000000000000000000000000000000000") continue;
    const liquidity = await publicClient.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "liquidity",
    });
    if (liquidity === 0n) continue;
    found.push({ pool, fee, liquidity });
  }
  if (!found.length) return null;
  found.sort((a, b) => (a.liquidity === b.liquidity ? 0 : a.liquidity > b.liquidity ? -1 : 1));
  return found[0];
}

async function quotePons(amountIn, fee) {
  const { result } = await publicClient.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: PONS,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return result[0];
}

function log(title, obj) {
  console.log(title);
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
  }
  console.log("");
}

async function main() {
  if (account.address.toLowerCase() !== OPERATOR.toLowerCase()) {
    throw new Error("Operator key does not match OPERATOR_ADDRESS");
  }

  const [ethBefore, launch, escrowAddr, escrowEth, escrowToken] = await Promise.all([
    publicClient.getBalance({ address: OPERATOR }),
    publicClient.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "getLaunchedToken",
      args: [TOKEN],
    }),
    publicClient.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "feeEscrow",
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "balanceOf",
      args: [OPERATOR],
    }),
    publicClient.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "balanceOfToken",
      args: [OPERATOR, TOKEN],
    }),
  ]);

  const curveReads = await Promise.all([
    tryRead("quoteFeeBalance", () =>
      publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "quoteFeeBalance" }),
    ),
    tryRead("creatorTaxBalance", () =>
      publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorTaxBalance" }),
    ),
    tryRead("feeBps", () =>
      publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "feeBps" }),
    ),
    tryRead("creatorTaxBps", () =>
      publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorTaxBps" }),
    ),
    tryRead("graduated", () =>
      publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "graduated" }),
    ),
  ]);

  const poolInfo = await findPonsPool();
  const eligible = await holders(TOKEN);
  const eligibleSum = eligible.reduce((a, h) => a + h.raw, 0n);

  log("STATE", {
    mode: DRY ? "probe" : "execute",
    operator: OPERATOR,
    token: TOKEN,
    curve: CURVE,
    factoryEscrow: escrowAddr,
    launchPhase: launch.phase,
    launchExists: launch.exists,
    creatorFeeRecipient: launch.creatorFeeRecipient,
    pairToken: launch.pairToken,
    buybackEnabled: launch.buybackEnabled,
    operatorEth: `${formatEther(ethBefore)} ETH`,
    escrowEth: `${formatEther(escrowEth)} ETH`,
    escrowToken: formatUnits(escrowToken, 18),
    ponsPool: poolInfo ? `${poolInfo.pool} fee=${poolInfo.fee}` : "NONE",
    eligibleHolders: eligible.length,
    eligibleToken: formatUnits(eligibleSum, 18),
  });
  for (const row of curveReads) {
    console.log(
      `  curve.${row.label.padEnd(20)} ${row.ok ? row.value : `ERR ${row.error}`}`,
    );
  }
  console.log("");
  console.log("ELIGIBLE (>= 666,666 PONSCADE, curve excluded)");
  for (const h of eligible) {
    console.log(`  ${h.address}  ${formatUnits(h.raw, 18)}`);
  }
  console.log("");

  const unswept = curveReads
    .filter((r) => r.ok && (r.label === "quoteFeeBalance" || r.label === "creatorTaxBalance"))
    .reduce((a, r) => a + BigInt(r.value), 0n);

  if (DRY) {
    if (poolInfo && escrowEth + unswept > 0n) {
      const buyAmt = ((escrowEth + unswept) * 80n) / 100n;
      if (buyAmt > 0n) {
        try {
          const out = await quotePons(buyAmt, poolInfo.fee);
          console.log(`quote 80% (${formatEther(buyAmt)} ETH) -> ${formatUnits(out, 18)} PONS`);
        } catch (err) {
          console.log(`quote failed: ${err.shortMessage || err.message}`);
        }
      }
    }
    return;
  }

  if (unswept > 0n) {
    console.log(`sweeping unswept curve fees ~${formatEther(unswept)} ETH`);
    const hash = await wallet.writeContract({
      address: CURVE,
      abi: curveAbi,
      functionName: "sweepFees",
      args: [0n],
    });
    console.log(`  sweep ${EXPLORER}/tx/${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const owedAfterSweep = await publicClient.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "balanceOf",
    args: [OPERATOR],
  });
  console.log(`escrow after sweep: ${formatEther(owedAfterSweep)} ETH`);

  if (owedAfterSweep === 0n) {
    throw new Error("Nothing to claim. Need $PONSCADE trades so creator fees accrue.");
  }

  const hashClaim = await wallet.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "claim",
  });
  console.log(`claim ${EXPLORER}/tx/${hashClaim}`);
  const claimRcpt = await publicClient.waitForTransactionReceipt({ hash: hashClaim });
  if (claimRcpt.status !== "success") throw new Error("claim reverted");

  const claimed = owedAfterSweep;
  const potAmt = (claimed * 10n) / 100n;
  const buyAmt = (claimed * 80n) / 100n;
  console.log(`claimed ${formatEther(claimed)} ETH`);
  console.log(`pot 10% ${formatEther(potAmt)} ETH -> ${POT}`);
  console.log(`buy 80% ${formatEther(buyAmt)} ETH -> PONS`);
  console.log(`hold 10% ${formatEther(claimed - potAmt - buyAmt)} ETH (burn later)`);

  if (potAmt > 0n) {
    const hashPot = await wallet.sendTransaction({ to: POT, value: potAmt });
    console.log(`pot send ${EXPLORER}/tx/${hashPot}`);
    await publicClient.waitForTransactionReceipt({ hash: hashPot });
  }

  if (buyAmt === 0n) {
    console.log("80% is zero after rounding; skip buy.");
    return;
  }
  if (!poolInfo) throw new Error("No WETH/PONS Uniswap v3 pool found.");
  if (eligible.length === 0) {
    console.log("No eligible holders. Buying PONS and leaving it on the operator.");
  }

  let swapFee = poolInfo.fee;
  let quoted = 0n;
  for (const fee of FEES) {
    try {
      const out = await quotePons(buyAmt, fee);
      if (out > quoted) {
        quoted = out;
        swapFee = fee;
      }
    } catch {
      // empty or unusable tier
    }
  }
  if (quoted === 0n) throw new Error("No PONS quote from any liquid pool.");
  const minOut = (quoted * 95n) / 100n;
  console.log(`quote ${formatUnits(quoted, 18)} PONS  minOut ${formatUnits(minOut, 18)}`);

  const hashSwap = await wallet.writeContract({
    address: SWAP_ROUTER,
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: PONS,
        fee: swapFee,
        recipient: OPERATOR,
        amountIn: buyAmt,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
    value: buyAmt,
  });
  console.log(`swap ${EXPLORER}/tx/${hashSwap}`);
  const swapRcpt = await publicClient.waitForTransactionReceipt({ hash: hashSwap });
  if (swapRcpt.status !== "success") throw new Error("PONS swap reverted");

  const ponsBal = await publicClient.readContract({
    address: PONS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [OPERATOR],
  });
  console.log(`operator PONS after swap: ${formatUnits(ponsBal, 18)}`);

  if (eligible.length === 0 || ponsBal === 0n) return;

  let sent = 0n;
  for (let i = 0; i < eligible.length; i++) {
    const h = eligible[i];
    const share =
      i === eligible.length - 1
        ? ponsBal - sent
        : (ponsBal * h.raw) / eligibleSum;
    if (share === 0n) continue;
    if (h.address.toLowerCase() === OPERATOR.toLowerCase()) {
      console.log(`keep ${formatUnits(share, 18)} PONS on operator (eligible holder)`);
      sent += share;
      continue;
    }
    const hashAir = await wallet.writeContract({
      address: PONS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [h.address, share],
    });
    console.log(
      `airdrop ${formatUnits(share, 18)} PONS -> ${h.address}  ${EXPLORER}/tx/${hashAir}`,
    );
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: hashAir });
    if (rcpt.status !== "success") throw new Error(`airdrop to ${h.address} reverted`);
    sent += share;
  }

  const [ethAfter, potBal, ponsLeft] = await Promise.all([
    publicClient.getBalance({ address: OPERATOR }),
    publicClient.getBalance({ address: POT }),
    publicClient.readContract({
      address: PONS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [OPERATOR],
    }),
  ]);
  log("DONE", {
    operatorEth: `${formatEther(ethAfter)} ETH`,
    potEth: `${formatEther(potBal)} ETH`,
    operatorPons: formatUnits(ponsLeft, 18),
    airdroppedPons: formatUnits(sent, 18),
    recipients: eligible.length,
  });
}

main().catch((err) => {
  console.error(err.shortMessage || err.message);
  process.exit(1);
});
