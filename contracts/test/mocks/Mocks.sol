// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mirrors the Arc USDC ERC-20 interface: 6 decimals.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Takes a 1% fee on every transfer — deposit must be rejected.
contract FeeToken is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xFEE), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

interface IReenter {
    function reenter() external;
}

/// @dev Calls back into an attacker on every transfer to probe reentrancy.
contract HookToken is MockUSDC {
    address public hook;

    function setHook(address h) external {
        hook = h;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hook != address(0) && to == hook) IReenter(hook).reenter();
    }
}
