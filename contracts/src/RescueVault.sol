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
 *      - `rescue()` is callable ONLY by `executor` and can ONLY send tokens to
 *        the `safeAddress` / `feeReceiver` pair held in storage. There is no
 *        arbitrary-recipient path and no `withdraw()`.
 *      - `safeAddress` and `whitelist` can only be mutated by the owner AND
 *        only after a {SAFE_CHANGE_DELAY} / {WHITELIST_CHANGE_DELAY} timelock,
 *        so a stolen owner key cannot redirect a rescue instantly.
 *      - `feeBps` is fixed at deployment and hard-capped by {MAX_FEE_BPS}.
 *      - There is intentionally no pause mechanism: pausing is a griefing
 *        vector for a rescue contract, and the timelock already covers the
 *        legitimate need to change configuration.
 */
contract RescueVault is IRescueVault {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Delay that must elapse before a safe address change is applied.
    uint256 public constant SAFE_CHANGE_DELAY = 72 hours;

    /// @notice Delay that must elapse before a whitelist change is applied.
    uint256 public constant WHITELIST_CHANGE_DELAY = 72 hours;

    /// @notice Hard cap on the service fee: 1000 bps = 10%. Not settable.
    uint16 public constant MAX_FEE_BPS = 1000;

    /// @dev Denominator for basis-point arithmetic.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    address public owner;

    /// @inheritdoc IRescueVault
    address public safeAddress;

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
    mapping(address => bool) public whitelist;

    /// @inheritdoc IRescueVault
    mapping(address => uint256) public pendingWhitelistAdd;

    /// @inheritdoc IRescueVault
    mapping(address => uint256) public pendingWhitelistRemove;

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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param owner_ The protected wallet. Tokens are pulled from this address.
     * @param safeAddress_ Where rescued tokens go. Must differ from `owner_`.
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
    }

    /*//////////////////////////////////////////////////////////////
                            RESCUE ACTION
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function rescue(address[] calldata tokens) external onlyExecutor {
        uint256 length = tokens.length;

        for (uint256 i; i < length; ++i) {
            address token = tokens[i];

            // Read through the typed interface on purpose: the extcodesize check
            // Solidity inserts makes a non-contract token address revert instead
            // of silently returning a zero balance.
            uint256 balance = IERC20(token).balanceOf(owner);
            if (balance == 0) continue;

            // Fee is computed on the full balance and the remainder is what lands
            // on the safe address, so the two transfers always add up to the balance.
            uint256 fee = (balance * feeBps) / BPS_DENOMINATOR;
            uint256 amountToSafe = balance - fee;

            if (amountToSafe != 0) _safeTransferFrom(token, owner, safeAddress, amountToSafe);
            if (fee != 0) _safeTransferFrom(token, owner, feeReceiver, fee);

            emit Rescued(token, amountToSafe, safeAddress);
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
                              EXECUTOR
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IRescueVault
    function setExecutor(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "RescueVault: newExecutor is zero address");

        executor = newExecutor;

        emit ExecutorChanged(newExecutor);
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
        require(block.timestamp >= requestedAt + WHITELIST_CHANGE_DELAY, "RescueVault: whitelist add timelock not elapsed");

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
     * @dev `transferFrom` that tolerates non-standard ERC-20 tokens (USDT-style,
     *      which return no data). A failed call bubbles up the original revert
     *      reason so the reason string of the offending token is not lost.
     */
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory returndata) =
            token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));

        if (!success) {
            assembly ("memory-safe") {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }

        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert TransferFromFailed(token, from, to, amount);
        }
    }
}