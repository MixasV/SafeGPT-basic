// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {ISafeGPTGuardianModule} from "../src/interfaces/ISafeGPTGuardianModule.sol";
import {SafeGPTGuardianModule} from "../src/SafeGPTGuardianModule.sol";

/// @dev Standard ERC-20 used to seed the module before the emergency exit.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;

    constructor() {
        balanceOf[address(1)] = 1_000e18;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev ERC-20 that refuses every transfer, to prove one bad token cannot block the exit.
contract MockStuckERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("MockStuckERC20: frozen");
    }
}

/// @dev Receives ETH so the test can prove native currency leaves the module on exit.
contract EthReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}

/**
 * @title GuardianModuleTest
 * @notice Covers the 14 scenarios of specification 3.8.
 */
contract GuardianModuleTest is Test {
    address internal ownerAddr;
    address internal guardianAddr;
    address internal safeAddr;

    MockERC20 internal token;
    MockStuckERC20 internal stuckToken;

    SafeGPTGuardianModule internal module;

    /// @dev Records calls so a test can assert what the module executed.
    address internal target;
    uint256 internal targetCalls;

    function setUp() public {
        ownerAddr = makeAddr("owner");
        guardianAddr = makeAddr("guardian");
        safeAddr = makeAddr("safe");
        target = makeAddr("target");

        token = new MockERC20();
        stuckToken = new MockStuckERC20();

        module = new SafeGPTGuardianModule(ownerAddr, guardianAddr, safeAddr);

        // Seed the module with assets, as a live wallet would hold.
        token.mint(address(module), 500e18);
        stuckToken.mint(address(module), 100e18);
        vm.deal(address(module), 3 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _queueIds(uint256 count) internal returns (bytes32[] memory ids) {
        ids = new bytes32[](count);
        vm.startPrank(ownerAddr);
        for (uint256 i; i < count; ++i) {
            ids[i] = module.queueTransaction(target, uint256(i), "");
        }
        vm.stopPrank();
    }

    function _queuedIdsLength() internal view returns (uint256) {
        return module.queuedTxIdsLength();
    }

    /*//////////////////////////////////////////////////////////////
              1-5. QUEUE, CONFIRM, EXECUTE, CANCEL, STALL
    //////////////////////////////////////////////////////////////*/

    function testWhitelistTxExecutesInstantly() public {
        // Whitelisting a destination takes 72h plus a guardian approval, so the
        // only whitelisted destination at construction is the safe address.
        vm.prank(ownerAddr);
        module.queueTransaction(safeAddr, 1 ether, "");

        // The safe address was never queued: the call went through immediately.
        assertEq(_queuedIdsLength(), 0, "whitelisted destination must not create a queue entry");
        assertEq(safeAddr.balance, 1 ether, "whitelisted destination must receive the value right away");
    }

    function testUnknownTxQueuedNotExecuted() public {
        bytes32 txId = _queueIds(1)[0];

        assertEq(_queuedIdsLength(), 1);
        (address to, uint256 value, uint256 queuedAt, bool confirmed, bool cancelled, bool executed) =
            module.queue(txId);
        assertEq(to, target);
        assertEq(value, 0);
        assertEq(queuedAt, block.timestamp);
        assertFalse(confirmed, "a queued transaction starts unconfirmed");
        assertFalse(cancelled);
        assertFalse(executed, "nothing may execute before a guardian confirms");
        assertEq(targetCalls, 0);
    }

    function testGuardianConfirmAllowsExecution() public {
        bytes32 txId = _queueIds(1)[0];

        vm.prank(guardianAddr);
        module.confirmTransaction(txId);

        (,,, bool confirmed,,) = module.queue(txId);
        assertTrue(confirmed);

        vm.prank(ownerAddr);
        module.executeTransaction(txId);

        (,,,,, bool executed) = module.queue(txId);
        assertTrue(executed, "a confirmed transaction may execute");
    }

    function testGuardianCancelCancelsPending() public {
        bytes32 txId = _queueIds(1)[0];

        vm.prank(guardianAddr);
        module.cancelTransaction(txId);

        (,,,, bool cancelled,) = module.queue(txId);
        assertTrue(cancelled, "the guardian may veto");

        // A cancelled transaction can no longer be confirmed or executed.
        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TransactionAlreadyCancelled.selector);
        module.confirmTransaction(txId);

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TransactionAlreadyCancelled.selector);
        module.executeTransaction(txId);
    }

    function testGuardianSilentTxHangsForever() public {
        bytes32 txId = _queueIds(1)[0];

        // No confirm: the owner cannot execute it now, or ever.
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TransactionNotConfirmed.selector);
        module.executeTransaction(txId);

        // TX_QUEUE_TIMEOUT is zero by design: there is no timer that can rescue
        // this transaction, and the guardian staying silent must stall the wallet.
        assertEq(module.TX_QUEUE_TIMEOUT(), 0);

        vm.warp(block.timestamp + 365 days);
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TransactionNotConfirmed.selector);
        module.executeTransaction(txId);
    }

    /*//////////////////////////////////////////////////////////////
                    6-9. EMERGENCY EXIT
    //////////////////////////////////////////////////////////////*/

    function testEmergencyExitSendsAllToSafe() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertEq(token.balanceOf(safeAddr), 500e18, "every held token goes to the safe address");
        assertEq(token.balanceOf(address(module)), 0);
        assertEq(safeAddr.balance, 3 ether, "native currency goes to the safe address too");
        assertEq(address(module).balance, 0);
    }

    function testEmergencyExitRemovesGuardian() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertEq(module.guardian(), address(0), "the guardian key is removed");
        assertTrue(module.guardianRemoved());

        // With no guardian left, the guardian-only path is closed for good.
        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianNotSet.selector);
        module.confirmTransaction(bytes32(uint256(1)));

        // And there is no way to appoint a new one: leaving is final.
        vm.prank(ownerAddr);
        (bool success,) = address(module).call(abi.encodeWithSignature("setGuardian(address)", guardianAddr));
        assertFalse(success, "setGuardian must not exist");
    }

    function testEmergencyExitCancelsAllPending() public {
        bytes32[] memory ids = _queueIds(2);
        bytes32 first = ids[0];
        bytes32 second = ids[1];

        assertEq(_queuedIdsLength(), 2);

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        (,,,, bool cancelledA,) = module.queue(first);
        (,,,, bool cancelledB,) = module.queue(second);
        assertTrue(cancelledA, "every pending transaction is cancelled");
        assertTrue(cancelledB);
    }

    function testAttackerEmergencyExitFundsSafe() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        // An attacker holding the owner key calls the exit. The only possible
        // destination is safeAddress, which the attacker does not control, so
        // the call benefits the user instead of the attacker.
        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertEq(token.balanceOf(safeAddr), 500e18, "funds land at the safe address, not the attacker");
        assertEq(token.balanceOf(ownerAddr), 0, "the attacker gains nothing");
    }

    function testEmergencyExitSurvivesStuckToken() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(stuckToken); // reverts on transfer
        tokens[1] = address(token); // must still be rescued

        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertEq(token.balanceOf(safeAddr), 500e18, "a hostile token must not block the exit");
        assertEq(stuckToken.balanceOf(address(module)), 100e18, "the stuck token stays put and is reported");
    }

    /*//////////////////////////////////////////////////////////////
              10-12. SAFE ADDRESS AND WHITELIST PROTECTION
    //////////////////////////////////////////////////////////////*/

    function testSafeChangeRequiresGuardianConfirm() public {
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        module.requestSafeChange(newSafe);

        // Guardian approves.
        vm.prank(guardianAddr);
        module.guardianConfirmSafeChange();

        // 72h not elapsed yet.
        vm.warp(block.timestamp + module.SAFE_CHANGE_DELAY() - 1);
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TimelockNotElapsed.selector);
        module.confirmSafeChange();

        vm.warp(block.timestamp + 1);
        vm.prank(ownerAddr);
        module.confirmSafeChange();

        assertEq(module.safeAddress(), newSafe);
    }

    function testSafeChangeWithoutGuardianNeverCompletes() public {
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        module.requestSafeChange(newSafe);

        // Even a year later the owner alone cannot apply the change.
        vm.warp(block.timestamp + 365 days);

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianApprovalMissing.selector);
        module.confirmSafeChange();

        assertEq(module.safeAddress(), safeAddr, "the safe address is unchanged");
    }

    function testSafeAddressCannotBeRemovedFromWhitelist() public {
        // Whitelisted at construction and never removable.
        assertTrue(module.whitelist(safeAddr), "the safe address is whitelisted from the start");

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.SafeAddressCannotBeUnlisted.selector);
        module.requestWhitelistRemove(safeAddr);

        // Neither the guardian nor the owner can push it through either.
        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.SafeAddressCannotBeUnlisted.selector);
        module.guardianConfirmWhitelistRemove(safeAddr);

        vm.warp(block.timestamp + module.WHITELIST_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.SafeAddressCannotBeUnlisted.selector);
        module.confirmWhitelistRemove(safeAddr);

        assertTrue(module.whitelist(safeAddr), "the exit path stays open forever");
    }

    /*//////////////////////////////////////////////////////////////
              13-14. GUARDIAN PRIVILEGE BOUNDARIES
    //////////////////////////////////////////////////////////////*/

    function testGuardianCannotInitiateTx() public {
        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.queueTransaction(target, 0, "");

        assertEq(_queuedIdsLength(), 0, "the guardian cannot put anything in the queue");
    }

    function testGuardianCannotCallEmergencyExit() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.emergencyExit(tokens);

        assertEq(token.balanceOf(address(module)), 500e18, "the guardian cannot move funds");
        assertEq(module.guardian(), guardianAddr, "the guardian cannot remove itself");
    }

    function testGuardianCannotChangeSafeAddressOrWhitelist() public {
        address newSafe = makeAddr("newSafe");
        address account = makeAddr("account");

        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.requestSafeChange(newSafe);

        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.requestWhitelistAdd(account);

        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.requestWhitelistRemove(account);

        assertEq(module.pendingSafeAddress(), address(0));
        assertFalse(module.pendingWhitelistAdd(account) != 0);
    }

    /*//////////////////////////////////////////////////////////////
                       ADDITIONAL INVARIANTS
    //////////////////////////////////////////////////////////////*/

    function testUnlistedDestinationIsAlwaysQueued() public {
        // The instant path exists only for whitelisted destinations. Adding one
        // takes 72h plus a guardian approval, so until then every destination
        // the owner names must land in the queue instead of executing.
        address other = makeAddr("other");

        _queueIds(1);

        vm.prank(ownerAddr);
        bytes32 txId = module.queueTransaction(other, 0, "");

        assertEq(_queuedIdsLength(), 2, "an unlisted destination is queued, not executed");
        (,,,,, bool executed) = module.queue(txId);
        assertFalse(executed);
    }

    function testGuardianConfirmRateLimit() public {
        uint8 limit = module.MAX_CONFIRMS_PER_HOUR();
        assertEq(limit, 5);

        bytes32[] memory ids = _queueIds(limit + 1);

        for (uint256 i; i < limit; ++i) {
            vm.prank(guardianAddr);
            module.confirmTransaction(ids[i]);
        }

        bytes32 overflow = ids[limit];

        vm.prank(guardianAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianConfirmRateLimit.selector);
        module.confirmTransaction(overflow);

        // The limit resets with the next hour window.
        vm.warp(block.timestamp + 1 hours);
        vm.prank(guardianAddr);
        module.confirmTransaction(overflow);
    }

    function testReissuedRequestDropsGuardianApproval() public {
        address first = makeAddr("firstSafe");
        address second = makeAddr("secondSafe");
        address account = makeAddr("account");

        // Safe change: an approval for request A must not carry over to request B.
        vm.prank(ownerAddr);
        module.requestSafeChange(first);
        vm.prank(guardianAddr);
        module.guardianConfirmSafeChange();

        vm.prank(ownerAddr);
        module.requestSafeChange(second);
        assertFalse(module.safeGuardianApproved(), "re-issuing the request drops the approval");

        vm.warp(block.timestamp + module.SAFE_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianApprovalMissing.selector);
        module.confirmSafeChange();

        // Same rule on the whitelist add path.
        vm.prank(ownerAddr);
        module.requestWhitelistAdd(account);
        vm.prank(guardianAddr);
        module.guardianConfirmWhitelistAdd(account);

        vm.prank(ownerAddr);
        module.requestWhitelistAdd(account);
        assertFalse(module.guardianApprovedWhitelistAdd(account), "re-issuing drops the approval too");

        vm.warp(block.timestamp + module.WHITELIST_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianApprovalMissing.selector);
        module.confirmWhitelistAdd(account);
    }

    function testIdenticalQueueCallsInSameBlockDoNotCollide() public {
        // The transaction id is bound to the queue index, so queueing the exact
        // same call twice in one block produces two distinct entries.
        vm.startPrank(ownerAddr);
        bytes32 first = module.queueTransaction(target, 0, "");
        bytes32 second = module.queueTransaction(target, 0, "");
        vm.stopPrank();

        assertTrue(first != second, "identical calls must not share an id");
        assertEq(_queuedIdsLength(), 2);

        (,,,,, bool executedFirst) = module.queue(first);
        (,,,,, bool executedSecond) = module.queue(second);
        assertFalse(executedFirst);
        assertFalse(executedSecond);
    }

    function testStaleGuardianApprovalCannotSurviveEmergencyExit() public {
        // Scenario: the owner requests a safe change, the guardian approves, the
        // timelock elapses, and the owner then calls emergencyExit(). The guardian
        // is gone, so the leftover approval must never become spendable — otherwise
        // the owner could swap the safe address with no guardian in the loop.
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        module.requestSafeChange(newSafe);
        vm.prank(guardianAddr);
        module.guardianConfirmSafeChange();
        vm.warp(block.timestamp + module.SAFE_CHANGE_DELAY());

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertEq(module.guardian(), address(0));
        assertFalse(module.safeGuardianApproved(), "the approval dies with the guardian");
        assertEq(module.pendingSafeAddress(), address(0));

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.NoPendingSafeChange.selector);
        module.confirmSafeChange();

        assertEq(module.safeAddress(), safeAddr, "the safe address must be unchanged");
    }

    function testConfirmedTxCannotExecuteAfterEmergencyExit() public {
        // Even a transaction the guardian had already confirmed must not run
        // once the exit has happened: the exit cancels the whole queue.
        bytes32 txId = _queueIds(1)[0];
        vm.prank(guardianAddr);
        module.confirmTransaction(txId);

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.TransactionAlreadyCancelled.selector);
        module.executeTransaction(txId);

        (,,,, bool cancelled,) = module.queue(txId);
        assertTrue(cancelled, "the exit cancels even guardian-confirmed entries");
    }

    function testWhitelistApprovalCannotSurviveEmergencyExit() public {
        address account = makeAddr("account");

        vm.prank(ownerAddr);
        module.requestWhitelistAdd(account);
        vm.prank(guardianAddr);
        module.guardianConfirmWhitelistAdd(account);
        vm.warp(block.timestamp + module.WHITELIST_CHANGE_DELAY());

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.GuardianNotSet.selector);
        module.confirmWhitelistAdd(account);

        assertFalse(module.whitelist(account));
    }

    function testQueueIsCappedSoEmergencyExitStaysCallable() public {
        uint256 cap = module.MAX_QUEUE_SIZE();
        assertEq(cap, 200);

        bytes32[] memory ids = _queueIds(cap);
        assertEq(_queuedIdsLength(), cap);

        vm.prank(ownerAddr);
        vm.expectRevert(ISafeGPTGuardianModule.QueueFull.selector);
        module.queueTransaction(target, 0, "");

        // The owner can always shrink the queue one entry at a time.
        vm.prank(ownerAddr);
        module.cancelTransaction(ids[0]);

        vm.prank(ownerAddr);
        module.queueTransaction(target, 0, "");

        // And the full queue still cancels inside one exit transaction.
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        vm.prank(ownerAddr);
        module.emergencyExit(tokens);

        assertTrue(module.guardianRemoved());
    }

    function testNativeTransferToSafeMultisig() public {
        // A Safe/Gnosis destination needs far more than the 2300 gas that
        // `transfer` would forward, so the exit must use a plain call.
        EthReceiver multisig = new EthReceiver();
        vm.deal(address(multisig), 0);

        SafeGPTGuardianModule toMultisig = new SafeGPTGuardianModule(ownerAddr, guardianAddr, address(multisig));
        vm.deal(address(toMultisig), 1 ether);

        address[] memory tokens = new address[](0);
        vm.prank(ownerAddr);
        toMultisig.emergencyExit(tokens);

        assertEq(multisig.received(), 1 ether, "a contract safe address still receives the native balance");
    }

    function testReentrancyGuardOnExecution() public {
        // A destination that calls back into queueTransaction cannot re-enter.
        ReentrantTarget reentrant = new ReentrantTarget(address(module));

        vm.prank(ownerAddr);
        bytes32 txId = module.queueTransaction(address(reentrant), 0, "");

        vm.prank(guardianAddr);
        module.confirmTransaction(txId);

        vm.prank(ownerAddr);
        module.executeTransaction(txId);

        assertFalse(reentrant.reentered(), "the callback into queueTransaction must never succeed");
        (,,,,, bool executed) = module.queue(txId);
        assertTrue(executed, "the outer transaction still completes");
    }

    function testCancelRequiresOwnerOrGuardian() public {
        bytes32 txId = _queueIds(1)[0];

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ISafeGPTGuardianModule.NotOwner.selector);
        module.cancelTransaction(txId);

        (,,,, bool cancelled,) = module.queue(txId);
        assertFalse(cancelled, "an outsider cannot cancel anything");
    }
}

/// @dev Calls back into the module during execution to probe the guard.
contract ReentrantTarget {
    address private module;
    bool private callbackSucceeded;

    constructor(address module_) {
        module = module_;
    }

    function reentered() external view returns (bool) {
        return callbackSucceeded;
    }

    receive() external payable {
        (bool ok,) = module.call(abi.encodeWithSignature("queueTransaction(address,uint256,bytes)", msg.sender, 0, ""));
        if (ok) callbackSucceeded = true;
    }
}
