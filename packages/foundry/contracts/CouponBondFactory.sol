// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { CouponBond } from "./CouponBond.sol";

/// @title CouponBondFactory
/// @notice Deploys `CouponBond`s owned by whoever calls `createBond`, forwarding any HBAR sent
/// along so the new bond can pay for its own schedules right away.
contract CouponBondFactory {
    event BondCreated(address indexed issuer, address indexed bond);

    function createBond(
        string calldata bondName,
        address stablecoin,
        uint256 faceValue,
        uint256 couponRateBps,
        uint256 periodSeconds,
        uint256 couponCount
    ) external payable returns (address bond) {
        CouponBond deployed = new CouponBond{ value: msg.value }(
            msg.sender, bondName, stablecoin, faceValue, couponRateBps, periodSeconds, couponCount
        );
        bond = address(deployed);
        emit BondCreated(msg.sender, bond);
    }
}
