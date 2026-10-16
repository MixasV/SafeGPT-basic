// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRescueVault
 * @notice Public interface of the SafeGPT RescueVault.
 * @dev The vault escrows no funds of its own: it only moves tokens that the
 *      `owner` has explicitly approved to this contract, and only ever to the
 *      destinations held in storage.
 *
 *      The contract deliberately exposes NO pause, unpause, withdraw or setFee
 *      entry points. `feeBps` is immutable after deployment, and `safeAddress`,
 *      `quarantineAddress`, `executor` and `whitelist` mutations are all gated
 *      behind a 72-hour timelock so that a compromised owner key cannot
 *      redirect a rescue in a single transaction (UPD-3, rule 16).
 */
interface IRescueVault {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emitted for every token actually moved out of the protected wallet.
     * @param token The ERC-20 token that was rescued.
     * @param amount The amount transferred to `destination` (net of the SafeGPT fee).
     * @param destination The address the tokens were moved to.
     */
    event Rescued(address indexed token, uint256 amount, address indexed destination);

    /// @notice Emitted when a token is skipped because it could not be read or is empty.
    event RescueSkipped(address indexed token, bytes32 reason);

    /// @notice Emitted when a token transfer failed; the remaining tokens still proceed.
    event RescueFailed(address indexed token, uint256 amount);

    /// @notice Emitted when the owner schedules a change of the safe address.
    event SafeChangeRequested(address indexed newSafeAddress, uint256 requestedAt);

    /// @notice Emitted when a pending safe address change is confirmed after the timelock.
    event SafeChangeConfirmed(address indexed newSafeAddress);

    /// @notice Emitted when the owner cancels a pending safe address change.
    event SafeChangeCancelled();

    /// @notice Emitted when the owner schedules a change of the quarantine address.
    event QuarantineChangeRequested(address indexed newQuarantineAddress, uint256 requestedAt);

    /// @notice Emitted when a pending quarantine address change is confirmed.
    event QuarantineChangeConfirmed(address indexed newQuarantineAddress);

    /// @notice Emitted when the owner cancels a pending quarantine address change.
    event QuarantineChangeCancelled();

    /// @notice Emitted when the owner schedules a change of the executor (the bot).
    event ExecutorChangeRequested(address indexed newExecutor, uint256 requestedAt);

    /// @notice Emitted when a pending executor change is confirmed after the timelock.
    event ExecutorChanged(address indexed newExecutor);

    /// @notice Emitted when the owner cancels a pending executor change.
    event ExecutorChangeCancelled();

    /// @notice Emitted when the owner schedules a whitelist addition.
    event WhitelistAddRequested(address indexed account, uint256 requestedAt);

    /// @notice Emitted when a pending whitelist addition is confirmed after the timelock.
    event WhitelistAdded(address indexed account);

    /// @notice Emitted when the owner schedules a whitelist removal.
    event WhitelistRemoveRequested(address indexed account, uint256 requestedAt);

    /// @notice Emitted when a pending whitelist removal is confirmed after the timelock.
    event WhitelistRemoved(address indexed account);

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The protected wallet. Tokens are always pulled FROM this address.
    function owner() external view returns (address);

    /// @notice The destination for verified (core) assets.
    function safeAddress() external view returns (address);

    /// @notice The destination for unverified (watch-set) assets, or the zero address.
    function quarantineAddress() external view returns (address);

    /// @notice The only address allowed to call {rescue}.
    function executor() external view returns (address);

    /// @notice The recipient of the SafeGPT service fee.
    function feeReceiver() external view returns (address);

    /// @notice The fee charged by the service, in basis points. Immutable after deployment.
    function feeBps() external view returns (uint16);

    /// @notice The safe address awaiting confirmation, or the zero address.
    function pendingSafeAddress() external view returns (address);

    /// @notice The timestamp at which {pendingSafeAddress} was requested.
    function safeChangeRequestTime() external view returns (uint256);

    /// @notice The quarantine address awaiting confirmation, or the zero address.
    function pendingQuarantineAddress() external view returns (address);

