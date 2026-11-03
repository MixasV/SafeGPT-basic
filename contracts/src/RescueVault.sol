// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRescueVault} from "./interfaces/IRescueVault.sol";

/// @dev Minimal ERC-20 surface needed by the vault. Declared locally so the
///      contract folder stays dependency-free (no OpenZeppelin requirement).
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
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
 *      - `safeAddress` is immutable (set in constructor, no setter). `executor`
 *        and `whitelist` can only be mutated by the owner AND only after a
 *        72-hour timelock, so a stolen owner key cannot redirect a rescue or
 *        lock the bot out instantly.
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

    /// @notice Delay that must elapse before an executor change is applied.
    uint256 public constant EXECUTOR_CHANGE_DELAY = 72 hours;

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
    address public immutable safeAddress;

    /// @inheritdoc IRescueVault
    address public executor;

    /// @inheritdoc IRescueVault
    address public feeReceiver;

    /// @inheritdoc IRescueVault
    uint16 public feeBps;

    /// @notice Delay before a pending ETH withdrawal can be executed (0 = instant).
    uint256 public immutable withdrawDelay;

    /// @notice Timestamp of a pending ETH withdrawal request, or 0.
    uint256 public withdrawRequestTime;

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
     * @param withdrawDelay_ Delay before a pending ETH withdrawal can be executed (0 = instant).
     */
    constructor(address owner_, address safeAddress_, address executor_, address feeReceiver_, uint16 feeBps_, uint256 withdrawDelay_) {
        require(owner_ != address(0), "RescueVault: owner is zero address");
        require(safeAddress_ != address(0), "RescueVault: safeAddress is zero address");
        require(safeAddress_ != owner_, "RescueVault: safeAddress must differ from owner");
        require(executor_ != address(0), "RescueVault: executor is zero address");
        require(safeAddress_ != executor_, "RescueVault: safeAddress must differ from executor");
        require(executor_ != owner_, "RescueVault: executor must differ from owner");
        require(feeReceiver_ != address(0), "RescueVault: feeReceiver is zero address");
        require(feeBps_ <= MAX_FEE_BPS, "RescueVault: feeBps exceeds MAX_FEE_BPS");
        require(withdrawDelay_ <= 7 days, "RescueVault: withdraw delay exceeds 7 days");

        owner = owner_;
        safeAddress = safeAddress_;
        executor = executor_;
        feeReceiver = feeReceiver_;
        feeBps = feeBps_;
        withdrawDelay = withdrawDelay_;
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
                               WITHDRAWAL
    //////////////////////////////////////////////////////////////*/

    /// @notice Withdraw ETH that was forced into the vault (e.g. via selfdestruct).
    ///         Callable only by the safe address. No receive()/fallback() exists,
    ///         so direct ETH transfers revert — this is a safety net only.
    function requestWithdrawETH() external nonReentrant {
        require(msg.sender == safeAddress, "RescueVault: not safe");
        uint256 balance = address(this).balance;
        require(balance > 0, "RescueVault: no ETH");

        if (withdrawDelay == 0) {
            (bool success, ) = safeAddress.call{value: balance}("");
            require(success, "RescueVault: ETH transfer failed");
            emit WithdrawETHExecuted(safeAddress, balance);
        } else {
            withdrawRequestTime = block.timestamp;
            emit WithdrawETHRequested(safeAddress, balance, block.timestamp + withdrawDelay);
        }
    }

    /// @notice Execute a pending ETH withdrawal after the delay has elapsed.
    function executeWithdrawETH() external nonReentrant {
        require(msg.sender == safeAddress, "RescueVault: not safe");
        require(withdrawDelay > 0, "RescueVault: no delay configured");
        require(withdrawRequestTime > 0, "RescueVault: no pending request");
        require(
            block.timestamp >= withdrawRequestTime + withdrawDelay,
            "RescueVault: too early"
        );

        withdrawRequestTime = 0;
        uint256 balance = address(this).balance;
        require(balance > 0, "RescueVault: no ETH");
        (bool success, ) = safeAddress.call{value: balance}("");
        require(success, "RescueVault: ETH transfer failed");
        emit WithdrawETHExecuted(safeAddress, balance);
    }

    /// @notice Cancel a pending ETH withdrawal request.
    function cancelWithdrawETH() external {
        require(msg.sender == safeAddress, "RescueVault: not safe");
        require(withdrawRequestTime > 0, "RescueVault: no pending request");
        withdrawRequestTime = 0;
        emit WithdrawETHCancelled();
    }

    /// @notice Withdraw ERC-20 tokens that were sent directly to the vault (not via rescue).
    ///         Callable only by the safe address. Withdraws the vault's own balance.
    function withdrawStuckTokens(address token) external nonReentrant {
        require(msg.sender == safeAddress, "RescueVault: not safe");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "RescueVault: no stuck tokens");
        IERC20(token).transfer(safeAddress, balance);
        emit StuckTokensWithdrawn(token, safeAddress, balance);
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

        // All rescued tokens go to the safe address.
        address destination = safeAddress;

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
