//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { CouponBondFactory } from "../contracts/CouponBondFactory.sol";

/**
 * @notice Deploys only the coupon bond factory.
 * @dev Run with `yarn coupons:deploy`, which signs with the operator key non-interactively and
 * regenerates packages/nextjs/contracts/deployedContracts.ts.
 */
contract DeployCouponFactory is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        CouponBondFactory factory = new CouponBondFactory();
        deployments.push(Deployment({ name: "CouponBondFactory", addr: address(factory) }));
    }
}
