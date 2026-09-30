# Vesting Vault: Submission Notes

**Branch used:** `boiler-plate`
**Time spent:** 2 hours

## Install / compile / test

```bash
npm install
npm install @openzeppelin/contracts   
npx hardhat compile
npx hardhat test
```

## Design notes

- **Token model:** a single ERC20 (set at deploy) held in escrow. `createVesting` pulls the full amount from the admin (needs prior `approve`), so every schedule is fully funded from creation. The vault can never owe more than it holds.
- **Many schedules per beneficiary:** schedules live in an array and are addressed by `scheduleId`; one address can have several independent schedules (e.g. different grants or start dates).
- **Vesting formula:** linear, no cliff. `vested = total * (now - start) / duration`, `0` before `start`, `total` at/after `start + duration`. Division rounds down, so the beneficiary never receives more than the exact linear amount. The final release always pays the remainder.
- **Timestamps:** uses `block.timestamp`. Validators can skew it by a few seconds, which is irrelevant at typical vesting durations. `start` may be in the past (pro-rata vested immediately).
- **Access control:** OpenZeppelin `Ownable` for the admin (create + revoke). Only the schedule's beneficiary can call `release`; anyone else reverts with `NotBeneficiary`.
- **Revoke:** sends unvested tokens to the admin, marks the schedule revoked and freezes `total` at the vested amount, so the beneficiary can still claim what had vested. Cannot be revoked twice or once fully vested.
- **Safety:** checks-effects-interactions, `nonReentrant` on all state-changing entry points, `SafeERC20`, custom errors, and a balance-delta check that rejects fee-on-transfer tokens.
- **Events:** `VestingCreated`, `TokensReleased`, `VestingRevoked`, with `scheduleId` and `beneficiary` indexed.

## Known gaps / trade-offs

- No cliff period, and no beneficiary transfer or address rotation. A lost key means lost tokens.
- Revoke is admin-only and unconditional (there is no per-schedule "non-revocable" flag).
- Admin is a single `Ownable` owner; a production setup would use a multisig or timelock and two-step ownership (`Ownable2Step`).
- Fee-on-transfer and rebasing tokens are unsupported (creation reverts).
- Tests cover the core paths; no fuzz or invariant tests yet (e.g. `released <= total` and vault balance ≥ Σ(unreleased)).