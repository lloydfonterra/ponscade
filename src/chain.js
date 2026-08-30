export const ROBINHOOD = {
  chainId: "0x1237",
  chainIdDec: 4663,
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

export const PONSCADE_TOKEN = import.meta.env.VITE_PONSCADE_TOKEN || "";
export const PONSCADE_NAME = "Ponscade";
export const PONSCADE_SYMBOL = "PONSCADE";
export const PONS_TOKEN =
  import.meta.env.VITE_PONS_TOKEN ||
  "0x39dBED3a2bd333467115dE45665cC57F813C4571";
export const OPERATOR_ADDRESS =
  import.meta.env.VITE_OPERATOR_ADDRESS ||
  "0x765309bAb89429A5D10F1b47cAa7420088C88F41";
export const POT_ADDRESS =
  import.meta.env.VITE_POT_ADDRESS ||
  "0x26A2976c7c1717E3D8be2E05Eb200A8B5c898361";
export const FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
export const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
export const EXPLORER = ROBINHOOD.blockExplorerUrls[0];
export const AIRDROP_MIN_HOLD = 666_666;

export function explorerAddress(addr) {
  return `${EXPLORER}/address/${addr}`;
}

export function explorerToken(addr) {
  return `${EXPLORER}/token/${addr}`;
}
export const PONSME_TOKEN = "0xe4d7c9fc56fa0dea5099734bbdf657193c6ec384";

const ERC20_BALANCE = "0x70a08231";

function padAddress(addr) {
  return addr.replace("0x", "").toLowerCase().padStart(64, "0");
}

export async function ensureRobinhoodChain() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet. Install MetaMask, Rabby, or Robinhood Wallet.");
  const current = await eth.request({ method: "eth_chainId" });
  if (current === ROBINHOOD.chainId) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD.chainId }],
    });
  } catch (err) {
    if (err?.code === 4902 || String(err?.message || "").includes("Unrecognized")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [ROBINHOOD],
      });
      return;
    }
    throw err;
  }
}

export async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found.");
  await ensureRobinhoodChain();
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("Wallet returned no account.");
  return accounts[0];
}

export async function readBalance(token, owner) {
  if (!token || !owner || !window.ethereum) return 0n;
  const data = ERC20_BALANCE + padAddress(owner);
  const result = await window.ethereum.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  if (!result || result === "0x") return 0n;
  return BigInt(result);
}

export function playsForUsd(usdHeld) {
  if (usdHeld >= 150) return 30;
  if (usdHeld >= 30) return 20;
  if (usdHeld >= 3) return 15;
  if (usdHeld > 0) return 10;
  return 3;
}

export function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
