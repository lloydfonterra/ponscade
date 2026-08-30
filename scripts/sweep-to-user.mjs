import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseAbi,
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
const DEST = "0x271e9C06f79f7B54ff3C99259f2000Cb53c4A600";
const OPERATOR = env.OPERATOR_ADDRESS;
const POT = env.POT_ADDRESS;
const TOKEN = env.PONSCADE_TOKEN;
const CURVE = env.PONSCADE_CURVE;
const PONS = env.PONS_TOKEN;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";
const QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
const FEES = [100, 500, 3000, 10000];
const BPS = 10_000n;
const DRY = process.argv.includes("--probe");

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const publicClient = createPublicClient({ chain: robinhood, transport: http(RPC) });

function walletFor(key) {
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: robinhood, transport: http(RPC) });
}

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const curveAbi = parseAbi([
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function readyToGraduate() view returns (bool)",
]);
const v3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[])",
]);
const wethAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function withdraw(uint256 wad)",
]);

function amountOut(inAmount, reserveIn, reserveOut) {
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}

async function quoteCurveSell(tokensIn) {
  const [reserves, feeBps, creatorTaxBps] = await Promise.all([
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "getReserves" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "feeBps" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorTaxBps" }),
  ]);
  const [quoteReserve, tokenReserve] = reserves;
  const gross = amountOut(tokensIn, tokenReserve, quoteReserve);
  const fee = (gross * feeBps) / BPS;
  const tax = (gross * creatorTaxBps) / BPS;
  return { quoteOut: gross - fee - tax, quoteReserve, tokenReserve };
}

async function quotePons(amountIn, fee) {
  const { result } = await publicClient.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: PONS,
        tokenOut: WETH,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return result[0];
}

async function bestPonsQuote(amountIn) {
  let best = { fee: 0, out: 0n };
  for (const fee of FEES) {
    try {
      const out = await quotePons(amountIn, fee);
      if (out > best.out) best = { fee, out };
    } catch {
      // empty tier
    }
  }
  return best;
}

