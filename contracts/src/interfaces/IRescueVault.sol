// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRescueVault
 * @notice Public interface of the SafeGPT RescueVault.
 * @dev The vault escrows no funds of its own: it only moves tokens that the
 *      `owner` has explicitly approved to this contract, and only ever to the
 *      `safeAddress` / `feeReceiver` pair fixed in storage.
 *
 *      The contract deliberately exposes NO pause, unpause, withdraw or setFee
 *      entry points. `feeBps` is immutable after deployment and `safeAddress`
 *      / `whitelist` mutations are gated behind a timelock so that a compromised
 *      owner key cannot redirect a rescue in a single transaction.
 */
interface IRescueVault {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emitted for every token actually moved out of the protected wallet.
     * @param token The ERC-20 token that was rescued.
     * @param amount The amount transferred to `safeAddress` (net of the SafeGPT fee).
     * @param safeAddress The destination the tokens were moved to.
     */
    event Rescued(address indexed token, uint256 amount, address indexed safeAddress);

    /// @notice Emitted when the owner schedules a change of the safe address.
    event SafeChangeRequested(address indexed newSafeAddress, uint256 requestedAt);

    /// @notice Emitted when a pending safe address change is confirmed after the timelock.
    event SafeChangeConfirmed(address indexed newSafeAddress);

    /// @notice Emitted when the owner cancels a pending safe address change.
    event SafeChangeCancelled();

    /// @notice Emitted when the owner appoints a new executor (the bot address).
    event ExecutorChanged(address indexed newExecutor);

    /// @notice Emitted when the owner schedules a whitelist addition.
    event WhitelistAddRequested(address indexed account, uint256 requestedAt);

    /// @notice Emitted when a pending whitelist addition is confirmed after the timelock.
    event WhitelistAdded(address indexed account);

    /// @notice Emitted when the owner schedules a whitelist removal.
    event WhitelistRemoveRequested(address indexed account, uint256 requestedAt);

    /// @notice Emitted when a pending whitelist removal is confirmed after the timelock.
    event WhitelistRemoved(address indexed account);

    /*//////////////////////////////////////////////////////////////
                               CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice A token transfer failed or returned `false`.
    error TransferFromFailed(address token, address from, address to, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The protected wallet. Tokens are always pulled FROM this address.
    function owner() external view returns (address);

    /// @notice The destination every rescue transfers to.
    function safeAddress() external view returns (address);

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

    /// @notice Whether `account` is trusted by the owner.
    function whitelist(address account) external view returns (bool);

    /// @notice Timestamp of the pending whitelist addition for `account`, or 0.
    function pendingWhitelistAdd(address account) external view returns (uint256);

    /// @notice Timestamp of the pending whitelist removal for `account`, or 0.
    function pendingWhitelistRemove(address account) external view returns (uint256);

    /// @notice Delay that must elapse before a safe address change can be confirmed.
    function SAFE_CHANGE_DELAY() external view returns (uint256);

    /// @notice Delay that must elapse before a whitelist change can be confirmed.
    function WHITELIST_CHANGE_DELAY() external view returns (uint256);

    /// @notice Hard cap on {feeBps}. A constant, not a settable parameter.
    function MAX_FEE_BPS() external view returns (uint16);

    /*//////////////////////////////////////////////////////////////
                                 ACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Moves the full balance of every token in `tokens` out of the owner
     *         to the safe address (minus the service fee) and the fee to the
     *         fee receiver.
     * @dev Callable only by the executor. Tokens with a zero balance are skipped.
     *      The CURRENT `safeAddress` is used: a pending change has no effect until
     *      it is confirmed by the owner after the timelock.
     * @param tokens The ERC-20 token addresses to rescue.
     */
    function rescue(address[] calldata tokens) external;

    /**
     * @notice Schedules a new safe address. Takes effect only after
     *         {SAFE_CHANGE_DELAY} and an explicit {confirmSafeChange}.
     */
    function requestSafeChange(address newSafe) external;

    /// @notice Applies the pending safe address once the timelock has elapsed.
    function confirmSafeChange() external;

    /// @notice Drops the pending safe address change.
    function cancelSafeChange() external;

    /// @notice Replaces the executor address (the bot).
    function setExecutor(address newExecutor) external;

    /// @notice Schedules a whitelist addition.
    function requestWhitelistAdd(address account) external;

    /// @notice Confirms a pending whitelist addition once the timelock has elapsed.
    function confirmWhitelistAdd(address account) external;

    /// @notice Schedules a whitelist removal.
    function requestWhitelistRemove(address account) external;

    /// @notice Confirms a pending whitelist removal once the timelock has elapsed.
    function confirmWhitelistRemove(address account) external;
}