    /// @notice The timestamp at which {pendingQuarantineAddress} was requested.
    function quarantineChangeRequestTime() external view returns (uint256);

    /// @notice The executor awaiting confirmation, or the zero address.
    function pendingExecutor() external view returns (address);

    /// @notice The timestamp at which {pendingExecutor} was requested.
    function executorChangeRequestTime() external view returns (uint256);

    /// @notice Whether `account` is trusted by the owner.
    function whitelist(address account) external view returns (bool);

    /// @notice Timestamp of the pending whitelist addition for `account`, or 0.
    function pendingWhitelistAdd(address account) external view returns (uint256);

    /// @notice Timestamp of the pending whitelist removal for `account`, or 0.
    function pendingWhitelistRemove(address account) external view returns (uint256);

    /// @notice Delay that must elapse before a safe/quarantine/executor change is applied.
    function SAFE_CHANGE_DELAY() external view returns (uint256);

    /// @notice Delay that must elapse before a whitelist change can be confirmed.
    function WHITELIST_CHANGE_DELAY() external view returns (uint256);

    /// @notice Hard cap on {feeBps}. A constant, not a settable parameter.
    function MAX_FEE_BPS() external view returns (uint16);

    /// @notice Maximum number of tokens accepted in a single {rescue} call.
    function MAX_TOKENS_PER_TX() external view returns (uint256);

    /// @notice Gas forwarded to a single `transferFrom` call (UPD-2).
    function TOKEN_GAS_LIMIT() external view returns (uint256);

    /// @notice Gas forwarded to a single `balanceOf` call (UPD-2).
    function BALANCE_GAS_LIMIT() external view returns (uint256);

    /*//////////////////////////////////////////////////////////////
                                 ACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Moves tokens out of the owner to the safe or quarantine address.
     * @dev Callable only by the executor, at most {MAX_TOKENS_PER_TX} tokens per
     *      call, and each token is processed in isolation: a reverting token, a
     *      gas bomb or a malformed return value can never take down the rest of
     *      the batch. `chargeFee[i] == true` routes the token to `safeAddress`
     *      and charges the service fee; `chargeFee[i] == false` routes it to
     *      `quarantineAddress` (or `safeAddress` when none is configured) and
     *      charges no fee.
     * @param tokens The ERC-20 token addresses to rescue.
     * @param chargeFee Per-token flag, must have the same length as `tokens`.
     */
    function rescue(address[] calldata tokens, bool[] calldata chargeFee) external;

    /// @notice Schedules a new safe address. Applies after {SAFE_CHANGE_DELAY} + {confirmSafeChange}.
    function requestSafeChange(address newSafe) external;

    /// @notice Applies the pending safe address once the timelock has elapsed.
    function confirmSafeChange() external;

    /// @notice Drops the pending safe address change.
    function cancelSafeChange() external;

    /// @notice Schedules a new quarantine address for unverified (watch-set) tokens.
    function requestQuarantineChange(address newQuarantine) external;

    /// @notice Applies the pending quarantine address once the timelock has elapsed.
    function confirmQuarantineChange() external;

    /// @notice Drops the pending quarantine address change.
    function cancelQuarantineChange() external;

    /// @notice Schedules a new executor. Applies after {SAFE_CHANGE_DELAY} + {confirmExecutorChange}.
    function requestExecutorChange(address newExecutor) external;

    /// @notice Applies the pending executor once the timelock has elapsed.
    function confirmExecutorChange() external;

    /// @notice Drops the pending executor change.
    function cancelExecutorChange() external;

    /// @notice Schedules a whitelist addition.
    function requestWhitelistAdd(address account) external;

    /// @notice Confirms a pending whitelist addition once the timelock has elapsed.
    function confirmWhitelistAdd(address account) external;

    /// @notice Schedules a whitelist removal.
    function requestWhitelistRemove(address account) external;

    /// @notice Confirms a pending whitelist removal once the timelock has elapsed.
    function confirmWhitelistRemove(address account) external;
}