async function waitOk(hash, label) {
  console.log(`${label} ${EXPLORER}/tx/${hash}`);
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${label} reverted`);
  return rcpt;
}

async function approveIfNeeded(wallet, token, spender, amount) {
  const owner = wallet.account.address;
  const current = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (current >= amount) return;
  const hash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitOk(hash, `approve ${token.slice(0, 8)}`);
}

async function sendAllEth(wallet, to) {
  const from = wallet.account.address;
  const gasPrice = await publicClient.getGasPrice();
  const gas = 21_000n;
  const pad = gasPrice * gas + gasPrice * 5_000n;
  const bal = await publicClient.getBalance({ address: from });
  if (bal <= pad) {
    console.log(`${from} ETH ${formatEther(bal)} too small to sweep after gas`);
    return 0n;
  }
  const value = bal - pad;
  const hash = await wallet.sendTransaction({ to, value, gas: 21_000n, gasPrice });
  await waitOk(hash, `eth sweep ${from.slice(0, 8)}`);
  return value;
}

async function snapshot(addr) {
  const [eth, token, pons, weth] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: PONS, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: WETH, abi: wethAbi, functionName: "balanceOf", args: [addr] }),
  ]);
  return { eth, token, pons, weth };
}

function printSnap(label, s) {
  console.log(label);
  console.log(`  ETH       ${formatEther(s.eth)}`);
  console.log(`  PONSCADE  ${formatUnits(s.token, 18)}`);
  console.log(`  PONS      ${formatUnits(s.pons, 18)}`);
  console.log(`  WETH      ${formatEther(s.weth)}`);
}

async function main() {
  const op = walletFor(env.OPERATOR_PRIVATE_KEY);
  const pot = walletFor(env.POT_PRIVATE_KEY);
  if (op.account.address.toLowerCase() !== OPERATOR.toLowerCase()) {
    throw new Error("operator key mismatch");
  }
  if (pot.account.address.toLowerCase() !== POT.toLowerCase()) {
    throw new Error("pot key mismatch");
  }

  const [opSnap, potSnap, destEth, graduated, ready] = await Promise.all([
    snapshot(OPERATOR),
    snapshot(POT),
    publicClient.getBalance({ address: DEST }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "graduated" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "readyToGraduate" }),
  ]);

  printSnap("OPERATOR", opSnap);
  printSnap("POT", potSnap);
  console.log(`DEST ${DEST}  ${formatEther(destEth)} ETH`);
  console.log(`curve graduated=${graduated} readyToGraduate=${ready}`);

  if (opSnap.token > 0n) {
    const q = await quoteCurveSell(opSnap.token);
    console.log(
      `curve sell quote ${formatUnits(opSnap.token, 18)} PONSCADE -> ${formatEther(q.quoteOut)} ETH  reserve ${formatEther(q.quoteReserve)} ETH`,
    );
  }
  if (opSnap.pons > 0n) {
    const q = await bestPonsQuote(opSnap.pons);
    console.log(`pons sell quote ${formatUnits(opSnap.pons, 18)} PONS -> ${formatEther(q.out)} ETH  fee ${q.fee}`);
  }
  if (potSnap.pons > 0n) {
    const q = await bestPonsQuote(potSnap.pons);
    console.log(`pot pons quote ${formatUnits(potSnap.pons, 18)} -> ${formatEther(q.out)} ETH`);
  }

  if (DRY) return;

  if (opSnap.token > 0n) {
    if (ready || graduated) {
      throw new Error("Curve will not accept a sell (graduated or readyToGraduate).");
    }
    const q = await quoteCurveSell(opSnap.token);
    if (q.quoteOut === 0n) throw new Error("Curve sell quotes 0 ETH");
    await approveIfNeeded(op, TOKEN, CURVE, opSnap.token);
    const minOut = (q.quoteOut * 90n) / 100n;
    const hash = await op.writeContract({
      address: CURVE,
      abi: curveAbi,
      functionName: "sell",
      args: [opSnap.token, minOut, OPERATOR],
    });
    await waitOk(hash, "sell PONSCADE");
  }

  const ponsNow = await publicClient.readContract({
    address: PONS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [OPERATOR],
  });
  if (ponsNow > 0n) {
    const q = await bestPonsQuote(ponsNow);
    if (q.out === 0n) throw new Error("No PONS pool quote");
    await approveIfNeeded(op, PONS, SWAP_ROUTER, ponsNow);
    const minOut = (q.out * 95n) / 100n;
    const swapData = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: PONS,
          tokenOut: WETH,
          fee: q.fee,
          recipient: SWAP_ROUTER,
          amountIn: ponsNow,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const unwrapData = encodeFunctionData({
      abi: routerAbi,
      functionName: "unwrapWETH9",
      args: [minOut, OPERATOR],
    });
    const hash = await op.writeContract({
      address: SWAP_ROUTER,
      abi: routerAbi,
      functionName: "multicall",
      args: [[swapData, unwrapData]],
    });
    await waitOk(hash, "sell PONS");
  }

  const opWeth = await publicClient.readContract({
    address: WETH,
    abi: wethAbi,
    functionName: "balanceOf",
    args: [OPERATOR],
  });
  if (opWeth > 0n) {
    const hash = await op.writeContract({
      address: WETH,
      abi: wethAbi,
      functionName: "withdraw",
      args: [opWeth],
    });
    await waitOk(hash, "unwrap WETH");
  }

  const potPons = await publicClient.readContract({
    address: PONS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [POT],
  });
  const potToken = await publicClient.readContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [POT],
  });
  if (potPons > 0n || potToken > 0n) {
    throw new Error("Pot wallet unexpectedly holds tokens; stop before ETH sweep.");
  }

  const sentOp = await sendAllEth(op, DEST);
  const sentPot = await sendAllEth(pot, DEST);

  const [afterOp, afterPot, afterDest] = await Promise.all([
    snapshot(OPERATOR),
    snapshot(POT),
    publicClient.getBalance({ address: DEST }),
  ]);
  printSnap("OPERATOR after", afterOp);
  printSnap("POT after", afterPot);
  console.log(`DEST now ${formatEther(afterDest)} ETH`);
  console.log(`sent from operator ${formatEther(sentOp)} ETH`);
  console.log(`sent from pot ${formatEther(sentPot)} ETH`);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message);
  process.exit(1);
});
