// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AegisEscrow} from "../src/AegisEscrow.sol";

/// @notice Deploys AegisEscrow. Reads UTILITY_ADDRESS and PLATFORM_ADDRESS from the environment.
/// Usage (Base Sepolia, keystore account "deployer"):
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --account deployer --broadcast
contract Deploy is Script {
    function run() external returns (AegisEscrow esc) {
        address utility = vm.envAddress("UTILITY_ADDRESS");
        address platform = vm.envAddress("PLATFORM_ADDRESS");

        vm.startBroadcast();
        esc = new AegisEscrow(utility, platform);
        vm.stopBroadcast();

        console.log("AegisEscrow deployed at", address(esc));
        console.log("Chain id", block.chainid);
    }
}
