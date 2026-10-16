// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {RescueVault} from "../src/RescueVault.sol";
import {RescueVaultFactory} from "../src/RescueVaultFactory.sol";

/**
 * @title Deploy
 * @notice Deploys the RescueVaultFactory and creates the vault for one protected
 *         wallet. The same factory template serves every user — only the
 *         constructor arguments change.
 *
 * @dev Required environment variables (see `.env.example` in the repo root):
 *      - EXECUTOR_PRIVATE_KEY : private key of the bot/broadcaster. Its address
 *                               becomes the vault `executor`.
 *      - PROTECTED_WALLET     : the cold-storage wallet being protected.
 *      - SAFE_ADDRESS         : destination for rescued funds (must differ from
 *                               PROTECTED_WALLET).
 *      - FEE_RECEIVER         : recipient of the SafeGPT service fee.
 *      - FEE_BPS              : service fee in basis points (0..1000).
 *      - VAULT_SALT           : CREATE2 salt, 32-byte hex value.
 *
 *      Usage:
 *      forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast
 */
contract Deploy is Script {
    function run() external returns (RescueVaultFactory factory, RescueVault vault) {
        uint256 executorPrivateKey = vm.envUint("EXECUTOR_PRIVATE_KEY");
        address protectedWallet = vm.envAddress("PROTECTED_WALLET");
        address safeAddress = vm.envAddress("SAFE_ADDRESS");
        address feeReceiver = vm.envAddress("FEE_RECEIVER");
        uint256 feeBpsRaw = vm.envUint("FEE_BPS");
        bytes32 salt = vm.envBytes32("VAULT_SALT");

        require(feeBpsRaw <= 10_000, "Deploy: FEE_BPS out of range");
        uint16 feeBps = uint16(feeBpsRaw);

        address executor = vm.addr(executorPrivateKey);

        vm.startBroadcast(executorPrivateKey);

        factory = new RescueVaultFactory();
        vault = RescueVault(factory.createVault(protectedWallet, safeAddress, executor, feeReceiver, feeBps, salt));

        vm.stopBroadcast();

        console2.log("RescueVaultFactory:", address(factory));
        console2.log("RescueVault       :", address(vault));
        console2.log("Protected wallet  :", protectedWallet);
        console2.log("Safe address      :", safeAddress);
        console2.log("Executor (bot)    :", executor);
        console2.log("Fee receiver      :", feeReceiver);
        console2.log("Fee (bps)         :", feeBpsRaw);
        console2.logBytes32(salt);
        console2.log("");
        console2.log("NEXT STEP: the protected wallet must approve each protected ERC-20 to the vault.");
    }
}
