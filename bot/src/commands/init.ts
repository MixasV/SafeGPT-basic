import { Wallet } from "ethers";
import { scryptSync, createCipheriv, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

export async function init(configPath: string = "./config.yaml"): Promise<void> {
  const password = await prompt("Create password (min 8 chars):");
  if (password.length < 8) {
    console.error("Min 8 characters");
    process.exit(1);
  }
  const confirm = await prompt("Confirm password:");
  if (password !== confirm) {
    console.error("Passwords do not match");
    process.exit(1);
  }

  const wallet = Wallet.createRandom();
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(wallet.privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  const yaml = `# SafeGPT Bot Configuration
executor:
  address: "${wallet.address}"
  encryptedKey: "${encrypted}"
  salt: "${salt.toString("hex")}"
  iv: "${iv.toString("hex")}"
  authTag: "${authTag}"

vault:
  address: ""
  chainId: 1

protectedWallet: ""
safeAddress: ""
tokens: []

rpc:
  primary: "https://eth.llamarpc.com"
  fallback:
    - "https://rpc.ankr.com/eth"

rescue:
  maxGasPriceGwei: 300
  gasPriceMultiplier: 1.2
  minExecutorBalanceETH: 0.005

notifications:
  telegram:
    enabled: false
`;

  writeFileSync(configPath, yaml);
  console.log(`Executor wallet created: ${wallet.address}`);
  console.log(`Config saved to: ${configPath}`);
  console.log(`Next: npx safegpt-bot setup-telegram`);
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + " ", (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}
