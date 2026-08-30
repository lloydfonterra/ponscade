import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  parseAbiItem,
} from "viem";

function loadEnv() {
  try {
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
  } catch {
    return {};
  }
}

const env = loadEnv();
const OPERATOR = env.OPERATOR_ADDRESS || process.env.OPERATOR_ADDRESS;
if (!OPERATOR) throw new Error("OPERATOR_ADDRESS missing from .env.local");
const PONS_V2 = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PONS_V1 = "0xa5aab3F0c6eeAdF30eF1D3EB997108E976351FeB";
const BAGS = "0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37";
const RPC = process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const client = createPublicClient({ chain: robinhood, transport: http(RPC) });

const tokenLaunched = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const tokenCreated = parseAbiItem(
  "event TokenCreated(address indexed token, address indexed curve, address indexed creator, address feeShare, address partner, bytes32 poolId, string name, string symbol, string metadataURI)",
);
const v1Launched = parseAbiItem(
  "event TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)",
);

const erc20 = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

function topicAddr(addr) {
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}`;
}

async function tokenMeta(token) {
  try {
    const [name, symbol] = await Promise.all([
      client.readContract({ address: token, abi: erc20, functionName: "name" }),
      client.readContract({ address: token, abi: erc20, functionName: "symbol" }),
    ]);
    return { name, symbol };
  } catch {
    return { name: "?", symbol: "?" };
  }
}

async function announce(hit) {
  const meta = hit.token ? await tokenMeta(hit.token) : { name: "?", symbol: "?" };
  const payload = { ...hit, ...meta, foundAt: new Date().toISOString() };
  writeFileSync(new URL("../launch-found.json", import.meta.url), JSON.stringify(payload, null, 2));
  console.log("");
  console.log("======== LAUNCH DETECTED ========");
  console.log(`source     ${hit.source}`);
  console.log(`token      ${hit.token || "(unknown)"}`);
  console.log(`name       ${meta.name} (${meta.symbol})`);
  if (hit.curve) console.log(`curve      ${hit.curve}`);
  if (hit.txHash) console.log(`tx         ${EXPLORER}/tx/${hit.txHash}`);
  if (hit.token) console.log(`token url  ${EXPLORER}/token/${hit.token}`);
  console.log("=================================");
  console.log("");
}

const seen = new Set();
let lastNonce = null;
let lastBal = null;

async function snapshot() {
  const [nonce, bal, block] = await Promise.all([
    client.getTransactionCount({ address: OPERATOR }),
    client.getBalance({ address: OPERATOR }),
    client.getBlockNumber(),
  ]);
  if (lastNonce === null) {
    lastNonce = nonce;
    lastBal = bal;
    console.log(`[watch] operator ${OPERATOR}`);
    console.log(`[watch] block ${block}  nonce ${nonce}  ETH ${formatEther(bal)}`);
    console.log("[watch] scanning Pons v2 / Pons v1 / Bags factory + this wallet. Launch when ready.");
    return { nonce, bal, block };
  }
  if (nonce !== lastNonce || bal !== lastBal) {
    console.log(
      `[watch] wallet moved  nonce ${lastNonce}->${nonce}  ETH ${formatEther(lastBal)}->${formatEther(bal)}  block ${block}`,
    );
    lastNonce = nonce;
    lastBal = bal;
  }
  return { nonce, bal, block };
}

async function scanFactories(fromBlock) {
  const deployerTopic = topicAddr(OPERATOR);
  const [v2, bags, v1] = await Promise.all([
    client.getLogs({
      address: PONS_V2,
      event: tokenLaunched,
      args: { deployer: OPERATOR },
      fromBlock,
      toBlock: "latest",
    }).catch(() => []),
    client.getLogs({
      address: BAGS,
      event: tokenCreated,
      args: { creator: OPERATOR },
      fromBlock,
      toBlock: "latest",
    }).catch(() => []),
    client.getLogs({
      address: PONS_V1,
      fromBlock,
      toBlock: "latest",
      topics: [
        "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a",
        null,
        null,
        deployerTopic,
      ],
    }).catch(() => []),
  ]);

  for (const log of v2) {
    const id = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    await announce({
      source: "pons-v2",
      token: log.args.token,
      curve: log.args.curve,
      txHash: log.transactionHash,
    });
  }
  for (const log of bags) {
    const id = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    await announce({
      source: "bags-factory",
      token: log.args.token,
      curve: log.args.curve,
      txHash: log.transactionHash,
      nameHint: log.args.name,
      symbolHint: log.args.symbol,
    });
  }
  for (const log of v1) {
    const id = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    await announce({
      source: "pons-v1",
      token: log.topics?.[1] ? `0x${log.topics[1].slice(26)}` : null,
      txHash: log.transactionHash,
    });
  }
}

async function scanWalletTxs() {
  const url = `${EXPLORER}/api?module=account&action=txlist&address=${OPERATOR}&page=1&offset=8&sort=desc`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const rows = Array.isArray(json.result) ? json.result : [];
    for (const tx of rows) {
      if (!tx.hash || seen.has(`tx:${tx.hash}`)) continue;
      if (tx.from?.toLowerCase() !== OPERATOR.toLowerCase()) continue;
      seen.add(`tx:${tx.hash}`);
      console.log(`[watch] outgoing tx ${tx.hash}  to ${tx.to}  value ${formatEther(BigInt(tx.value || "0"))} ETH`);
    }
  } catch {
    // explorer optional
  }
}

const start = await snapshot();
const lookback = start.block > 4000n ? start.block - 4000n : 0n;
await scanFactories(lookback);
await scanWalletTxs();

setInterval(async () => {
  try {
    const snap = await snapshot();
    const from = snap.block > 800n ? snap.block - 800n : 0n;
    await scanFactories(from);
    await scanWalletTxs();
  } catch (err) {
    console.log(`[watch] ${err.shortMessage || err.message}`);
  }
}, 5000);
