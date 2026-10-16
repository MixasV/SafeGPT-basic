// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {IRescueVault} from "../src/interfaces/IRescueVault.sol";
import {RescueVault} from "../src/RescueVault.sol";
import {RescueVaultFactory} from "../src/RescueVaultFactory.sol";

/// @dev Minimal, standards-compliant ERC-20 used to fund the protected wallet.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev ERC-20 that returns no data from `transferFrom` (USDT-style).
contract MockNoReturnERC20 is MockERC20 {
    constructor() MockERC20("No Return Token", "NRT", 18) {}

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(allowance[from][msg.sender] >= amount, "MockNoReturnERC20: insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        assembly {
            return(0, 0)
        }
    }
}

/// @dev Hostile token: `transferFrom` always reverts.
contract MockRevertingERC20 is MockERC20 {
    constructor() MockERC20("Reverting Token", "REV", 18) {}

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        revert("MockRevertingERC20: always reverts");
    }
}

/// @dev Hostile token: `transferFrom` returns a single malformed byte.
contract MockMalformedERC20 is MockERC20 {
    constructor() MockERC20("Malformed Token", "MAL", 18) {}

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        assembly {
            mstore(0x00, 1)
            return(0x00, 1)
        }
    }
}

/// @dev Hostile token: `transferFrom` burns every unit of gas it is given.
///      The vault must cap this with TOKEN_GAS_LIMIT and move on.
contract MockGasBombERC20 is MockERC20 {
    constructor() MockERC20("Gas Bomb", "BOMB", 18) {}

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        while (true) {}
    }
}

