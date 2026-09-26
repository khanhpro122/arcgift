// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ArcGift} from "../src/ArcGift.sol";

/// @notice Deploys ArcGift. Every network value comes from env — nothing is hard-coded.
///
///   EXPECTED_CHAIN_ID  5042002 (Arc Testnet) or 5042 (Arc Mainnet)
///   USDC_ADDRESS       ERC-20 USDC interface from docs.arc.io/arc/references/contract-addresses
///   ALLOW_MAINNET      must be "true" to deploy on chain 5042
///
/// forge script script/Deploy.s.sol --rpc-url arc_testnet --account <keystore> --broadcast
contract Deploy is Script {
    uint256 constant ARC_MAINNET = 5042;

    function run() external returns (ArcGift gift) {
        uint256 expectedChainId = vm.envUint("EXPECTED_CHAIN_ID");
        address usdc = vm.envAddress("USDC_ADDRESS");

        require(block.chainid == expectedChainId, "Deploy: RPC chain id != EXPECTED_CHAIN_ID");
        if (block.chainid == ARC_MAINNET) {
            require(vm.envOr("ALLOW_MAINNET", false), "Deploy: mainnet requires ALLOW_MAINNET=true");
        }

        // Sanity-check the token before trusting it with escrow.
        require(usdc.code.length > 0, "Deploy: USDC_ADDRESS has no code");
        require(IERC20Metadata(usdc).decimals() == 6, "Deploy: USDC ERC-20 must have 6 decimals");
        require(
            keccak256(bytes(IERC20Metadata(usdc).symbol())) == keccak256("USDC"),
            "Deploy: token symbol is not USDC"
        );

        vm.startBroadcast();
        gift = new ArcGift(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("ArcGift deployed:", address(gift));
        console2.log("chainId:", block.chainid);
        console2.log("usdc:", usdc);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "usdc", usdc);
        vm.serializeUint(json, "blockNumber", block.number);
        string memory out = vm.serializeAddress(json, "arcGift", address(gift));
        vm.writeJson(out, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
