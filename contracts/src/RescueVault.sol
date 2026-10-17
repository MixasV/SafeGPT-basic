// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRescueVault} from "./interfaces/IRescueVault.sol";

/// @dev Minimal ERC-20 surface needed by the vault. Declared locally so the
///      contract folder stays dependency-free (no OpenZeppelin requirement).
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title RescueVault
 * @notice SafeGPT on-chain rescue contract. One immutable template is deployed
 *         per protected wallet; it never custodies funds itself and never
 *         accepts native ETH — it only pulls ERC-20 tokens the owner approved.
 *
 * @dev Security model:
 *      - {rescue} is callable ONLY by `executor` and can ONLY send tokens to
 *        the destinations held in storage. There is no arbitrary-recipient path
 *        and no `withdraw()`.
 *      - `safeAddress`, `quarantineAddress`, `executor` and `whitelist` can only
 *        be mutated by the owner AND only after a 72-hour timelock, so a stolen
 *        owner key cannot redirect a rescue or lock the bot out instantly.
 *      - `feeBps` is fixed at deployment and hard-capped by {MAX_FEE_BPS}.
 *      - Every token in a rescue batch is processed in isolation with a bounded
 *        gas stipend. A hostile token contract (reverting, gas-burning, or
 *        returning malformed data) can waste its own gas budget but can never
 *        prevent the remaining assets from being rescued.
 *      - There is intentionally no pause mechanism: pausing is a griefing vector
 *        for a rescue contract, and the timelock already covers the legitimate
 *        need to change configuration.
 */
