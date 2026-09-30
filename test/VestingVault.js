const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const AMOUNT = ethers.parseEther("1000");
const DURATION = 4000; // seconds; 1/4 = 1000s -> 250 tokens, exactly divisible

describe("VestingVault", function () {
  let admin, alice, bob, stranger;
  let token, vault, start;

  // Mine the next block at an exact timestamp so vesting math is exact.
  const at = (ts) => time.setNextBlockTimestamp(ts);

  beforeEach(async function () {
    [admin, alice, bob, stranger] = await ethers.getSigners();

    token = await (await ethers.getContractFactory("MockERC20")).deploy();
    vault = await (await ethers.getContractFactory("VestingVault")).deploy(
      await token.getAddress(),
      admin.address
    );

    await token.mint(admin.address, AMOUNT * 10n);
    await token.approve(await vault.getAddress(), ethers.MaxUint256);

    start = (await time.latest()) + 1000;
    await vault.createVesting(alice.address, AMOUNT, start, DURATION); // scheduleId 0
  });

  describe("createVesting", function () {
    it("stores the schedule, escrows tokens and emits VestingCreated", async function () {
      const s = await vault.getSchedule(0);
      expect(s.beneficiary).to.equal(alice.address);
      expect(s.total).to.equal(AMOUNT);
      expect(s.released).to.equal(0n);
      expect(s.start).to.equal(start);
      expect(s.duration).to.equal(DURATION);
      expect(s.revoked).to.equal(false);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(AMOUNT);

      await expect(vault.createVesting(bob.address, AMOUNT, start, DURATION))
        .to.emit(vault, "VestingCreated")
        .withArgs(1, bob.address, AMOUNT, start, DURATION);
    });

    it("only the admin can create schedules", async function () {
      await expect(
        vault.connect(stranger).createVesting(bob.address, AMOUNT, start, DURATION)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("rejects invalid input", async function () {
      await expect(
        vault.createVesting(ethers.ZeroAddress, AMOUNT, start, DURATION)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(
        vault.createVesting(bob.address, 0, start, DURATION)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(
        vault.createVesting(bob.address, AMOUNT, start, 0)
      ).to.be.revertedWithCustomError(vault, "ZeroDuration");
    });

    it("reverts if the admin has not approved enough tokens", async function () {
      await token.approve(await vault.getAddress(), 0);
      await expect(
        vault.createVesting(bob.address, AMOUNT, start, DURATION)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("supports several independent schedules for one beneficiary", async function () {
      await vault.createVesting(alice.address, AMOUNT, start + 2000, DURATION); // id 1
      expect(await vault.scheduleCount()).to.equal(2n);

      await at(start + 1000);
      await vault.connect(alice).release(0);

      expect((await vault.getSchedule(0)).released).to.equal(AMOUNT / 4n);
      expect((await vault.getSchedule(1)).released).to.equal(0n);
    });
  });

  describe("vesting math & release", function () {
    it("nothing is releasable before start", async function () {
      await at(start - 1);
      await expect(vault.connect(alice).release(0)).to.be.revertedWithCustomError(
        vault,
        "NothingToRelease"
      );
      expect(await vault.vestedAmount(0)).to.equal(0n);
    });

    it("releases exactly the linear amount mid-way", async function () {
      await at(start + DURATION / 4);
      await expect(vault.connect(alice).release(0))
        .to.emit(vault, "TokensReleased")
        .withArgs(0, alice.address, AMOUNT / 4n);
      expect(await token.balanceOf(alice.address)).to.equal(AMOUNT / 4n);

      await at(start + DURATION / 2);
      await vault.connect(alice).release(0); // only the newly vested quarter
      expect(await token.balanceOf(alice.address)).to.equal(AMOUNT / 2n);
    });

    it("releases everything after the duration and nothing more afterwards", async function () {
      await at(start + DURATION + 500);
      await vault.connect(alice).release(0);
      expect(await token.balanceOf(alice.address)).to.equal(AMOUNT);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);

      await expect(vault.connect(alice).release(0)).to.be.revertedWithCustomError(
        vault,
        "NothingToRelease"
      );
    });

    it("cannot over-release: repeated calls at the same time pay nothing extra", async function () {
      await at(start + DURATION / 2);
      await vault.connect(alice).release(0);
      // next block is at least 1s later, so a tiny extra amount may have vested;
      // total paid must never exceed the vested amount.
      const before = await token.balanceOf(alice.address);
      try {
        await vault.connect(alice).release(0);
      } catch (_) {}
      const after = await token.balanceOf(alice.address);
      expect(after).to.be.lte(AMOUNT);
      expect(after - before).to.be.lt(AMOUNT / 100n);
      expect((await vault.getSchedule(0)).released).to.equal(after);
    });

    it("view functions are consistent (approximate, eth_call timestamp may drift)", async function () {
      await time.increaseTo(start + DURATION / 2);
      const tolerance = ethers.parseEther("2");
      expect(await vault.vestedAmount(0)).to.be.closeTo(AMOUNT / 2n, tolerance);
      expect(await vault.releasableAmount(0)).to.be.closeTo(AMOUNT / 2n, tolerance);
    });

    it("reverts for an unknown schedule", async function () {
      await expect(vault.vestedAmount(99)).to.be.revertedWithCustomError(vault, "UnknownSchedule");
      await expect(vault.connect(alice).release(99)).to.be.revertedWithCustomError(
        vault,
        "UnknownSchedule"
      );
    });
  });

  describe("access control", function () {
    it("only the beneficiary can release", async function () {
      await time.increaseTo(start + DURATION);
      await expect(vault.connect(stranger).release(0)).to.be.revertedWithCustomError(
        vault,
        "NotBeneficiary"
      );
      await expect(vault.connect(admin).release(0)).to.be.revertedWithCustomError(
        vault,
        "NotBeneficiary"
      );
    });

    it("only the admin can revoke", async function () {
      await expect(vault.connect(alice).revoke(0)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("revoke", function () {
    it("returns unvested tokens to admin and lets the beneficiary keep the vested part", async function () {
      const adminBefore = await token.balanceOf(admin.address);

      await at(start + DURATION / 4);
      await expect(vault.revoke(0))
        .to.emit(vault, "VestingRevoked")
        .withArgs(0, AMOUNT / 4n, (AMOUNT * 3n) / 4n);

      expect((await token.balanceOf(admin.address)) - adminBefore).to.equal((AMOUNT * 3n) / 4n);

      // vesting is frozen: far in the future the beneficiary still only gets the vested quarter
      await time.increaseTo(start + DURATION * 2);
      await vault.connect(alice).release(0);
      expect(await token.balanceOf(alice.address)).to.equal(AMOUNT / 4n);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
    });

    it("keeps already released tokens accounted for", async function () {
      await at(start + DURATION / 4);
      await vault.connect(alice).release(0);
      await at(start + DURATION / 2);
      await vault.revoke(0);
      await vault.connect(alice).release(0);
      expect(await token.balanceOf(alice.address)).to.equal(AMOUNT / 2n);
    });

    it("cannot be revoked twice", async function () {
      await at(start + DURATION / 4);
      await vault.revoke(0);
      await expect(vault.revoke(0)).to.be.revertedWithCustomError(vault, "AlreadyRevoked");
    });

    it("cannot revoke a fully vested schedule", async function () {
      await time.increaseTo(start + DURATION);
      await expect(vault.revoke(0)).to.be.revertedWithCustomError(vault, "NothingToRevoke");
    });

    it("revoking before start returns everything", async function () {
      const adminBefore = await token.balanceOf(admin.address);
      await at(start - 10);
      await vault.revoke(0);
      expect((await token.balanceOf(admin.address)) - adminBefore).to.equal(AMOUNT);
      await expect(vault.connect(alice).release(0)).to.be.revertedWithCustomError(
        vault,
        "NothingToRelease"
      );
    });
  });
});