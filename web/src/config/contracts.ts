import type { Abi, Address, Hex } from "viem";
import { arbitrum, avalanche, avalancheFuji, base, mainnet, sepolia } from "wagmi/chains";

import artifacts from "./artifacts.json";

/**
 * Supported networks.
 *
 * The list matches the wrapped-native addresses SafeGPT ships wrapping support
 * for, so "Wrap ETH → WETH" works everywhere the wizard runs.
 */
export const SUPPORTED_CHAINS = [mainnet, base, arbitrum, avalanche, avalancheFuji, sepolia] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

/** Canonical WETH contract per supported chain. */
export const WETH_ADDRESSES: Record<number, Address> = {
  [mainnet.id]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  [sepolia.id]: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  [base.id]: "0x4200000000000000000000000000000000000006",
  [arbitrum.id]: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  [avalanche.id]: "0xB31f66AA3C1e785363F0875A1B574E37E054F355",
  [avalancheFuji.id]: "0xB31f66AA3C1e785363F0875A1B574E37E054F355",
};

export function getWethAddress(chainId: number): Address | undefined {
  return WETH_ADDRESSES[chainId];
}

/**
 * Service fee charged by the vault, in basis points. 300 = 3%.
 *
 * The default fee goes to the SafeGPT developer address. Users can set it
 * to 0 in the onboarding wizard to disable the fee entirely.
 * The contract caps it at MAX_FEE_BPS (1000 = 10%).
 */
export const DEFAULT_FEE_BPS = 300;

/**
 * Default fee receiver — SafeGPT developer address.
 * Users can change this in settings, but it defaults to the developer.
 * TODO: Replace with the actual developer address.
 * Using a burn address as placeholder — the contract rejects zero address,
 * but accepts any non-zero address. The user will set the real address in
 * the onboarding wizard before deploying.
 */
export const DEFAULT_FEE_RECEIVER: Address = "0x4f7e26af0bc2b078802763fa0ee4cebbe8afbbbb";

export const rescueVaultAbi = artifacts.rescueVault.abi as Abi;
export const rescueVaultBytecode = artifacts.rescueVault.bytecode as Hex;
export const rescueVaultFactoryAbi = artifacts.rescueVaultFactory.abi as Abi;
export const rescueVaultFactoryBytecode = artifacts.rescueVaultFactory.bytecode as Hex;

/** Minimal ERC-20 ABI for balances, allowances and approvals. */
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const satisfies Abi;

/** WETH `deposit()` payable — wraps native ETH into WETH. */
export const wethAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const satisfies Abi;