contract RescueVault is IRescueVault {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Delay that must elapse before a safe address change is applied.
    uint256 public constant SAFE_CHANGE_DELAY = 72 hours;

    /// @notice Delay that must elapse before an executor change is applied.
    uint256 public constant EXECUTOR_CHANGE_DELAY = 72 hours;

    /// @notice Delay that must elapse before a quarantine address change is applied.
    uint256 public constant QUARANTINE_CHANGE_DELAY = 72 hours;

    /// @notice Delay that must elapse before a whitelist change is applied.
    uint256 public constant WHITELIST_CHANGE_DELAY = 72 hours;

    /// @notice Hard cap on the service fee: 1000 bps = 10%. Not settable.
    uint16 public constant MAX_FEE_BPS = 1000;

    /// @notice Maximum number of tokens accepted by a single {rescue} call.
    uint256 public constant MAX_TOKENS_PER_TX = 30;

    /// @notice Gas forwarded to one `transferFrom`. Bounds a hostile gas bomb.
    uint256 public constant TOKEN_GAS_LIMIT = 250_000;

    /// @notice Gas forwarded to one `balanceOf`. Bounds a hostile gas bomb.
    uint256 public constant BALANCE_GAS_LIMIT = 50_000;

    /// @dev Denominator for basis-point arithmetic.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @dev Reentrancy guard states (1 = not entered, 2 = entered).
    uint256 private constant REENTRANCY_NOT_ENTERED = 1;
    uint256 private constant REENTRANCY_ENTERED = 2;

    /// @dev Reasons reported through {RescueSkipped}.
    bytes32 private constant REASON_BALANCE_OF = "BALANCE_OF";
    bytes32 private constant REASON_ZERO_BALANCE = "ZERO_BALANCE";

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    address public owner;

    /// @inheritdoc IRescueVault
    address public safeAddress;

    /// @inheritdoc IRescueVault
    address public quarantineAddress;

    /// @inheritdoc IRescueVault
    address public executor;

    /// @inheritdoc IRescueVault
    address public feeReceiver;

    /// @inheritdoc IRescueVault
    uint16 public feeBps;

    /// @inheritdoc IRescueVault
    address public pendingSafeAddress;

    /// @inheritdoc IRescueVault
    uint256 public safeChangeRequestTime;

    /// @inheritdoc IRescueVault
    address public pendingQuarantineAddress;

    /// @inheritdoc IRescueVault
    uint256 public quarantineChangeRequestTime;

    /// @inheritdoc IRescueVault
    address public pendingExecutor;

    /// @inheritdoc IRescueVault
    uint256 public executorChangeRequestTime;

    /// @inheritdoc IRescueVault
    mapping(address => bool) public whitelist;

    /// @inheritdoc IRescueVault
    mapping(address => uint256) public pendingWhitelistAdd;

    /// @inheritdoc IRescueVault
    mapping(address => uint256) public pendingWhitelistRemove;

    /// @dev Reentrancy guard state for {rescue}.
    uint256 private reentrancyStatus;

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Restricts a function to the protected wallet owner.
    modifier onlyOwner() {
        require(msg.sender == owner, "RescueVault: not owner");
        _;
    }

    /// @dev Restricts a function to the bot address appointed as executor.
    modifier onlyExecutor() {
        require(msg.sender == executor, "RescueVault: not executor");
        _;
    }

    /// @dev Single-entry guard. A hostile token cannot re-enter {rescue} mid-batch.
    modifier nonReentrant() {
        require(reentrancyStatus != REENTRANCY_ENTERED, "RescueVault: reentrant call");
        reentrancyStatus = REENTRANCY_ENTERED;
        _;
        reentrancyStatus = REENTRANCY_NOT_ENTERED;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param owner_ The protected wallet. Tokens are pulled from this address.
     * @param safeAddress_ Where rescued core assets go. Must differ from `owner_`.
     * @param executor_ The bot address allowed to trigger a rescue.
     * @param feeReceiver_ Where the service fee goes.
     * @param feeBps_ The service fee in basis points. Must not exceed {MAX_FEE_BPS}.
     */
    constructor(address owner_, address safeAddress_, address executor_, address feeReceiver_, uint16 feeBps_) {
        require(owner_ != address(0), "RescueVault: owner is zero address");
        require(safeAddress_ != address(0), "RescueVault: safeAddress is zero address");
        require(safeAddress_ != owner_, "RescueVault: safeAddress must differ from owner");
        require(executor_ != address(0), "RescueVault: executor is zero address");
        require(feeReceiver_ != address(0), "RescueVault: feeReceiver is zero address");
        require(feeBps_ <= MAX_FEE_BPS, "RescueVault: feeBps exceeds MAX_FEE_BPS");

        owner = owner_;
        safeAddress = safeAddress_;
        executor = executor_;
        feeReceiver = feeReceiver_;
        feeBps = feeBps_;
        reentrancyStatus = REENTRANCY_NOT_ENTERED;
    }

    /*//////////////////////////////////////////////////////////////
                            RESCUE ACTION
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function rescue(address[] calldata tokens, bool[] calldata chargeFee) external onlyExecutor nonReentrant {
        uint256 length = tokens.length;

        require(length == chargeFee.length, "RescueVault: length mismatch");
        require(length <= MAX_TOKENS_PER_TX, "RescueVault: too many tokens");

        for (uint256 i; i < length; ++i) {
            _rescueOne(tokens[i], chargeFee[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            SAFE ADDRESS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function requestSafeChange(address newSafe) external onlyOwner {
        require(newSafe != address(0), "RescueVault: newSafe is zero address");
        require(newSafe != owner, "RescueVault: newSafe must differ from owner");

        pendingSafeAddress = newSafe;
        safeChangeRequestTime = block.timestamp;

        emit SafeChangeRequested(newSafe, block.timestamp);
    }

    /// @inheritdoc IRescueVault
    function confirmSafeChange() external onlyOwner {
        require(pendingSafeAddress != address(0), "RescueVault: no pending safe change");
        require(
            block.timestamp >= safeChangeRequestTime + SAFE_CHANGE_DELAY,
            "RescueVault: safe change timelock not elapsed"
        );

        safeAddress = pendingSafeAddress;
        pendingSafeAddress = address(0);

        emit SafeChangeConfirmed(safeAddress);
    }

    /// @inheritdoc IRescueVault
    function cancelSafeChange() external onlyOwner {
        pendingSafeAddress = address(0);
        safeChangeRequestTime = 0;

        emit SafeChangeCancelled();
    }

    /*//////////////////////////////////////////////////////////////
                         QUARANTINE ADDRESS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function requestQuarantineChange(address newQuarantine) external onlyOwner {
        require(newQuarantine != address(0), "RescueVault: newQuarantine is zero address");
        require(newQuarantine != owner, "RescueVault: newQuarantine must differ from owner");

        pendingQuarantineAddress = newQuarantine;
        quarantineChangeRequestTime = block.timestamp;

        emit QuarantineChangeRequested(newQuarantine, block.timestamp);
    }

    /// @inheritdoc IRescueVault
    function confirmQuarantineChange() external onlyOwner {
        require(pendingQuarantineAddress != address(0), "RescueVault: no pending quarantine change");
        require(
            block.timestamp >= quarantineChangeRequestTime + QUARANTINE_CHANGE_DELAY,
            "RescueVault: quarantine change timelock not elapsed"
        );

        quarantineAddress = pendingQuarantineAddress;
        pendingQuarantineAddress = address(0);

        emit QuarantineChangeConfirmed(quarantineAddress);
    }

    /// @inheritdoc IRescueVault
    function cancelQuarantineChange() external onlyOwner {
        pendingQuarantineAddress = address(0);
        quarantineChangeRequestTime = 0;

        emit QuarantineChangeCancelled();
    }

    /*//////////////////////////////////////////////////////////////
                            EXECUTOR
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function requestExecutorChange(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "RescueVault: newExecutor is zero address");

        pendingExecutor = newExecutor;
        executorChangeRequestTime = block.timestamp;

        emit ExecutorChangeRequested(newExecutor, block.timestamp);
    }

    /// @inheritdoc IRescueVault
    function confirmExecutorChange() external onlyOwner {
        require(pendingExecutor != address(0), "RescueVault: no pending executor change");
        require(
            block.timestamp >= executorChangeRequestTime + EXECUTOR_CHANGE_DELAY,
            "RescueVault: executor change timelock not elapsed"
        );

        executor = pendingExecutor;
        pendingExecutor = address(0);

        emit ExecutorChanged(executor);
    }

    /// @inheritdoc IRescueVault
    function cancelExecutorChange() external onlyOwner {
        pendingExecutor = address(0);
        executorChangeRequestTime = 0;

        emit ExecutorChangeCancelled();
    }

    /*//////////////////////////////////////////////////////////////
                              WHITELIST
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function requestWhitelistAdd(address account) external onlyOwner {
        pendingWhitelistAdd[account] = block.timestamp;

        emit WhitelistAddRequested(account, block.timestamp);
    }

    /// @inheritdoc IRescueVault
    function confirmWhitelistAdd(address account) external onlyOwner {
        uint256 requestedAt = pendingWhitelistAdd[account];
        require(requestedAt != 0, "RescueVault: no pending whitelist add");
        require(
            block.timestamp >= requestedAt + WHITELIST_CHANGE_DELAY, "RescueVault: whitelist add timelock not elapsed"
        );

        whitelist[account] = true;
        delete pendingWhitelistAdd[account];

        emit WhitelistAdded(account);
    }

    /// @inheritdoc IRescueVault
    function requestWhitelistRemove(address account) external onlyOwner {
        pendingWhitelistRemove[account] = block.timestamp;

        emit WhitelistRemoveRequested(account, block.timestamp);
    }

    /// @inheritdoc IRescueVault
    function confirmWhitelistRemove(address account) external onlyOwner {
        uint256 requestedAt = pendingWhitelistRemove[account];
        require(requestedAt != 0, "RescueVault: no pending whitelist remove");
        require(
            block.timestamp >= requestedAt + WHITELIST_CHANGE_DELAY,
            "RescueVault: whitelist remove timelock not elapsed"
        );

        whitelist[account] = false;
        delete pendingWhitelistRemove[account];

        emit WhitelistRemoved(account);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Rescues a single token in isolation. Every failure mode — unreachable
     *      code, reverting `balanceOf`, malformed return data, reverting or
     *      gas-burning `transferFrom` — is reported as an event and skipped.
     *      Nothing here can revert the batch.
     */
    function _rescueOne(address token, bool chargeFee) private {
        (bool balanceOk, bytes memory balanceData) =
            token.staticcall{gas: BALANCE_GAS_LIMIT}(abi.encodeCall(IERC20.balanceOf, (owner)));

        if (!balanceOk || balanceData.length < 32) {
            emit RescueSkipped(token, REASON_BALANCE_OF);
            return;
        }

        uint256 balance = abi.decode(balanceData, (uint256));
        if (balance == 0) {
            emit RescueSkipped(token, REASON_ZERO_BALANCE);
            return;
        }

        // Watch-set tokens (chargeFee == false) go to quarantine so that the cold
        // wallet stays clean; with no quarantine configured they fall back to the
        // safe address, which is the default single-destination behaviour.
        address destination = (!chargeFee && quarantineAddress != address(0)) ? quarantineAddress : safeAddress;

        uint256 fee = chargeFee ? ((balance * feeBps) / BPS_DENOMINATOR) : 0;
        uint256 amount = balance - fee;

        if (amount != 0) {
            if (!_safeTransferFrom(token, owner, destination, amount)) {
                emit RescueFailed(token, amount);
                return;
            }
        }

        // The fee is best effort: the assets are already safe at this point, so a
        // failing fee transfer is reported rather than reverting the whole batch.
        if (fee != 0 && !_safeTransferFrom(token, owner, feeReceiver, fee)) {
            emit RescueFailed(token, fee);
        }

        emit Rescued(token, amount, destination);
    }

    /**
     * @dev `transferFrom` with a bounded gas stipend and a tolerant return check:
     *      an empty return (USDT-style) counts as success, anything shorter than
     *      32 bytes counts as failure, and a `false` return counts as failure.
     *      Never reverts.
     */
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private returns (bool) {
        (bool success, bytes memory returndata) =
            token.call{gas: TOKEN_GAS_LIMIT}(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));

        if (!success) return false;
        if (returndata.length == 0) return true;
        if (returndata.length < 32) return false;

        return abi.decode(returndata, (bool));
    }
}
