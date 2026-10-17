// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISafeGPTGuardianModule
 * @notice Public interface of the SafeGPT guardian module.
 *
 * @dev The module implements a TIMELOCK + VETO model, not a multisig:
 *      nothing the owner queues is ever executed without an explicit guardian
 *      confirmation, and there is no timer that can execute or expire anything.
 */
interface ISafeGPTGuardianModule {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event TransactionQueued(bytes32 indexed txId, address indexed to, uint256 value);
    event TransactionConfirmed(bytes32 indexed txId);
    event TransactionCancelled(bytes32 indexed txId);
    event TransactionExecuted(bytes32 indexed txId);

    event EmergencyExit(address indexed owner, address indexed safeAddress);
    event EmergencyExitTokenMoved(address indexed token, uint256 amount);
    event EmergencyExitTokenSkipped(address indexed token, bytes32 reason);
    event GuardianRemoved(address indexed previousGuardian);

    event SafeChangeRequested(address indexed newSafeAddress, uint256 requestedAt);
    event SafeChangeGuardianApproved(address indexed newSafeAddress);
    event SafeChangeConfirmed(address indexed newSafeAddress);
    event SafeChangeCancelled();

    event WhitelistAddRequested(address indexed account, uint256 requestedAt);
    event WhitelistAddGuardianApproved(address indexed account);
    event WhitelistAddConfirmed(address indexed account);

    event WhitelistRemoveRequested(address indexed account, uint256 requestedAt);
    event WhitelistRemoveGuardianApproved(address indexed account);
    event WhitelistRemoveConfirmed(address indexed account);

    /*//////////////////////////////////////////////////////////////
                               CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotGuardian();
    error GuardianNotSet();
    error ZeroAddress();
    error SafeAddressEqualsOwner();
    error SafeAddressIsProtected();
    error TransactionAlreadyExecuted();
    error TransactionAlreadyCancelled();
    error TransactionNotConfirmed();
    error TransactionUnknown();
    error GuardianConfirmRateLimit();
    error NoPendingSafeChange();
    error NoPendingWhitelistAdd();
    error NoPendingWhitelistRemove();
    error GuardianApprovalMissing();
    error TimelockNotElapsed();
    error SafeAddressCannotBeUnlisted();
    error AlreadyInWhitelist();
    error NativeTransferFailed();
    error ReentrantCall();
    error TooManyTokens();
    error QueueFull();

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    function owner() external view returns (address);
    function guardian() external view returns (address);
    function safeAddress() external view returns (address);
    function guardianRemoved() external view returns (bool);

    /**
     * @notice Queued transaction record.
     * @dev `data` is omitted from this getter because Solidity cannot return a
     *      dynamic array from an auto-generated public mapping getter. Use
     *      {ISafeGPTGuardianModule.transactionData} to read the call data.
     */
    function queue(bytes32 txId)
        external
        view
        returns (address to, uint256 value, uint256 queuedAt, bool confirmed, bool cancelled, bool executed);

    /// @notice Call data of a queued transaction.
    function transactionData(bytes32 txId) external view returns (bytes memory data);

    /// @notice Number of transactions ever queued.
    function queuedTxIdsLength() external view returns (uint256);

    /// @notice Transaction identifier at `index` of the queue index.
    function queuedTxIdAt(uint256 index) external view returns (bytes32);

    function whitelist(address account) external view returns (bool);
    function pendingWhitelistAdd(address account) external view returns (uint256);
    function pendingWhitelistRemove(address account) external view returns (uint256);
    function guardianApprovedWhitelistAdd(address account) external view returns (bool);
    function guardianApprovedWhitelistRemove(address account) external view returns (bool);
    function pendingSafeAddress() external view returns (address);
    function safeChangeRequestTime() external view returns (uint256);
    function safeGuardianApproved() external view returns (bool);
    function guardianConfirmsPerHour(uint256 window) external view returns (uint8);

    function WHITELIST_CHANGE_DELAY() external view returns (uint256);
    function SAFE_CHANGE_DELAY() external view returns (uint256);
    function TX_QUEUE_TIMEOUT() external view returns (uint256);
    function MAX_CONFIRMS_PER_HOUR() external view returns (uint8);
    function MAX_TOKENS_PER_EXIT() external view returns (uint256);

    /// @notice Maximum queue length, so the emergency exit always stays callable.
    function MAX_QUEUE_SIZE() external view returns (uint256);
    function TOKEN_GAS_LIMIT() external view returns (uint256);

    /*//////////////////////////////////////////////////////////////
                               TRANSACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Owner queues a transaction.
     * @dev A call to a whitelisted destination executes IMMEDIATELY, without a
     *      guardian. Everything else is queued and stays queued until a guardian
     *      confirms it — there is no timeout and no automatic execution.
     */
    function queueTransaction(address to, uint256 value, bytes calldata data) external returns (bytes32 txId);

    /// @notice Executes a previously queued transaction. Requires a guardian confirmation.
    function executeTransaction(bytes32 txId) external;

    /// @notice Guardian veto/approval for a queued transaction. Rate limited to 5 per hour.
    function confirmTransaction(bytes32 txId) external;

    /// @notice Cancels a queued transaction. Callable by the guardian or the owner.
    function cancelTransaction(bytes32 txId) external;

    /// @notice Sweeps every held asset to the safe address, removes the guardian, cancels the queue.
    function emergencyExit(address[] calldata tokens) external;

    /*//////////////////////////////////////////////////////////////
                            SAFE ADDRESS (72h + GUARDIAN)
    //////////////////////////////////////////////////////////////*/

    function requestSafeChange(address newSafe) external;
    function guardianConfirmSafeChange() external;
    function confirmSafeChange() external;
    function cancelSafeChange() external;

    /*//////////////////////////////////////////////////////////////
                            WHITELIST (72h + GUARDIAN)
    //////////////////////////////////////////////////////////////*/

    function requestWhitelistAdd(address account) external;
    function guardianConfirmWhitelistAdd(address account) external;
    function confirmWhitelistAdd(address account) external;

    function requestWhitelistRemove(address account) external;
    function guardianConfirmWhitelistRemove(address account) external;
    function confirmWhitelistRemove(address account) external;
}
