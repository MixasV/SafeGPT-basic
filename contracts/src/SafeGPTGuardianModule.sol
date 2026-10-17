// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISafeGPTGuardianModule} from "./interfaces/ISafeGPTGuardianModule.sol";

/// @dev Minimal ERC-20 surface used by the emergency exit.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title SafeGPTGuardianModule
 * @notice Timelock + veto wallet. Every non-whitelisted transaction the owner
 *         queues is held until a per-wallet guardian explicitly confirms it.
 *
 * @dev Why this is NOT a multisig:
 *      A multisig lets N of M keys act unilaterally. Here the owner alone can
 *      never move funds вЂ” a second, independent key (the guardian) must confirm
 *      every non-whitelisted action. That is what makes a compromised owner key
 *      insufficient on its own.
 *
 *      Invariants enforced here:
 *      - Nothing executes without an explicit guardian confirmation. There is NO
 *        timeout and NO timer that can execute or expire a queued transaction.
 *        A silent guardian stalls the wallet, which is the intended failure mode.
 *      - Two exceptions to the rule above, both from the specification:
 *          (a) a transaction to a whitelisted destination executes immediately;
 *          (b) emergencyExit() sweeps everything to the safe address.
 *      - emergencyExit() is safe even when the owner key is stolen: it only sends
 *        value to safeAddress, which an attacker holding the owner key does not
 *        control. An attacker who calls it is helping the user.
 *      - safeAddress is whitelisted from construction and can never be removed,
 *        so funds always have an exit path.
 *      - Changing the safe address or the whitelist requires owner request +
 *        72h + guardian approval + owner confirmation.
 *      - Leaving the service is only possible through emergencyExit(). There is
 *        no removeGuardian() and no automatic guardian removal.
 */
