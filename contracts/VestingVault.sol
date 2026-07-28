// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * TODO (candidate): implement a linear token vesting vault.
 *
 * Suggested interface:
 * - createVesting(address beneficiary, uint256 amount, uint64 start, uint64 duration)
 * - release(uint256 scheduleId)
 * - vestedAmount(uint256 scheduleId) view returns (uint256)
 *
 * For simplicity, vault can hold native ETH instead of ERC20 if easier.
 */
contract VestingVault {
    // implement storage + functions
}
