// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { CouponBond } from "../contracts/CouponBond.sol";
import { CouponBondFactory } from "../contracts/CouponBondFactory.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";
import { MockStablecoin } from "./mocks/MockStablecoin.sol";

contract CouponBondTest is Test {
    address internal constant HSS_ADDR = address(uint160(0x16b));

    address internal issuer = makeAddr("issuer");
    address internal investorA = makeAddr("investorA");
    address internal investorB = makeAddr("investorB");

    MockStablecoin internal token;
    MockHederaScheduleService internal hss;

    uint256 internal constant FACE_VALUE = 1000;
    uint256 internal constant COUPON_RATE_BPS = 100; // 1%
    uint256 internal constant PERIOD = 60;
    uint256 internal constant COUPON_COUNT = 2;
    uint8 internal constant DECIMALS = 6;
    uint256 internal constant SCALE = 10 ** DECIMALS;

    function setUp() public {
        MockHederaScheduleService impl = new MockHederaScheduleService();
        vm.etch(HSS_ADDR, address(impl).code);
        hss = MockHederaScheduleService(HSS_ADDR);
        hss.setHasCapacity(true);
        hss.setScheduleResponseCode(22);
        hss.setDeleteResponseCode(22);

        token = new MockStablecoin(DECIMALS);
    }

    function _newBond() internal returns (CouponBond bond) {
        vm.prank(issuer);
        bond = new CouponBond(issuer, "Acme Coupon Bond", address(token), FACE_VALUE, COUPON_RATE_BPS, PERIOD, COUPON_COUNT);
    }

    function _allocateBoth(CouponBond bond, uint256 unitsA, uint256 unitsB) internal {
        vm.startPrank(issuer);
        bond.allocate(investorA, unitsA);
        bond.allocate(investorB, unitsB);
        vm.stopPrank();
    }

    function _fund(CouponBond bond, uint256 wholeTokens) internal {
        token.mint(address(bond), wholeTokens * SCALE);
    }

    function _start(CouponBond bond) internal {
        vm.prank(issuer);
        bond.start();
    }

    // --- paying and rescheduling ---

    function test_PaysCouponAndSchedulesNext() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        // 2 coupons + principal: (10+5)*1000*0.01*2 + (10+5)*1000 = 300 + 15000 = 15300
        _fund(bond, 15300);
        _start(bond);

        uint256 due = bond.dueTime();
        assertEq(due, block.timestamp + PERIOD);
        address firstSchedule = bond.currentSchedule();
        assertTrue(firstSchedule != address(0));

        vm.warp(due);
        bond.payCoupon();

        assertEq(token.balanceOf(investorA), 100 * SCALE);
        assertEq(token.balanceOf(investorB), 50 * SCALE);
        assertEq(bond.currentCoupon(), 2);
        assertEq(bond.dueTime(), due + PERIOD);
        assertTrue(bond.currentSchedule() != address(0));
        assertTrue(bond.currentSchedule() != firstSchedule);
        assertEq(uint256(bond.status()), uint256(CouponBond.Status.RUNNING));
    }

    // --- due-time guard ---

    function test_PayCouponRevertsBeforeDue() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        vm.expectRevert(CouponBond.NotDue.selector);
        bond.payCoupon();
    }

    function test_PayCouponRevertsBeforeStart() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);

        vm.expectRevert(CouponBond.NotRunning.selector);
        bond.payCoupon();
    }

    function test_CouponNeverPaysTwice() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        vm.warp(bond.dueTime());
        bond.payCoupon();

        vm.expectRevert(CouponBond.NotDue.selector);
        bond.payCoupon();
    }

    // --- missed coupon and retry ---

    function test_MissedCouponRetriesOnePeriodLater() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 0);
        // Fund nothing: coupon 1 needs 10*1000*0.01 = 100 whole tokens.
        _start(bond);

        uint256 due = bond.dueTime();
        vm.warp(due);
        bond.payCoupon();

        assertEq(bond.currentCoupon(), 1, "missed coupon is retried, not advanced");
        assertEq(token.balanceOf(investorA), 0);
        assertEq(bond.dueTime(), due + PERIOD);

        // Fund before the retry: it now pays in full.
        _fund(bond, 100);
        vm.warp(bond.dueTime());
        bond.payCoupon();

        assertEq(token.balanceOf(investorA), 100 * SCALE);
        assertEq(bond.currentCoupon(), 2);
    }

    // --- maturity ---

    function test_MaturityPaysPrincipalAndSchedulesNothing() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        vm.warp(bond.dueTime());
        bond.payCoupon(); // coupon 1

        vm.warp(bond.dueTime());
        bond.payCoupon(); // coupon 2: last, pays coupon + principal

        assertEq(token.balanceOf(investorA), 100 * SCALE + 100 * SCALE + 10000 * SCALE);
        assertEq(token.balanceOf(investorB), 50 * SCALE + 50 * SCALE + 5000 * SCALE);
        assertEq(uint256(bond.status()), uint256(CouponBond.Status.MATURED));
        assertEq(bond.currentSchedule(), address(0));

        vm.expectRevert(CouponBond.NotRunning.selector);
        bond.payCoupon();
    }

    function test_StablecoinNeededIsZeroAfterMaturity() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        vm.warp(bond.dueTime());
        bond.payCoupon();
        vm.warp(bond.dueTime());
        bond.payCoupon();

        assertEq(uint256(bond.status()), uint256(CouponBond.Status.MATURED));
        assertEq(bond.stablecoinNeeded(), 0, "nothing more is ever owed once matured");
    }

    // --- stopping ---

    function test_StopCancelsPendingScheduleAndBlocksFurtherCoupons() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        address scheduled = bond.currentSchedule();
        assertTrue(scheduled != address(0));

        vm.prank(issuer);
        bond.stop();

        assertEq(uint256(bond.status()), uint256(CouponBond.Status.STOPPED));
        assertEq(bond.currentSchedule(), address(0));
        assertEq(hss.lastDeletedSchedule(), scheduled);

        vm.warp(block.timestamp + PERIOD * 2);
        vm.expectRevert(CouponBond.NotRunning.selector);
        bond.payCoupon();

        assertEq(token.balanceOf(investorA), 0);
        assertEq(token.balanceOf(investorB), 0);
    }

    function test_StopRevertsWhenNotRunning() public {
        CouponBond bond = _newBond();
        vm.prank(issuer);
        vm.expectRevert(CouponBond.NotRunning.selector);
        bond.stop();
    }

    // --- capacity fallback ---

    function test_CapacityFallbackEmitsEventButPayNowStillWorks() public {
        hss.setHasCapacity(false);

        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);

        vm.recordLogs();
        _start(bond);
        assertEq(bond.currentSchedule(), address(0), "no capacity anywhere: nothing got scheduled");

        uint256 due = bond.dueTime();
        assertEq(due, block.timestamp + PERIOD);

        vm.warp(due);
        // Nothing was scheduled, but #pay-now (anyone calling payCoupon directly) still works.
        bond.payCoupon();

        assertEq(token.balanceOf(investorA), 100 * SCALE);
        assertEq(token.balanceOf(investorB), 50 * SCALE);
        assertEq(bond.currentCoupon(), 2);
    }

    function test_CapacityRestoredAllowsScheduling() public {
        hss.setHasCapacity(false);
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 0);
        _fund(bond, 15300);
        _start(bond);
        assertEq(bond.currentSchedule(), address(0));

        hss.setHasCapacity(true);
        vm.warp(bond.dueTime());
        bond.payCoupon();

        assertTrue(bond.currentSchedule() != address(0), "capacity is back: next coupon gets scheduled");
    }

    // --- factory ---

    function test_FactoryCreatesBondOwnedByCallerAndForwardsHbar() public {
        CouponBondFactory factory = new CouponBondFactory();
        vm.deal(issuer, 10 ether);

        vm.prank(issuer);
        address bondAddr = factory.createBond{ value: 1 ether }(
            "Acme Coupon Bond", address(token), FACE_VALUE, COUPON_RATE_BPS, PERIOD, COUPON_COUNT
        );

        CouponBond bond = CouponBond(payable(bondAddr));
        assertEq(bond.owner(), issuer);
        assertEq(bondAddr.balance, 1 ether);
    }

    /**
     * The failure this exists for. A holder who has not associated the token cannot be sent
     * it, and the transfer reverts. Reverting the whole coupon took the bond with it: the
     * scheduled call failed, nothing rescheduled it, `payCoupon` reverted from then on, and
     * every other holder's money stayed in the contract with no way out.
     */
    function test_HolderWhoCannotReceiveDoesNotStopTheBond() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        token.setRejecting(investorB, true);

        uint256 due = bond.dueTime();
        vm.warp(due);
        bond.payCoupon();

        assertEq(token.balanceOf(investorA), 100 * SCALE, "the holder who can receive is paid");
        assertEq(token.balanceOf(investorB), 0, "the one who cannot is not");
        assertEq(bond.unpaidOf(investorB), 50 * SCALE, "and is owed it instead");
        assertEq(bond.totalUnpaid(), 50 * SCALE);

        assertEq(bond.currentCoupon(), 2, "the coupon still advances");
        assertEq(bond.dueTime(), due + PERIOD, "and the next one is still scheduled");
        assertTrue(bond.currentSchedule() != address(0));
    }

    /** A transfer that returns false rather than reverting is the same answer: not paid. */
    function test_ATransferThatReturnsFalseIsAlsoRecorded() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        token.setRefusing(investorB, true);
        vm.warp(bond.dueTime());
        bond.payCoupon();

        assertEq(bond.unpaidOf(investorB), 50 * SCALE);
        assertEq(bond.currentCoupon(), 2);
    }

    function test_UnpaidCouponIsClaimableOnceTheHolderCanReceive() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        token.setRejecting(investorB, true);
        vm.warp(bond.dueTime());
        bond.payCoupon();

        // Still owed while the holder cannot receive, and the claim says so rather than
        // quietly succeeding.
        vm.expectRevert();
        bond.claimFor(investorB);

        token.setRejecting(investorB, false);
        bond.claimFor(investorB);

        assertEq(token.balanceOf(investorB), 50 * SCALE, "paid on the claim");
        assertEq(bond.unpaidOf(investorB), 0);
        assertEq(bond.totalUnpaid(), 0);

        vm.expectRevert(CouponBond.NothingToClaim.selector);
        bond.claimFor(investorB);
    }

    /**
     * A missed coupon is retried one period after it was *due*. Retrying one period after the
     * attempt drifts every later coupon by however late the attempt was, and a bond's coupon
     * dates are not negotiable. Warps past the due time, which is the only way to tell the
     * two apart.
     */
    function test_MissedCouponKeepsTheOriginalCadence() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 0);
        _start(bond);

        uint256 due = bond.dueTime();
        vm.warp(due + 37); // the schedule fired late, or pay-now was pressed late
        bond.payCoupon();

        assertEq(bond.currentCoupon(), 1, "still the same coupon");
        assertEq(bond.dueTime(), due + PERIOD, "the cadence is kept, not restarted from now");
    }

    /** What is owed is still owed after maturity, and funding guidance has to include it. */
    function test_StablecoinNeededIncludesWhatCouldNotBePaid() public {
        CouponBond bond = _newBond();
        _allocateBoth(bond, 10, 5);
        _fund(bond, 15300);
        _start(bond);

        token.setRejecting(investorB, true);
        vm.warp(bond.dueTime());
        bond.payCoupon();
        vm.warp(bond.dueTime());
        bond.payCoupon(); // last coupon plus principal; B still cannot receive

        assertEq(uint256(bond.status()), uint256(CouponBond.Status.MATURED));
        assertEq(bond.stablecoinNeeded(), bond.totalUnpaid(), "matured, but still owed");
        assertGt(bond.totalUnpaid(), 0);
    }
}
