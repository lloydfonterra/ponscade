import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MINUTES = 15;
const script = fileURLToPath(new URL("./claim-and-split.mjs", import.meta.url));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function msUntilNextWindow() {
  const window = MINUTES * 60 * 1000;
  const now = Date.now();
  const next = Math.ceil((now + 1000) / window) * window;
  return Math.max(5_000, next - now);
}

function runOnce() {
  return new Promise((resolve) => {
    console.log(`\n[${new Date().toISOString()}] claim window`);
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code !== 0) console.log(`claim script exited ${code}`);
      resolve(code);
    });
  });
}

console.log(`Ponscade claim loop · every ${MINUTES} min UTC`);
await runOnce();
while (true) {
  const wait = msUntilNextWindow();
  console.log(`next window in ${Math.ceil(wait / 1000)}s`);
  await sleep(wait);
  await runOnce();
}
