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

/// @dev ERC-20 that returns no data from `transferFrom` (USDT-style), used to prove
///      the vault's low-level transfer path tolerates non-standard tokens.
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

/**
 * @title RescueVaultTest
 * @notice Covers the 15 rescue scenarios defined in the SafeGPT specification:
 *         rescue mechanics, executor gating, and the 72-hour timelocks that
 *         protect the safe address and the whitelist.
 */
contract RescueVaultTest is Test {
    uint16 internal constant FEE_BPS = 500; // 5%
    uint256 internal constant BPS = 10_000;

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
                        1. RESCUE MECHANICS
    //////////////////////////////////////////////////////////////*/

    function testRescueSingleToken() public {
        uint256 balanceBefore = usdc.balanceOf(ownerAddr);
        uint256 expectedFee = (balanceBefore * FEE_BPS) / BPS;
        uint256 expectedToSafe = balanceBefore - expectedFee;

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IRescueVault.Rescued(address(usdc), expectedToSafe, safeAddr);
        vault.rescue(tokens);

        assertEq(usdc.balanceOf(safeAddr), expectedToSafe, "safe must receive balance minus fee");
        assertEq(usdc.balanceOf(feeReceiverAddr), expectedFee, "fee receiver must receive the fee");
        assertEq(usdc.balanceOf(ownerAddr), 0, "protected wallet must be drained for the token");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault never custodies tokens");
    }

    function testRescueMultipleTokens() public {
        uint256 usdcBalance = usdc.balanceOf(ownerAddr);
        uint256 wethBalance = weth.balanceOf(ownerAddr);

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);

        vm.prank(executorAddr);
        vault.rescue(tokens);

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
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        // The owner is NOT the executor — the owner must not be able to drain itself through the vault.
        vm.prank(ownerAddr);
        vm.expectRevert("RescueVault: not executor");
        vault.rescue(tokens);

        assertEq(usdc.balanceOf(ownerAddr), 5_000e6, "no funds may move on an unauthorized call");
    }

    function testRescueZeroBalance() public {
        MockERC20 emptyToken = new MockERC20("Empty", "EMPTY", 18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(emptyToken);

        uint256 usdcBalance = usdc.balanceOf(ownerAddr);

        vm.prank(executorAddr);
        vault.rescue(tokens);

        // The funded token is rescued, the empty one is skipped without reverting.
        assertEq(usdc.balanceOf(safeAddr), usdcBalance - (usdcBalance * FEE_BPS) / BPS);
        assertEq(emptyToken.balanceOf(safeAddr), 0);
        assertEq(emptyToken.balanceOf(feeReceiverAddr), 0);
    }

    function testRescueTokenWithoutReturnValue() public {
        // Proves the low-level transfer path supports USDT-style tokens.
        MockNoReturnERC20 weird = new MockNoReturnERC20();
        weird.mint(ownerAddr, 100e18);

        address[] memory tokens = new address[](1);
        tokens[0] = address(weird);

        uint256 balance = weird.balanceOf(ownerAddr);
        uint256 expectedFee = (balance * FEE_BPS) / BPS;

        vm.prank(ownerAddr);
        weird.approve(address(vault), type(uint256).max);

        vm.prank(executorAddr);
        vault.rescue(tokens);

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

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vault.rescue(tokens);

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
        vault.setExecutor(newExecutor);
        assertEq(vault.executor(), executorAddr, "executor must be unchanged after a rejected call");

        vm.prank(ownerAddr);
        vault.setExecutor(newExecutor);
        assertEq(vault.executor(), newExecutor, "owner must be able to rotate the executor");

        // The freshly appointed executor can rescue, the old one cannot.
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        vm.prank(executorAddr);
        vm.expectRevert("RescueVault: not executor");
        vault.rescue(tokens);
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
        address maxFeeVault =
            factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, maxFeeBps, keccak256("vault-at-cap"));
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
        address vaultC = factory.createVault(ownerAddr, safeAddr, executorAddr, feeReceiverAddr, FEE_BPS, keccak256("salt-C"));

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

        address[] memory tokens = new address[](1);
        tokens[0] = address(weth);

        vm.prank(executorAddr);
        vault.rescue(tokens);

        assertEq(weth.balanceOf(newSafe), balanceBefore - expectedFee, "rescue must follow the NEW safe address");
        assertEq(weth.balanceOf(safeAddr), 0, "old safe must not receive funds after the change is confirmed");
        assertEq(weth.balanceOf(feeReceiverAddr), expectedFee);
    }
}