/// @dev Hostile token: during `transferFrom` it calls back into the vault.
contract MockReentrantERC20 is MockERC20 {
    address public vault;
    bool public callbackSucceeded;

    constructor() MockERC20("Reentrant Token", "REENT", 18) {}

    function setVault(address vault_) external {
        vault = vault_;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        address[] memory tokens = new address[](1);
        bool[] memory chargeFee = new bool[](1);
        tokens[0] = to;
        chargeFee[0] = false;

        (bool ok,) = vault.call(abi.encodeCall(IRescueVault.rescue, (tokens, chargeFee)));
        callbackSucceeded = ok;

        // `super.transferFrom` is unavailable for external functions, so the
        // bookkeeping is repeated here.
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockReentrantERC20: insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title RescueVaultTest
 * @notice Covers the 15 rescue scenarios defined in the SafeGPT specification
 *         plus the UPD-2 isolation tests (16-22) and the UPD-3 executor
 *         timelock tests (23-26).
 */
contract RescueVaultTest is Test {
    uint16 internal constant FEE_BPS = 500; // 5%
    uint256 internal constant BPS = 10_000;

    /// @dev Storage slot of the private `reentrancyStatus` variable (verified with
    ///      `forge inspect src/RescueVault.sol:RescueVault storage`).
    bytes32 internal constant REENTRANCY_SLOT = bytes32(uint256(14));
    uint256 internal constant REENTRANCY_ENTERED = 2;

    address internal ownerAddr;
    address internal safeAddr;
    address internal executorAddr;
    address internal feeReceiverAddr;

    MockERC20 internal usdc;
    MockERC20 internal weth;

    RescueVaultFactory internal factory;
    RescueVault internal vault;

    function setUp() public {
        ownerAddr = makeAddr("owner");
        safeAddr = makeAddr("safe");
        executorAddr = makeAddr("executor");
        feeReceiverAddr = makeAddr("feeReceiver");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);

        factory = new RescueVaultFactory();
        vault = RescueVault(
            factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, keccak256("vault-1"))
        );

        // 5,000 USDC and 2.5 WETH sitting in the protected wallet, fully approved to the vault.
        usdc.mint(ownerAddr, 5_000e6);
        weth.mint(ownerAddr, 2.5e18);

        vm.startPrank(ownerAddr);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                             TEST HELPERS
    //////////////////////////////////////////////////////////////*/

    function _chargeAll(uint256 count) internal pure returns (address[] memory tokens, bool[] memory chargeFee) {
        tokens = new address[](count);
        chargeFee = new bool[](count);
        for (uint256 i; i < count; ++i) {
            chargeFee[i] = true;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        1. RESCUE MECHANICS
    //////////////////////////////////////////////////////////////*/

    function testRescueSingleToken() public {
        uint256 balanceBefore = usdc.balanceOf(ownerAddr);
        uint256 expectedFee = (balanceBefore * FEE_BPS) / BPS;
        uint256 expectedToSafe = balanceBefore - expectedFee;

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IRescueVault.Rescued(address(usdc), expectedToSafe, safeAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(safeAddr), expectedToSafe, "safe must receive balance minus fee");
        assertEq(usdc.balanceOf(feeReceiverAddr), expectedFee, "fee receiver must receive the fee");
        assertEq(usdc.balanceOf(ownerAddr), 0, "protected wallet must be drained for the token");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault never custodies tokens");
    }

    function testRescueMultipleTokens() public {
        uint256 usdcBalance = usdc.balanceOf(ownerAddr);
        uint256 wethBalance = weth.balanceOf(ownerAddr);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS);
        assertEq(weth.balanceOf(safeAddr), wethBalance - (wethBalance * FEE_BPS) / BPS);
        assertEq(
            usdc.balanceOf(feeReceiverAddr) + weth.balanceOf(feeReceiverAddr),
            (usdcBalance * FEE_BPS) / BPS + (wethBalance * FEE_BPS) / BPS
        );
        assertEq(usdc.balanceOf(ownerAddr), 0);
        assertEq(weth.balanceOf(ownerAddr), 0);
    }

    function testRescueOnlyExecutor() public {
        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);

        // The owner is NOT the executor — the owner must not be able to drain itself through the vault.
        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: not executor");
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(ownerAddr), 5_000e6, "no funds may move on an unauthorized call");
    }

    function testRescueZeroBalance() public {
        MockERC20 emptyToken = new MockERC20("Empty", "EMPTY", 18);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(2);
        tokens[0] = address(usdc);
        tokens[1] = address(emptyToken);

        uint256 usdcBalance = usdc.balanceOf(ownerAddr);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        // The funded token is rescued, the empty one is skipped without reverting.
        assertEq(usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS);
        assertEq(emptyToken.balanceOf(safeAddr), 0);
        assertEq(emptyToken.balanceOf(feeReceiverAddr), 0);
    }

    function testRescueTokenWithoutReturnValue() public {
        // Proves the tolerant return check supports USDT-style tokens.
        MockNoReturnERC20 weird = new MockNoReturnERC20();
        weird.mint(ownerAddr, 100e18);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(weird);

        uint256 balance = weird.balanceOf(ownerAddr);
        uint256 expectedFee = (balance * FEE_BPS) / BPS;

        vm.prank(ownerAddr);
        weird.approve(address(vault), type(uint256).max);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(weird.balanceOf(safeAddr), balance - expectedFee);
        assertEq(weird.balanceOf(feeReceiverAddr), expectedFee);
    }

    /*//////////////////////////////////////////////////////////////
                          2. SAFE ADDRESS
    //////////////////////////////////////////////////////////////*/

    function testSafeChangeTimelock() public {
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        vault.requestSafeChange(newSafe);

        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY() - 1);

        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: safe change timelock not elapsed");
        vault.confirmSafeChange();

        assertEq(vault.safeAddress(), safeAddr, "safe address must be unchanged before the timelock");
        assertEq(vault.pendingSafeAddress(), newSafe);
    }

    function testSafeChangeAfterDelay() public {
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        vault.requestSafeChange(newSafe);

        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());

        vm.prank(ownerAddr);
        vault.confirmSafeChange();

        assertEq(vault.safeAddress(), newSafe);
        assertEq(vault.pendingSafeAddress(), address(0), "pending entry must be cleared after confirmation");
    }

    function testCancelSafeChange() public {
        address newSafe = makeAddr("newSafe");

        vm.prank(ownerAddr);
        vault.requestSafeChange(newSafe);
        vm.prank(ownerAddr);
        vault.cancelSafeChange();

        assertEq(vault.pendingSafeAddress(), address(0));
        assertEq(vault.safeChangeRequestTime(), 0);

        // Even after the delay, a cancelled request can never be confirmed.
        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: no pending safe change");
        vault.confirmSafeChange();

        assertEq(vault.safeAddress(), safeAddr);
    }

    function testAttackerChangesSafe() public {
        // The attacker holds a compromised owner key and schedules a redirect to
        // their own address. Without confirmation (owner TX) + 72h, a rescue must
        // still go to the ORIGINAL safe address.
        address attackerSafe = makeAddr("attackerSafe");

        vm.prank(ownerAddr);
        vault.requestSafeChange(attackerSafe);

        uint256 balanceBefore = usdc.balanceOf(ownerAddr);
        uint256 expectedFee = (balanceBefore * FEE_BPS) / BPS;

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(safeAddr), balanceBefore - expectedFee, "original safe must receive the funds");
        assertEq(usdc.balanceOf(attackerSafe), 0, "attacker must receive nothing");
    }

    function testSafeCannotEqualOwner() public {
        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: newSafe must differ from owner");
        vault.requestSafeChange(ownerAddr);

        // The same invariant is enforced at deployment time.
        vm.expectRevert("RescueVault: safeAddress must differ from owner");
        factory.createVault(ownerAddr, ownerAddr, executorAddr, feeReceiverAddr, FEE_BPS, keccak256("vault-selfsafe"));

        assertEq(vault.safeAddress(), safeAddr);
    }

    /*//////////////////////////////////////////////////////////////
                            3. EXECUTOR
    //////////////////////////////////////////////////////////////*/

    function testSetExecutorOnlyOwner() public {
        address newExecutor = makeAddr("newExecutor");

        vm.expectRevert("RescueVault: not owner");
        vault.requestExecutorChange(newExecutor);
        assertEq(vault.pendingExecutor(), address(0), "no pending change after a rejected call");
        assertEq(vault.executor(), executorAddr, "executor must be unchanged after a rejected call");

        // The instant variant must not exist any more (UPD-3, rule 16).
        (bool legacyExists,) = address(vault).call(abi.encodeWithSignature("setExecutor(address)", newExecutor));
        assertFalse(legacyExists, "setExecutor(address) must be gone");
    }

    /*//////////////////////////////////////////////////////////////
                                FEE
    //////////////////////////////////////////////////////////////*/

    function testFeeCappedAtMax() public {
        uint16 maxFeeBps = vault.MAX_FEE_BPS();
        assertEq(maxFeeBps, 1000, "MAX_FEE_BPS is hardcoded to 10%");

        vm.expectRevert("RescueVault: feeBps exceeds MAX_FEE_BPS");
        factory.createVault(
            ownerAddr, safeAddr, executorAddr, feeReceiverAddr, maxFeeBps + 1, keccak256("vault-over-cap")
        );

        // Exactly the cap is accepted.
        address maxFeeVault = factory.createVault(
            ownerAddr, safeAddr, executorAddr, feeReceiverAddr, maxFeeBps, keccak256("vault-at-cap")
        );
        assertEq(RescueVault(maxFeeVault).feeBps(), maxFeeBps);

        // The fee is immutable: there is no setter on the interface.
        (bool success,) = address(vault).call(abi.encodeWithSignature("setFee(uint16)", 0));
        assertFalse(success, "setFee must not exist");
    }

    /*//////////////////////////////////////////////////////////////
                              WHITELIST
    //////////////////////////////////////////////////////////////*/

    function testWhitelistAddTimelock() public {
        address trusted = makeAddr("trusted");

        vm.prank(ownerAddr);
        vault.requestWhitelistAdd(trusted);
        assertEq(vault.pendingWhitelistAdd(trusted), block.timestamp);

        vm.warp(block.timestamp + vault.WHITELIST_CHANGE_DELAY() - 1);

        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: whitelist add timelock not elapsed");
        vault.confirmWhitelistAdd(trusted);

        assertFalse(vault.whitelist(trusted), "address must not be trusted before the timelock");

        vm.warp(block.timestamp + 1);

        vm.prank(ownerAddr);
        vault.confirmWhitelistAdd(trusted);

        assertTrue(vault.whitelist(trusted), "address must be trusted after the timelock");
        assertEq(vault.pendingWhitelistAdd(trusted), 0, "pending entry must be cleared");
    }

    function testWhitelistRemoveTimelock() public {
        address trusted = makeAddr("trusted");

        vm.prank(ownerAddr);
        vault.requestWhitelistAdd(trusted);
        vm.warp(block.timestamp + vault.WHITELIST_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vault.confirmWhitelistAdd(trusted);
        assertTrue(vault.whitelist(trusted));

        vm.prank(ownerAddr);
        vault.requestWhitelistRemove(trusted);

        vm.warp(block.timestamp + vault.WHITELIST_CHANGE_DELAY() - 1);

        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: whitelist remove timelock not elapsed");
        vault.confirmWhitelistRemove(trusted);

        assertTrue(vault.whitelist(trusted), "address must stay trusted before the timelock");

        vm.warp(block.timestamp + 1);

        vm.prank(ownerAddr);
        vault.confirmWhitelistRemove(trusted);

        assertFalse(vault.whitelist(trusted), "address must be untrusted after the timelock");
        assertEq(vault.pendingWhitelistRemove(trusted), 0, "pending entry must be cleared");
    }

    /*//////////////////////////////////////////////////////////////
                              FACTORY
    //////////////////////////////////////////////////////////////*/

    function testFactoryCreate2() public {
        bytes32 saltA = keccak256("salt-A");
        bytes32 saltB = keccak256("salt-B");

        address vaultA = factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, saltA);
        address vaultB = factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, saltB);

        assertTrue(vaultA != vaultB, "different salts must yield different addresses");
        assertEq(vaultA.codehash, vaultB.codehash, "all vaults must run identical bytecode");
        assertTrue(vaultA.codehash != bytes32(0), "vault must expose runtime code");
        assertTrue(vaultB.codehash != bytes32(0), "vault must expose runtime code");

        // CREATE2 determinism: identical arguments + identical salt collide.
        vm.expectRevert();
        factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, saltA);

        // Every creation announces the vault, its owner and its safe address.
        vm.recordLogs();
        address vaultC =
            factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, keccak256("salt-C"));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "createVault must emit exactly one event");
        assertEq(logs[0].emitter, address(factory), "event must come from the factory");
        assertEq(logs[0].topics[0], keccak256("VaultCreated(address,address,address)"));
        assertEq(address(uint160(uint256(logs[0].topics[1]))), vaultC, "topic 1 must carry the vault address");
        assertEq(address(uint160(uint256(logs[0].topics[2]))), ownerAddr, "topic 2 must carry the owner address");
        assertEq(address(uint160(uint256(logs[0].topics[3]))), safeAddr, "topic 3 must carry the safe address");
    }

    function testRescueAfterSafeChangeConfirmed() public {
        address newSafe = makeAddr("newSafeAfterChange");

        vm.prank(ownerAddr);
        vault.requestSafeChange(newSafe);
        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vault.confirmSafeChange();

        assertEq(vault.safeAddress(), newSafe);

        uint256 balanceBefore = weth.balanceOf(ownerAddr);
        uint256 expectedFee = (balanceBefore * FEE_BPS) / BPS;

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(weth);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(weth.balanceOf(newSafe), balanceBefore - expectedFee, "rescue must follow the NEW safe address");
        assertEq(weth.balanceOf(safeAddr), 0, "old safe must not receive funds after the change is confirmed");
        assertEq(weth.balanceOf(feeReceiverAddr), expectedFee);
    }

    /*//////////////////////////////////////////////////////////////
            UPD-2 (16-22): ISOLATED PER-TOKEN RESCUE EXECUTION
    //////////////////////////////////////////////////////////////*/

    function testRescueSkipsRevertingToken() public {
        MockRevertingERC20 hostile = new MockRevertingERC20();
        hostile.mint(ownerAddr, 100e18);
        MockMalformedERC20 malformed = new MockMalformedERC20();
        malformed.mint(ownerAddr, 50e18);

        vm.startPrank(ownerAddr);
        hostile.approve(address(vault), type(uint256).max);
        malformed.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        uint256 usdcBalance = usdc.balanceOf(ownerAddr);
        uint256 wethBalance = weth.balanceOf(ownerAddr);

        // Hostile tokens first: they must not prevent the healthy ones from being rescued.
        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(4);
        tokens[0] = address(hostile);
        tokens[1] = address(malformed);
        tokens[2] = address(usdc);
        tokens[3] = address(weth);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS, "healthy token must still move");
        assertEq(
            weth.balanceOf(safeAddr),
            wethBalance - (wethBalance * FEE_BPS) / BPS,
            "second healthy token must still move"
        );
        assertEq(hostile.balanceOf(safeAddr), 0, "reverting token must move nothing");
        assertEq(malformed.balanceOf(safeAddr), 0, "malformed token must move nothing");
    }

    function testRescueSkipsGasBombToken() public {
        MockGasBombERC20 bomb = new MockGasBombERC20();
        bomb.mint(ownerAddr, 100e18);

        vm.prank(ownerAddr);
        bomb.approve(address(vault), type(uint256).max);

        uint256 usdcBalance = usdc.balanceOf(ownerAddr);
        uint256 bombBalance = bomb.balanceOf(ownerAddr);
        uint256 bombAmount = bombBalance - (bombBalance * FEE_BPS) / BPS;

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(2);
        tokens[0] = address(bomb);
        tokens[1] = address(usdc);

        // The bomb burns its whole stipend and fails; the vault reports it and moves on.
        vm.expectEmit(true, false, false, true, address(vault));
        emit IRescueVault.RescueFailed(address(bomb), bombAmount);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(
            usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS, "real assets must survive the bomb"
        );
        assertEq(bomb.balanceOf(safeAddr), 0, "gas bomb must move nothing");
    }

    function testRescueSkipsZeroBalance() public {
        MockERC20 emptyToken = new MockERC20("Empty", "EMPTY", 18);

        vm.prank(ownerAddr);
        emptyToken.approve(address(vault), type(uint256).max);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(emptyToken);

        vm.expectEmit(true, false, false, true, address(vault));
        emit IRescueVault.RescueSkipped(address(emptyToken), "ZERO_BALANCE");

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(emptyToken.balanceOf(safeAddr), 0);
    }

    function testRescueNoFeeOnUnverified() public {
        uint256 balanceBefore = usdc.balanceOf(ownerAddr);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);
        chargeFee[0] = false; // watch-set token

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(safeAddr), balanceBefore, "unverified token must arrive without a fee");
        assertEq(usdc.balanceOf(feeReceiverAddr), 0, "no fee may be charged on unverified tokens");
    }

    function testRescueMaxTokensPerTx() public {
        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(vault.MAX_TOKENS_PER_TX() + 1);
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i] = address(usdc);
        }

        vm.prank(executorAddr);
        vm.expectRevert("RescueVault: too many tokens");
        vault.rescue(tokens, chargeFee);

        assertEq(usdc.balanceOf(ownerAddr), 5_000e6, "nothing may move when the batch is rejected");
    }

    function testReentrancyGuardOnRescue() public {
        // A hostile token calling back into rescue() must fail. Two paths are
        // covered: the explicit single-entry guard, and a real callback attempt.
        vm.store(address(vault), REENTRANCY_SLOT, bytes32(REENTRANCY_ENTERED));

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vm.expectRevert("RescueVault: reentrant call");
        vault.rescue(tokens, chargeFee);

        vm.store(address(vault), REENTRANCY_SLOT, bytes32(uint256(1)));

        MockReentrantERC20 reentrant = new MockReentrantERC20();
        reentrant.setVault(address(vault));
        reentrant.mint(ownerAddr, 10e18);

        vm.prank(ownerAddr);
        reentrant.approve(address(vault), type(uint256).max);

        (address[] memory reentrantTokens, bool[] memory reentrantFee) = _chargeAll(1);
        reentrantTokens[0] = address(reentrant);

        vm.prank(executorAddr);
        vault.rescue(reentrantTokens, reentrantFee);

        assertFalse(reentrant.callbackSucceeded(), "the callback into rescue() must never succeed");
    }

    function testQuarantineAddressRouting() public {
        address quarantine = makeAddr("quarantine");

        vm.prank(ownerAddr);
        vault.requestQuarantineChange(quarantine);
        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vault.confirmQuarantineChange();
        assertEq(vault.quarantineAddress(), quarantine);

        uint256 usdcBalance = usdc.balanceOf(ownerAddr);
        uint256 wethBalance = weth.balanceOf(ownerAddr);

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);
        chargeFee[1] = false; // weth is on the watch set

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(
            usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS, "core token goes to the safe address"
        );
        assertEq(weth.balanceOf(quarantine), wethBalance, "watch-set token goes to quarantine in full");
        assertEq(weth.balanceOf(safeAddr), 0, "watch-set token must not reach the safe address");
    }

    /*//////////////////////////////////////////////////////////////
             UPD-3 (23-26): EXECUTOR CHANGE TIMELOCK
    //////////////////////////////////////////////////////////////*/

    function testExecutorChangeTimelock() public {
        address newExecutor = makeAddr("newExecutor");

        vm.prank(ownerAddr);
        vault.requestExecutorChange(newExecutor);
        assertEq(vault.pendingExecutor(), newExecutor);
        assertEq(vault.executorChangeRequestTime(), block.timestamp);

        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY() - 1);

        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: executor change timelock not elapsed");
        vault.confirmExecutorChange();

        assertEq(vault.executor(), executorAddr, "executor must be unchanged before the timelock");
    }

    function testExecutorChangeAfterDelay() public {
        address newExecutor = makeAddr("newExecutor");

        vm.prank(ownerAddr);
        vault.requestExecutorChange(newExecutor);
        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());

        vm.prank(ownerAddr);
        vault.confirmExecutorChange();

        assertEq(vault.executor(), newExecutor);
        assertEq(vault.pendingExecutor(), address(0), "pending entry must be cleared after confirmation");
    }

    function testCancelExecutorChange() public {
        address newExecutor = makeAddr("newExecutor");

        vm.prank(ownerAddr);
        vault.requestExecutorChange(newExecutor);
        vm.prank(ownerAddr);
        vault.cancelExecutorChange();

        assertEq(vault.pendingExecutor(), address(0));
        assertEq(vault.executorChangeRequestTime(), 0);

        vm.warp(block.timestamp + vault.SAFE_CHANGE_DELAY());
        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: no pending executor change");
        vault.confirmExecutorChange();

        assertEq(vault.executor(), executorAddr);
    }

    function testAttackerChangesExecutorButBotStillWorks() public {
        // An attacker with the owner key schedules an executor swap to themselves.
        // The legitimate bot must keep working until the 72h window elapses.
        address attackerExecutor = makeAddr("attackerExecutor");

        vm.prank(ownerAddr);
        vault.requestExecutorChange(attackerExecutor);

        uint256 balanceBefore = usdc.balanceOf(ownerAddr);
        uint256 expectedFee = (balanceBefore * FEE_BPS) / BPS;

        (address[] memory tokens, bool[] memory chargeFee) = _chargeAll(1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vault.rescue(tokens, chargeFee);

        assertEq(
            usdc.balanceOf(safeAddr), balanceBefore - expectedFee, "the real bot still rescues during the timelock"
        );
        assertEq(vault.executor(), executorAddr, "executor must not change before confirmation");
    }
}
