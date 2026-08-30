import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
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
const OPERATOR = env.OPERATOR_ADDRESS;
const KEY = env.OPERATOR_PRIVATE_KEY;
const TOKEN = env.PONSCADE_TOKEN;
const CURVE = env.PONSCADE_CURVE;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const BUY_ETH = 1333385351150201n;
const BPS = 10_000n;

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const publicClient = createPublicClient({ chain: robinhood, transport: http(RPC) });
const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account, chain: robinhood, transport: http(RPC) });

const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function graduated() view returns (bool)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function amountOut(inAmount, reserveIn, reserveOut) {
  return (inAmount * reserveOut) / (reserveIn + inAmount);
}

async function quoteBuy(quoteIn, recipient) {
  const [reserves, sellable, feeBps, creatorTaxBps, rawSnipeBps] = await Promise.all([
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "getReserves" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "sellableTokens" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "feeBps" }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorTaxBps" }),
    publicClient.readContract({
      address: CURVE,
      abi: curveAbi,
      functionName: "currentSnipeTaxBps",
      args: [recipient],
    }),
  ]);
  const [quoteReserve, tokenReserve] = reserves;
  let snipeBps = rawSnipeBps;
  if (snipeBps > 0n) {
    const maxSnipeBps = BPS - feeBps - creatorTaxBps - 100n;
    if (snipeBps > maxSnipeBps) snipeBps = maxSnipeBps;
  }
  const net =
    quoteIn -
    (quoteIn * feeBps) / BPS -
    (quoteIn * creatorTaxBps) / BPS -
    (quoteIn * snipeBps) / BPS;
  let tokensOut = amountOut(net, quoteReserve, tokenReserve);
  if (tokensOut > sellable) tokensOut = sellable;
  return { tokensOut, snipeBps, feeBps };
}

async function main() {
  if (account.address.toLowerCase() !== OPERATOR.toLowerCase()) {
    throw new Error("Operator key does not match OPERATOR_ADDRESS");
  }

  const [eth, tokenBefore, graduated] = await Promise.all([
    publicClient.getBalance({ address: OPERATOR }),
    publicClient.readContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [OPERATOR],
    }),
    publicClient.readContract({ address: CURVE, abi: curveAbi, functionName: "graduated" }),
  ]);
  if (graduated) throw new Error("Curve already graduated; this burn script buys on the curve.");
  if (eth < BUY_ETH + 200000000000000n) {
    throw new Error(`Not enough ETH. Have ${formatEther(eth)}, need ~${formatEther(BUY_ETH)} plus gas`);
  }

  const quoted = await quoteBuy(BUY_ETH, OPERATOR);
  const minOut = (quoted.tokensOut * 95n) / 100n;
  console.log(`burn 10%  ${formatEther(BUY_ETH)} ETH`);
  console.log(`quote     ${formatUnits(quoted.tokensOut, 18)} PONSCADE  snipe ${quoted.snipeBps} bps`);
  console.log(`minOut    ${formatUnits(minOut, 18)}`);
  console.log(`token before ${formatUnits(tokenBefore, 18)}`);

  const hashBuy = await wallet.writeContract({
    address: CURVE,
    abi: curveAbi,
    functionName: "buy",
    args: [BUY_ETH, minOut, OPERATOR],
    value: BUY_ETH,
  });
  console.log(`buy ${EXPLORER}/tx/${hashBuy}`);
  const buyRcpt = await publicClient.waitForTransactionReceipt({ hash: hashBuy });
  if (buyRcpt.status !== "success") throw new Error("curve buy reverted");

  const tokenAfter = await publicClient.readContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [OPERATOR],
  });
  const bought = tokenAfter - tokenBefore;
  if (bought <= 0n) throw new Error("Buy landed but PONSCADE balance did not increase");
  console.log(`bought    ${formatUnits(bought, 18)} PONSCADE`);

  const hashBurn = await wallet.writeContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "transfer",
    args: [DEAD, bought],
  });
  console.log(`burn ${EXPLORER}/tx/${hashBurn}`);
  const burnRcpt = await publicClient.waitForTransactionReceipt({ hash: hashBurn });
  if (burnRcpt.status !== "success") throw new Error("transfer to dead reverted");

  const [deadBal, left, ethLeft] = await Promise.all([
    publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] }),
    publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [OPERATOR] }),
    publicClient.getBalance({ address: OPERATOR }),
  ]);
  console.log(`dead now  ${formatUnits(deadBal, 18)} PONSCADE`);
  console.log(`operator  ${formatUnits(left, 18)} PONSCADE  ${formatEther(ethLeft)} ETH`);
}

main().catch((err) => {
  console.error(err.shortMessage || err.message);
  process.exit(1);
});
