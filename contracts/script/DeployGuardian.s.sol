// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {SafeGPTGuardianModule} from "../src/SafeGPTGuardianModule.sol";

/**
 * @title DeployGuardian
 * @notice Deploys one SafeGPT guardian module for one protected smart account.
 *
 * @dev The guardian key is UNIQUE PER WALLET. Deploying one shared guardian key
 *      for every wallet would mean a single compromise controls every account,
 *      which defeats the entire point of the module. In the open-source build
 *      each user generates their own key and stores it on a separate device.
 *
 *      Required environment variables:
 *        - DEPLOYER_PRIVATE_KEY : who pays for the deployment
 *        - MODULE_OWNER        : the owner of this smart account
 *        - GUARDIAN_ADDRESS    : the guardian key for THIS wallet only
 *        - SAFE_ADDRESS        : where emergencyExit() sends everything
 *
 *      Usage:
 *        forge script script/DeployGuardian.s.sol:DeployGuardian \
 *          --rpc-url $RPC_URL --broadcast
 */
contract DeployGuardian is Script {
    function run() external returns (SafeGPTGuardianModule module) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address moduleOwner = vm.envAddress("MODULE_OWNER");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address safeAddress = vm.envAddress("SAFE_ADDRESS");

        require(guardian != address(0), "DeployGuardian: guardian is zero address");
        require(guardian != moduleOwner, "DeployGuardian: guardian must differ from the owner");
        require(safeAddress != moduleOwner, "DeployGuardian: safe address must differ from the owner");

        vm.startBroadcast(deployerPrivateKey);
        module = new SafeGPTGuardianModule(moduleOwner, guardian, safeAddress);
        vm.stopBroadcast();

        console2.log("SafeGPTGuardianModule:", address(module));
        console2.log("Owner                 :", moduleOwner);
        console2.log("Guardian              :", guardian);
        console2.log("Safe address          :", safeAddress);
        console2.log("");
        console2.log("NEXT STEP: fund this contract. Any asset it holds can be swept out");
        console2.log("at any moment by emergencyExit(), which always pays the safe address.");
    }
}
