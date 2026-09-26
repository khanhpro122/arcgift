// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcGift} from "../src/ArcGift.sol";
import {MockUSDC} from "../test/mocks/Mocks.sol";

/// @notice Local anvil setup for frontend E2E only: a 6-decimal USDC stand-in + ArcGift.
///         Never used for Arc Testnet/Mainnet (those use Deploy.s.sol with real USDC).
contract DeployLocal is Script {
    function run() external {
        require(block.chainid == 31337, "DeployLocal: anvil only");
        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC(); // nonce 0
        ArcGift gift = new ArcGift(IERC20(address(usdc))); // nonce 1
        // anvil default accounts 0-3
        usdc.mint(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, 10_000e6);
        usdc.mint(0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 10_000e6);
        usdc.mint(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 10_000e6);
        usdc.mint(0x90F79bf6EB2c4f870365E785982E1f101E93b906, 10_000e6);
        vm.stopBroadcast();
        console2.log("usdc", address(usdc));
        console2.log("gift", address(gift));
    }
}
