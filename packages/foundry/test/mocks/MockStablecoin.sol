// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Mock of an HTS fungible stablecoin as seen through its ERC-20 + HIP-719 facade. Test-only.
contract MockStablecoin is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(uint8 decimals_) ERC20("Mock Stablecoin", "mUSD") {
        _customDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    /// Accounts whose transfers revert, as an HTS token does for an unassociated account.
    mapping(address => bool) public rejecting;
    /// Accounts whose transfers return false rather than reverting.
    mapping(address => bool) public refusing;

    function setRejecting(address account, bool value) external {
        rejecting[account] = value;
    }

    function setRefusing(address account, bool value) external {
        refusing[account] = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (rejecting[to]) revert("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
        if (refusing[to]) return false;
        return super.transfer(to, amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Mimics the token's HIP-719 facade so CouponBond's constructor can associate itself.
    function associate() external pure returns (uint256 responseCode) {
        return 22;
    }

    function dissociate() external pure returns (uint256 responseCode) {
        return 22;
    }

    function isAssociated() external pure returns (bool) {
        return true;
    }
}