contract SafeGPTGuardianModule is ISafeGPTGuardianModule {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Delay that must elapse before a safe address change can be confirmed.
    uint256 public constant SAFE_CHANGE_DELAY = 72 hours;

    /// @notice Delay that must elapse before a whitelist change can be confirmed.
    uint256 public constant WHITELIST_CHANGE_DELAY = 72 hours;

    /// @notice Deliberately zero: queued transactions never expire.
    uint256 public constant TX_QUEUE_TIMEOUT = 0;

    /// @notice Guardian confirmations allowed per hour window.
    uint8 public constant MAX_CONFIRMS_PER_HOUR = 5;

    /// @notice Maximum number of tokens a single emergencyExit call may sweep.
    uint256 public constant MAX_TOKENS_PER_EXIT = 50;

    /**
     * @notice Hard cap on the queue index.
     * @dev emergencyExit() cancels the whole queue, which costs O(n) gas. The cap
     *      keeps that sweep inside a single transaction's gas budget, so a large
     *      queue can never make the exit permanently uncallable. Owners can also
     *      shrink the queue one entry at a time with {cancelTransaction}.
     */
    uint256 public constant MAX_QUEUE_SIZE = 200;

    /// @notice Gas forwarded to one ERC-20 call during the emergency exit.
    uint256 public constant TOKEN_GAS_LIMIT = 250_000;

    /// @dev Reentrancy guard states (1 = not entered, 2 = entered).
    uint256 private constant REENTRANCY_NOT_ENTERED = 1;
    uint256 private constant REENTRANCY_ENTERED = 2;

    /// @dev Reasons reported through {EmergencyExitTokenSkipped}.
    bytes32 private constant REASON_BALANCE_OF = "BALANCE_OF";
    bytes32 private constant REASON_TRANSFER = "TRANSFER";

    /// @dev One hour expressed in seconds, for the confirm rate-limit window.
    uint256 private constant CONFIRM_WINDOW = 1 hours;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ISafeGPTGuardianModule
    address public owner;

    /// @inheritdoc ISafeGPTGuardianModule
    address public guardian;

    /// @inheritdoc ISafeGPTGuardianModule
    address public safeAddress;

    /// @inheritdoc ISafeGPTGuardianModule
    bool public guardianRemoved;

    struct QueuedTx {
        address to;
        uint256 value;
        bytes data;
        uint256 queuedAt;
        bool confirmed;
        bool cancelled;
        bool executed;
    }

    mapping(bytes32 => QueuedTx) internal _queue;

    /// @inheritdoc ISafeGPTGuardianModule
    function queue(bytes32 txId)
        external
        view
        returns (address to, uint256 value, uint256 queuedAt, bool confirmed, bool cancelled, bool executed)
    {
        QueuedTx storage entry = _queue[txId];
        return (entry.to, entry.value, entry.queuedAt, entry.confirmed, entry.cancelled, entry.executed);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function transactionData(bytes32 txId) external view returns (bytes memory data) {
        return _queue[txId].data;
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function queuedTxIdsLength() external view returns (uint256) {
        return queuedTxIds.length;
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function queuedTxIdAt(uint256 index) external view returns (bytes32) {
        return queuedTxIds[index];
    }

    /**
     * @dev Identifiers of every transaction ever queued. Mappings are not
     *      iterable, and emergencyExit() must cancel the whole queue, so the
     *      identifiers need their own index.
     */
    bytes32[] public queuedTxIds;

    /**
     * @dev Number of queued entries that are neither executed nor cancelled.
     *      The raw index only ever grows, so the cap is enforced against this
     *      counter instead: the owner can always cancel entries to make room.
     */
    uint256 public liveQueueCount;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(address => bool) public whitelist;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(address => uint256) public pendingWhitelistAdd;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(address => uint256) public pendingWhitelistRemove;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(address => bool) public guardianApprovedWhitelistAdd;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(address => bool) public guardianApprovedWhitelistRemove;

    /// @inheritdoc ISafeGPTGuardianModule
    address public pendingSafeAddress;

    /// @inheritdoc ISafeGPTGuardianModule
    uint256 public safeChangeRequestTime;

    /// @inheritdoc ISafeGPTGuardianModule
    bool public safeGuardianApproved;

    /// @inheritdoc ISafeGPTGuardianModule
    mapping(uint256 => uint8) public guardianConfirmsPerHour;

    /// @dev Reentrancy guard state.
    uint256 private reentrancyStatus;

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGuardian() {
        if (guardian == address(0)) revert GuardianNotSet();
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier nonReentrant() {
        if (reentrancyStatus == REENTRANCY_ENTERED) revert ReentrantCall();
        reentrancyStatus = REENTRANCY_ENTERED;
        _;
        reentrancyStatus = REENTRANCY_NOT_ENTERED;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param owner_ The wallet owner.
     * @param guardian_ A key unique to THIS wallet. Compromise of one guardian
     *                  key must never affect another wallet.
     * @param safeAddress_ Where emergencyExit() sends everything. It is
     *                     whitelisted here and can never be unlisted.
     */
    constructor(address owner_, address guardian_, address safeAddress_) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (guardian_ == address(0)) revert ZeroAddress();
        if (safeAddress_ == address(0)) revert ZeroAddress();
        if (safeAddress_ == owner_) revert SafeAddressEqualsOwner();

        owner = owner_;
        guardian = guardian_;
        safeAddress = safeAddress_;

        // Hardcoded at construction: the exit path always stays open.
        whitelist[safeAddress_] = true;

        reentrancyStatus = REENTRANCY_NOT_ENTERED;
    }

    /// @dev The module holds native currency, so it must be able to receive it.
    receive() external payable {}

    /*//////////////////////////////////////////////////////////////
                            TRANSACTION QUEUE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ISafeGPTGuardianModule
    function queueTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        nonReentrant
        returns (bytes32 txId)
    {
        if (liveQueueCount >= MAX_QUEUE_SIZE) revert QueueFull();

        // Exception (a): whitelisted destinations bypass the guardian entirely.
        if (whitelist[to]) {
            // No queue entry is created for an immediate execution, so the
            // transaction id stays zero to make that explicit to indexers.
            _execute(to, value, data);
            emit TransactionExecuted(bytes32(0));
            return bytes32(0);
        }

        // The id is bound to the queue index, so two identical calls in the same block
        // cannot collide and silently overwrite each other.
        txId = keccak256(abi.encode(to, value, data, block.timestamp, queuedTxIds.length));
        queuedTxIds.push(txId);
        _queue[txId] = QueuedTx({
            to: to,
            value: value,
            data: data,
            queuedAt: block.timestamp,
            confirmed: false,
            cancelled: false,
            executed: false
        });
        liveQueueCount += 1;

        emit TransactionQueued(txId, to, value);

        return txId;
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function executeTransaction(bytes32 txId) external onlyOwner nonReentrant {
        QueuedTx storage pending = _queue[txId];
        if (pending.queuedAt == 0) revert TransactionUnknown();
        if (pending.executed) revert TransactionAlreadyExecuted();
        if (pending.cancelled) revert TransactionAlreadyCancelled();
        // emergencyExit() removes the guardian, so anything still marked
        // confirmed was approved by a guardian that no longer exists.
        if (guardianRemoved) revert GuardianNotSet();
        // No timer path exists: without an explicit guardian confirmation this
        // transaction simply stays queued forever.
        if (!pending.confirmed) revert TransactionNotConfirmed();

        pending.executed = true;
        liveQueueCount -= 1;
        _execute(pending.to, pending.value, pending.data);

        emit TransactionExecuted(txId);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function confirmTransaction(bytes32 txId) external onlyGuardian {
        QueuedTx storage pending = _queue[txId];
        if (pending.queuedAt == 0) revert TransactionUnknown();
        if (pending.executed) revert TransactionAlreadyExecuted();
        if (pending.cancelled) revert TransactionAlreadyCancelled();
        if (pending.confirmed) revert TransactionNotConfirmed();

        // Rate limit: a leaked guardian key cannot green-light a whole batch.
        uint256 window = block.timestamp / CONFIRM_WINDOW;
        uint8 used = guardianConfirmsPerHour[window];
        if (used >= MAX_CONFIRMS_PER_HOUR) revert GuardianConfirmRateLimit();
        guardianConfirmsPerHour[window] = used + 1;

        pending.confirmed = true;

        emit TransactionConfirmed(txId);
    }

    /**
     * @inheritdoc ISafeGPTGuardianModule
     * @dev Callable by the guardian (veto) and by the owner (abandon a plan).
     *      Deliberately open to both, and to nothing else.
     */
    function cancelTransaction(bytes32 txId) external {
        bool isOwner = msg.sender == owner;
        bool isGuardian = guardian != address(0) && msg.sender == guardian;
        if (!isOwner && !isGuardian) revert NotOwner();

        QueuedTx storage pending = _queue[txId];
        if (pending.queuedAt == 0) revert TransactionUnknown();
        if (pending.executed) revert TransactionAlreadyExecuted();

        pending.cancelled = true;
        liveQueueCount -= 1;

        emit TransactionCancelled(txId);
    }

    /*//////////////////////////////////////////////////////////////
                              EMERGENCY EXIT
    //////////////////////////////////////////////////////////////*/

    /**
     * @inheritdoc ISafeGPTGuardianModule
     * @dev Each token is swept in isolation: a reverting or gas-burning token
     *      cannot block the exit of the remaining assets.
     */
    function emergencyExit(address[] calldata tokens) external onlyOwner nonReentrant {
        uint256 length = tokens.length;
        if (length > MAX_TOKENS_PER_EXIT) revert TooManyTokens();

        for (uint256 i; i < length; ++i) {
            _sweepToken(tokens[i]);
        }

        uint256 balance = address(this).balance;
        if (balance != 0) {
            // Full remaining gas on purpose: a Safe multisig destination needs
            // far more than the 2300 that `transfer` would forward.
            (bool ok,) = safeAddress.call{value: balance}("");
            if (!ok) revert NativeTransferFailed();
        }

        if (guardian != address(0)) {
            emit GuardianRemoved(guardian);
        }
        guardian = address(0);
        guardianRemoved = true;

        _cancelAllPending();

        // Every pending configuration change dies with the guardian. Without
        // this a stale guardian approval would outlive the guardian itself and
        // the owner could then confirm a safe-address change unobserved.
        pendingSafeAddress = address(0);
        safeChangeRequestTime = 0;
        safeGuardianApproved = false;

        emit EmergencyExit(owner, safeAddress);
    }

    /// @dev Isolated ERC-20 sweep. Never reverts.
    function _sweepToken(address token) private {
        (bool balanceOk, bytes memory balanceData) =
            token.staticcall{gas: TOKEN_GAS_LIMIT}(abi.encodeCall(IERC20.balanceOf, (address(this))));
        if (!balanceOk || balanceData.length < 32) {
            emit EmergencyExitTokenSkipped(token, REASON_BALANCE_OF);
            return;
        }

        uint256 balance = abi.decode(balanceData, (uint256));
        if (balance == 0) {
            emit EmergencyExitTokenSkipped(token, REASON_BALANCE_OF);
            return;
        }

        (bool ok, bytes memory returndata) =
            token.call{gas: TOKEN_GAS_LIMIT}(abi.encodeCall(IERC20.transfer, (safeAddress, balance)));

        // Tolerant return check: empty return counts as success (USDT-style),
        // anything shorter than 32 bytes counts as failure.
        bool succeeded = ok && (returndata.length == 0 || (returndata.length >= 32 && abi.decode(returndata, (bool))));

        if (!succeeded) {
            emit EmergencyExitTokenSkipped(token, REASON_TRANSFER);
            return;
        }

        emit EmergencyExitTokenMoved(token, balance);
    }

    function _cancelAllPending() private {
        uint256 length = queuedTxIds.length;
        for (uint256 i; i < length; ++i) {
            bytes32 txId = queuedTxIds[i];
            QueuedTx storage pending = _queue[txId];
            if (!pending.executed && !pending.cancelled) {
                pending.cancelled = true;
                liveQueueCount -= 1;
                emit TransactionCancelled(txId);
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                          SAFE ADDRESS (72h + GUARDIAN)
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ISafeGPTGuardianModule
    function requestSafeChange(address newSafe) external onlyOwner {
        if (newSafe == address(0)) revert ZeroAddress();
        if (newSafe == owner) revert SafeAddressEqualsOwner();

        pendingSafeAddress = newSafe;
        safeChangeRequestTime = block.timestamp;
        // Any previous guardian approval no longer applies to the new request.
        safeGuardianApproved = false;

        emit SafeChangeRequested(newSafe, block.timestamp);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function guardianConfirmSafeChange() external onlyGuardian {
        if (pendingSafeAddress == address(0)) revert NoPendingSafeChange();
        // The approval is bound to the address currently pending: if the owner
        // replaces the request, requestSafeChange() clears the flag, and an
        // approval that arrived for a different address can never carry over.
        safeGuardianApproved = true;

        emit SafeChangeGuardianApproved(pendingSafeAddress);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function confirmSafeChange() external onlyOwner {
        if (pendingSafeAddress == address(0)) revert NoPendingSafeChange();
        if (!safeGuardianApproved) revert GuardianApprovalMissing();
        if (block.timestamp < safeChangeRequestTime + SAFE_CHANGE_DELAY) revert TimelockNotElapsed();

        safeAddress = pendingSafeAddress;
        // The exit path stays open for the new destination as well.
        whitelist[safeAddress] = true;

        pendingSafeAddress = address(0);
        safeChangeRequestTime = 0;
        safeGuardianApproved = false;

        emit SafeChangeConfirmed(safeAddress);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function cancelSafeChange() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwner();
        if (guardian == address(0) && msg.sender == guardian) revert GuardianNotSet();

        pendingSafeAddress = address(0);
        safeChangeRequestTime = 0;
        safeGuardianApproved = false;

        emit SafeChangeCancelled();
    }

    /*//////////////////////////////////////////////////////////////
                          WHITELIST (72h + GUARDIAN)
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc ISafeGPTGuardianModule
    function requestWhitelistAdd(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (account == safeAddress) revert AlreadyInWhitelist();
        if (whitelist[account]) revert AlreadyInWhitelist();

        pendingWhitelistAdd[account] = block.timestamp;
        // A re-issued request always restarts the clock AND drops any earlier
        // guardian approval, so an approval can never be carried over to a
        // different request for the same address.
        guardianApprovedWhitelistAdd[account] = false;

        emit WhitelistAddRequested(account, block.timestamp);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function guardianConfirmWhitelistAdd(address account) external onlyGuardian {
        if (pendingWhitelistAdd[account] == 0) revert NoPendingWhitelistAdd();
        if (whitelist[account]) revert AlreadyInWhitelist();

        guardianApprovedWhitelistAdd[account] = true;

        emit WhitelistAddGuardianApproved(account);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function confirmWhitelistAdd(address account) external onlyOwner {
        // After emergencyExit there is no guardian left to approve anything, so a
        // leftover approval from before the exit must never be spendable.
        if (guardianRemoved) revert GuardianNotSet();
        uint256 requestedAt = pendingWhitelistAdd[account];
        if (requestedAt == 0) revert NoPendingWhitelistAdd();
        if (!guardianApprovedWhitelistAdd[account]) revert GuardianApprovalMissing();
        if (block.timestamp < requestedAt + WHITELIST_CHANGE_DELAY) revert TimelockNotElapsed();

        whitelist[account] = true;
        delete pendingWhitelistAdd[account];
        delete guardianApprovedWhitelistAdd[account];

        emit WhitelistAddConfirmed(account);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function requestWhitelistRemove(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        // The safe address is the exit path and must stay whitelisted forever.
        if (account == safeAddress) revert SafeAddressCannotBeUnlisted();

        pendingWhitelistRemove[account] = block.timestamp;
        // Same rule as on the add path: re-issuing invalidates any prior approval.
        guardianApprovedWhitelistRemove[account] = false;

        emit WhitelistRemoveRequested(account, block.timestamp);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function guardianConfirmWhitelistRemove(address account) external onlyGuardian {
        // Mirrors the request-side guard: the safe address can never be unlisted,
        // so approving its removal is rejected too.
        if (account == safeAddress) revert SafeAddressCannotBeUnlisted();
        if (pendingWhitelistRemove[account] == 0) revert NoPendingWhitelistRemove();
        if (!whitelist[account]) revert AlreadyInWhitelist();

        guardianApprovedWhitelistRemove[account] = true;

        emit WhitelistRemoveGuardianApproved(account);
    }

    /// @inheritdoc ISafeGPTGuardianModule
    function confirmWhitelistRemove(address account) external onlyOwner {
        if (account == safeAddress) revert SafeAddressCannotBeUnlisted();
        if (guardianRemoved) revert GuardianNotSet();
        uint256 requestedAt = pendingWhitelistRemove[account];
        if (requestedAt == 0) revert NoPendingWhitelistRemove();
        if (!guardianApprovedWhitelistRemove[account]) revert GuardianApprovalMissing();
        if (block.timestamp < requestedAt + WHITELIST_CHANGE_DELAY) revert TimelockNotElapsed();

        whitelist[account] = false;
        delete pendingWhitelistRemove[account];
        delete guardianApprovedWhitelistRemove[account];

        emit WhitelistRemoveConfirmed(account);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Executes a call and bubbles up the original revert reason.
    function _execute(address to, uint256 value, bytes memory data) private {
        (bool ok, bytes memory returndata) = to.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }
    }
}
