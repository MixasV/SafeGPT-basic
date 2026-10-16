// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RescueVault} from "./RescueVault.sol";

/**
 * @title RescueVaultFactory
 * @notice Deploys the single RescueVault template at a deterministic CREATE2 address.
 * @dev Every vault produced by this factory runs the exact same bytecode — the
 *      only per-user variation is in the constructor arguments (owner, safe
 *      address, executor, fee receiver, fee). No user-specific Solidity is ever
 *      generated, which keeps the deployed surface identical and auditable.
 *
 *      Creation is permissionless on purpose: a vault only ever moves tokens
 *      that its own owner approved and only ever to the addresses stored inside
 *      it, so deploying one on someone else's behalf is harmless.
 */
contract RescueVaultFactory {
    /// @notice Emitted once per vault deployment.
    event VaultCreated(address indexed vault, address indexed owner, address indexed safeAddress);

    /**
     * @notice Deploys a RescueVault at a salt-derived address.
     * @param owner The protected wallet whose tokens the vault protects.
     * @param safeAddress Where rescued tokens are sent. Must differ from `owner`.
     * @param executor The bot address allowed to trigger rescues.
     * @param feeReceiver Where the SafeGPT service fee is sent.
     * @param feeBps Service fee in basis points, capped at 1000.
     * @param salt CREATE2 salt. Reusing a salt with identical arguments reverts.
     * @return vault The address of the freshly deployed vault.
     */
    function createVault(
        address owner,
        address safeAddress,
        address executor,
        address feeReceiver,
        uint16 feeBps,
        bytes32 salt
    ) external returns (address vault) {
        vault = address(new RescueVault{salt: salt}(owner, safeAddress, executor, feeReceiver, feeBps));

        emit VaultCreated(vault, owner, safeAddress);
    }
}
