// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VestingVault
 * @notice Holds one ERC20 and vests it linearly to beneficiaries.
 *
 *  - The admin (owner) creates schedules and funds each one up front.
 *  - Tokens unlock linearly from `start` to `start + duration` (no cliff).
 *  - Only the beneficiary can release vested tokens.
 *  - The admin can revoke a schedule: unvested tokens go back to the admin,
 *    tokens already vested stay claimable by the beneficiary.
 *
 * Vesting formula (block.timestamp = t):
 *   t <= start                  -> 0
 *   t >= start + duration       -> total
 *   otherwise                   -> total * (t - start) / duration   (rounds down)
 * releasable = vested - released
 */
contract VestingVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Schedule {
        address beneficiary;
        uint64 start;
        uint64 duration;
        bool revoked;
        uint256 total; // total amount that will ever vest (reduced to vested amount on revoke)
        uint256 released; // amount already paid to the beneficiary
    }

    IERC20 public immutable token;
    Schedule[] private _schedules;

    event VestingCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount,
        uint64 start,
        uint64 duration
    );
    event TokensReleased(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event VestingRevoked(uint256 indexed scheduleId, uint256 vestedAtRevoke, uint256 unvestedReturned);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDuration();
    error UnknownSchedule();
    error NotBeneficiary();
    error NothingToRelease();
    error AlreadyRevoked();
    error NothingToRevoke();
    error UnexpectedTransferAmount();

    constructor(IERC20 token_, address admin) Ownable(admin) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ---------------------------------------------------------------------
    // Admin actions
    // ---------------------------------------------------------------------

    /// @notice Create a schedule and pull `amount` tokens from the admin (requires prior approval).
    /// @dev `start` may be in the past (tokens vest immediately pro-rata).
    function createVesting(
        address beneficiary,
        uint256 amount,
        uint64 start,
        uint64 duration
    ) external onlyOwner nonReentrant returns (uint256 scheduleId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (duration == 0) revert ZeroDuration();

        scheduleId = _schedules.length;
        _schedules.push(
            Schedule({
                beneficiary: beneficiary,
                start: start,
                duration: duration,
                revoked: false,
                total: amount,
                released: 0
            })
        );

        // Fee-on-transfer / rebasing tokens would break accounting, so reject them.
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert UnexpectedTransferAmount();

        emit VestingCreated(scheduleId, beneficiary, amount, start, duration);
    }

    /// @notice Stop vesting. Unvested tokens return to the admin; vested-but-unreleased
    ///         tokens remain claimable by the beneficiary.
    function revoke(uint256 scheduleId) external onlyOwner nonReentrant {
        Schedule storage s = _get(scheduleId);
        if (s.revoked) revert AlreadyRevoked();

        uint256 vested = _vested(s);
        uint256 unvested = s.total - vested;
        if (unvested == 0) revert NothingToRevoke();

        // Effects before interaction.
        s.revoked = true;
        s.total = vested; // freeze: everything that remains is now fully vested

        token.safeTransfer(msg.sender, unvested);
        emit VestingRevoked(scheduleId, vested, unvested);
    }

    // ---------------------------------------------------------------------
    // Beneficiary actions
    // ---------------------------------------------------------------------

    /// @notice Send all currently vested, unreleased tokens to the beneficiary.
    function release(uint256 scheduleId) external nonReentrant {
        Schedule storage s = _get(scheduleId);
        if (msg.sender != s.beneficiary) revert NotBeneficiary();

        uint256 amount = _vested(s) - s.released;
        if (amount == 0) revert NothingToRelease();

        s.released += amount; // effects before interaction
        token.safeTransfer(s.beneficiary, amount);
        emit TokensReleased(scheduleId, s.beneficiary, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function getSchedule(uint256 scheduleId) external view returns (Schedule memory) {
        return _get(scheduleId);
    }

    /// @notice Total amount vested so far (released or not).
    function vestedAmount(uint256 scheduleId) external view returns (uint256) {
        return _vested(_get(scheduleId));
    }

    /// @notice Amount the beneficiary could release right now.
    function releasableAmount(uint256 scheduleId) external view returns (uint256) {
        Schedule storage s = _get(scheduleId);
        return _vested(s) - s.released;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _get(uint256 scheduleId) private view returns (Schedule storage) {
        if (scheduleId >= _schedules.length) revert UnknownSchedule();
        return _schedules[scheduleId];
    }

    function _vested(Schedule storage s) private view returns (uint256) {
        if (s.revoked) return s.total; // frozen at revoke time

        uint256 start = s.start;
        if (block.timestamp <= start) return 0;

        uint256 elapsed = block.timestamp - start;
        if (elapsed >= s.duration) return s.total;

        return (s.total * elapsed) / s.duration;
    }
}