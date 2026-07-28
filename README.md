# Vesting Vault — Boilerplate

**Branch:** `boiler-plate`  
**Expected duration:** This is a **4-hour task**  
**Goal:** Complete `VestingVault` and make the test suite meaningfully pass/expand

---

## Quick start

```bash
npm install
npx hardhat test
```

---

## What is already provided
- Hardhat config
- Contract stub: `contracts/VestingVault.sol`
- Skeleton tests: `test/VestingVault.js`

---

## What to implement (required)

### Contract (`contracts/VestingVault.sol`)
- Create vesting schedule (beneficiary, amount, start, duration)
- Linear vesting math
- `release()` for available amount
- Track released vs remaining
- Access control for admin actions
- Events for important state changes

### Tests (`test/VestingVault.js`)
Expand beyond the skeleton to prove:
1. Nothing releasable before start
2. Correct partial unlock mid-way (assert approximate/exact amounts)
3. Full unlock after duration
4. Auth failures
5. No over-release

---

## Design notes to document
- Token model used (IERC20 vs simplified accounting)
- Whether one schedule per beneficiary or many
- Timestamp strategy (`block.timestamp`) and any assumptions

## Acceptance criteria
- [ ] `npx hardhat test` passes for your suite
- [ ] Vesting formulas are explicit and readable
- [ ] README lists commands + assumptions + known gaps

### Your notes
_Add assumptions and remaining work before submit._
