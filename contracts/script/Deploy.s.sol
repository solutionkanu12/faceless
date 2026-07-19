// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

import {Script, console} from "forge-std/Script.sol";
import {Groth16Verifier} from "../Verifier.sol";

contract Deploy is Script {
    function run() external returns (Groth16Verifier) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        Groth16Verifier verifier = new Groth16Verifier();
        vm.stopBroadcast();

        console.log("Verifier deployed at:", address(verifier));
        return verifier;
    }
}
