import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { getBigNumber, duration, ADDRESS_ZERO, latest, increase } from "./utilities";

import TokenSaleArtifact from "../artifacts/contracts/TokenSale.sol/TokenSale.json";
import ERC20MockArtifact from "../artifacts/contracts/mocks/ERC20Mock.sol/ERC20Mock.json";
import TetherMockArtifact from "../artifacts/contracts/mocks/TetherToken.sol/TetherToken.json";

import { TokenSale, ERC20Mock, TetherToken } from "../typechain";
import { Wallet, BigNumber } from "ethers";

const { provider, deployContract } = waffle;

describe("TokenSale", () => {
  const [deployer, alice, bob, owner, newOwner, beneficiary] = provider.getWallets() as Wallet[];

  let tokenSale: TokenSale;
  let usdt: TetherToken;
  let dai: ERC20Mock;

  let stableCoinsAddresses: Array<string>;

  const USDC_ADDRESS: string = "0x0D9C8723B343A8368BebE0B5E89273fF8D712e3C";

  const two_days: number = duration.days(2);

  async function makeSUT(
    owner: string = deployer.address,
    _beneficiary: string = beneficiary.address,
    min: number = 20000,
    max: number = 50000,
    cap: number = 20000000,
    start: number = 0,
    duration: number = two_days
  ): Promise<TokenSale> {
    if (start == 0) {
      start = await latest();
    }

    return (await deployContract(deployer, TokenSaleArtifact, [
      owner,
      _beneficiary,
      min,
      max,
      cap,
      start,
      duration,
      stableCoinsAddresses,
    ])) as TokenSale;
  }

  before(async () => {
    usdt = (await deployContract(deployer, TetherMockArtifact, [getBigNumber(1000000, 6), "Tether Mock", "USDT", 6])) as TetherToken;
    dai = (await deployContract(deployer, ERC20MockArtifact, ["Dai Mock", "DAI", 18, getBigNumber(1000000)])) as ERC20Mock;

    stableCoinsAddresses = [usdt.address, dai.address];
  });

  describe("Constructor ", () => {
    it("should revert if owner is zero address", async () => {
      await expect(makeSUT(ADDRESS_ZERO)).to.be.revertedWith("Ownable: zero address");
    });

    it("should revert if beneficiary is zero address", async () => {
      await expect(makeSUT(undefined, ADDRESS_ZERO)).to.be.revertedWith("TokenSale: zero address");
    });

    it("should revert if cap is set to 0", async () => {
      await expect(makeSUT(undefined, undefined, undefined, undefined, 0)).to.be.revertedWith("TokenSale: Cap is 0");
    });

    it("should revert if duration is set to 0", async () => {
      await expect(makeSUT(undefined, undefined, undefined, undefined, undefined, undefined, 0)).to.be.revertedWith("TokenSale: Duration is 0");
    });

    it("should revert if end time is before current block.timestamp", async () => {
      const five_days_ago = ((await latest()) as BigNumber).sub(duration.days(5)).toNumber();
      await expect(makeSUT(undefined, undefined, undefined, undefined, undefined, five_days_ago)).to.be.revertedWith(
        "TokenSale: Final time is before current time"
      );
    });
  });

  describe("Modifiers", () => {
    beforeEach(async () => {
      tokenSale = await makeSUT();
    });

    describe("onlyWhitelisted", () => {
      it("should revert when account is not whitelisted and whitelistOnly is active", async () => {
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");
      });

      it("should revert when whitelistOnly is active and account was whitelisted for ended round", async () => {
        await tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        expect(await tokenSale.whitelistRound()).to.be.equal(1);
        expect(await tokenSale.isWhitelisted(alice.address)).to.be.equal(true);

        await tokenSale.setWhitelistRound(2);

        // when account is not whitelisted he will face whitelisted restriction
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");
      });

      it("should pass when account is whitelisted for current round and whitelistOnly is active", async () => {
        await tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        expect(await tokenSale.whitelistRound()).to.be.equal(1);
        expect(await tokenSale.isWhitelisted(alice.address)).to.be.equal(true);

        // when account is whitelisted he will face next restriction amount > 0
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
        // when account is not whitelisted he will face whitelisted restriction
        await expect(tokenSale.connect(bob).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");

        expect(await tokenSale.whitelistRound()).to.be.equal(1);
        expect(await tokenSale.isWhitelisted(alice.address)).to.be.equal(true);

        await expect(tokenSale.connect(deployer).setWhitelistRound(2)).to.emit(tokenSale, "WhitelistRoundChanged").withArgs(2);
        await tokenSale.connect(deployer).addWhitelistedAddresses([bob.address]);

        // when account is whitelisted he will face next restriction amount > 0
        await expect(tokenSale.connect(bob).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
        // when account is not whitelisted he will face whitelisted restriction
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");
      });

      it("should pass when whitelistOnly is inactive", async () => {
        await expect(tokenSale.connect(deployer).setWhitelistedOnly(false)).to.emit(tokenSale, "WhitelistChanged").withArgs(false);
        // when whitelistOnly is inactive account will face next restriction amount > 0
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
        // when whitelistOnly is inactive account will face next restriction amount > 0
        await expect(tokenSale.connect(bob).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
      });
    });

    describe("isOngoing", () => {
      it("should revert when sale is ended by admin after cap is reached", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, 50000);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(500));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));
        await _tokenSale.connect(alice).buyWith(dai.address, 50000);

        expect(await _tokenSale.isLive()).to.be.equal(true);
        await _tokenSale.connect(deployer).endPresale();
        expect(await _tokenSale.isLive()).to.be.equal(false);

        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Sale is not active");
      });

      it("should revert when sale is not in its time range", async () => {
        const two_days_from_now = ((await latest()) as BigNumber).add(duration.days(2)).toNumber();
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, undefined, two_days_from_now);

        // sale will start in 2 days
        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Sale is not active");

        // sale is ongoing and account faces next restriction whitelist
        await increase(duration.days(3));
        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");

        // sale ended 2 days ago
        await increase(duration.days(3));
        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Sale is not active");
      });

      it("should pass when sale is in its time range and was not ended by the admin", async () => {
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Account is not whitelisted");
      });
    });

    describe("onlyOwner", () => {
      it("should revert if restricted function's caller is not owner", async () => {
        await expect(tokenSale.connect(alice).endPresale()).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(tokenSale.connect(alice).recoverErc20(usdt.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(tokenSale.connect(alice).recoverEth()).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(tokenSale.connect(alice).transferOwnership(newOwner.address, false)).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(tokenSale.connect(alice).setWhitelistedOnly(false)).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(tokenSale.connect(alice).addWhitelistedAddresses([alice.address])).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("onlyBeneficiary", () => {
      it("should revert if restricted function's caller is not beneficiary", async () => {
        await expect(tokenSale.connect(alice).withdrawFunds()).to.be.revertedWith("TokenSale: Caller is not the beneficiary");
      });
    });

    describe("isEnded", () => {
      it("should revert if block.timestamp is lower then end time or not ended by the admin when cap is reached", async () => {
        await expect(tokenSale.connect(beneficiary).withdrawFunds()).to.be.revertedWith("TokenSale: Not ended");
        await expect(tokenSale.connect(deployer).recoverEth()).to.be.revertedWith("TokenSale: Not ended");
      });

      it("should pass when block.timestamp is higher then end time", async () => {
        await increase(duration.days(3));
        await tokenSale.connect(beneficiary).withdrawFunds();
        await tokenSale.connect(deployer).recoverEth();

        expect(await usdt.balanceOf(tokenSale.address)).to.be.equal(0);
      });

      it("should pass when ended by the admin and when cap is reached", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, 50000);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address, bob.address]);

        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(500));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));
        await _tokenSale.connect(alice).buyWith(dai.address, 50000);

        expect(await _tokenSale.isLive()).to.be.equal(true);
        await _tokenSale.connect(deployer).endPresale();

        await _tokenSale.connect(beneficiary).withdrawFunds();
        await _tokenSale.connect(deployer).recoverEth();

        expect(await dai.balanceOf(_tokenSale.address)).to.be.equal(0);
        expect(await ethers.provider.getBalance(_tokenSale.address)).to.be.equal(0);
      });
    });
  });

  describe("Setters", () => {
    describe("buyWith", () => {
      beforeEach(async () => {
        tokenSale = await makeSUT();

        await tokenSale.connect(deployer).addWhitelistedAddresses([alice.address, bob.address]);

        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(0));
        await dai.connect(alice).approve(tokenSale.address, getBigNumber(0));

        await usdt.connect(bob).approve(tokenSale.address, getBigNumber(0));
        await dai.connect(bob).approve(tokenSale.address, getBigNumber(0));
      });

      it("should revert if min amount sent is not sufficient", async () => {
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 15000)).to.be.revertedWith("TokenSale: Amount too low");
      });

      it("should revert if max amount sent is to big", async () => {
        await expect(tokenSale.connect(alice).buyWith(dai.address, 55000)).to.be.revertedWith("TokenSale: Amount too high");
      });

      it("should revert if stable coin is not supported", async () => {
        await expect(tokenSale.connect(alice).buyWith(USDC_ADDRESS, 25000)).to.be.revertedWith("TokenSale: Stable coin not supported");
      });

      it("should revert if amount is zero", async () => {
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
      });

      it("should revert if allowance is to low", async () => {
        await expect(tokenSale.connect(alice).buyWith(usdt.address, 40000)).to.be.revertedWith("TokenSale: Insufficient stable coin allowance");
      });

      it("should revert if safeTransferFrom failed", async () => {
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(400, 6));

        await expect(tokenSale.connect(alice).buyWith(usdt.address, 40000)).to.be.revertedWith("SafeERC20: TransferFrom failed");
      });

      it("should revert if remaining balance is not sufficient", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, 80000);

        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address, bob.address]);

        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(500));
        await dai.connect(bob).approve(_tokenSale.address, getBigNumber(350));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));

        await _tokenSale.connect(alice).buyWith(dai.address, 50000);

        await expect(_tokenSale.connect(bob).buyWith(dai.address, 35000)).to.be.revertedWith("TokenSale: Insufficient remaining amount");
      });

      it("should buy correctly if stable coin and amount is right", async () => {
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await dai.connect(alice).approve(tokenSale.address, getBigNumber(150));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));

        await expect(tokenSale.connect(alice).buyWith(usdt.address, 35000)).to.emit(tokenSale, "Purchased").withArgs(alice.address, 35000);

        let accountBalance = await tokenSale.balances(alice.address);
        let remainingAllocation = await tokenSale.remainingAllocation(alice.address);

        expect(accountBalance).to.equal(35000);
        expect(remainingAllocation).to.equal(15000);

        await expect(tokenSale.connect(alice).buyWith(dai.address, 15000)).to.emit(tokenSale, "Purchased").withArgs(alice.address, 15000);

        accountBalance = await tokenSale.balances(alice.address);
        remainingAllocation = await tokenSale.remainingAllocation(alice.address);

        expect(accountBalance).to.equal(50000);
        expect(remainingAllocation).to.equal(0);
      });

      it("should buy correctly when min and max limits are not set", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, 0, 0);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address, bob.address]);
        await usdt.connect(alice).approve(_tokenSale.address, getBigNumber(3500, 6));
        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(1500));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(3500, 6));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(1500));

        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 0)).to.be.revertedWith("TokenSale: Amount is 0");
        await expect(_tokenSale.connect(alice).buyWith(usdt.address, 100)).to.emit(_tokenSale, "Purchased").withArgs(alice.address, 100);

        let accountBalance = await _tokenSale.balances(alice.address);
        let remainingAllocation = await _tokenSale.remainingAllocation(alice.address);

        expect(accountBalance).to.equal(100);
        expect(remainingAllocation).to.equal(19999900);

        await expect(_tokenSale.connect(alice).buyWith(dai.address, 150000)).to.emit(_tokenSale, "Purchased").withArgs(alice.address, 150000);

        accountBalance = await _tokenSale.balances(alice.address);
        remainingAllocation = await _tokenSale.remainingAllocation(alice.address);

        expect(accountBalance).to.equal(150100);
        expect(remainingAllocation).to.equal(19849900);
      });
    });

    describe("endPresale", () => {
      it("it should revert if collected amount don't reach the cap limit", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, 550000);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(500));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));
        await _tokenSale.connect(alice).buyWith(dai.address, 50000);

        await expect(_tokenSale.connect(deployer).endPresale()).to.be.revertedWith("TokenSale: Limit not reached");
      });

      it("it can be ended when the cap limit is reached", async () => {
        const _tokenSale = await makeSUT(undefined, undefined, undefined, undefined, 50000);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(500));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));
        await _tokenSale.connect(alice).buyWith(dai.address, 50000);

        expect(await _tokenSale.isLive()).to.be.equal(true);
        await _tokenSale.connect(deployer).endPresale();
        expect(await _tokenSale.isLive()).to.be.equal(false);
      });
    });

    describe("withdrawFunds", () => {
      it("it should correctly withdraw founds", async () => {
        const _tokenSale = await makeSUT(owner.address, undefined, undefined, undefined, 50000);
        await _tokenSale.connect(owner).addWhitelistedAddresses([alice.address]);

        await usdt.connect(alice).approve(_tokenSale.address, getBigNumber(350, 6));
        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(150));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));

        await _tokenSale.connect(alice).buyWith(usdt.address, 35000);

        let accountBalance = await _tokenSale.balances(alice.address);
        let remainingAllocation = await _tokenSale.remainingAllocation(alice.address);
        expect(accountBalance).to.equal(35000);
        expect(remainingAllocation).to.equal(15000);

        await _tokenSale.connect(alice).buyWith(dai.address, 15000);

        accountBalance = await _tokenSale.balances(alice.address);
        remainingAllocation = await _tokenSale.remainingAllocation(alice.address);
        expect(accountBalance).to.equal(50000);
        expect(remainingAllocation).to.equal(0);

        await _tokenSale.connect(owner).endPresale();
        expect(await _tokenSale.isLive()).to.be.equal(false);

        const beneficiaryUsdtBalanceBefore = await usdt.balanceOf(beneficiary.address);
        const beneficiaryDaiBalanceBefore = await dai.balanceOf(beneficiary.address);

        await _tokenSale.connect(beneficiary).withdrawFunds();

        const beneficiaryUsdtBalance = await usdt.balanceOf(beneficiary.address);
        const beneficiaryDaiBalance = await dai.balanceOf(beneficiary.address);
        expect(beneficiaryUsdtBalance).to.equal(beneficiaryUsdtBalanceBefore.add(getBigNumber(350, 6)));
        expect(beneficiaryDaiBalance).to.equal(beneficiaryDaiBalanceBefore.add(getBigNumber(150)));
      });
    });

    describe("recoverErc20", () => {
      it("it should recover ERC20 tokens from contract to owner wallet", async () => {
        const _tokenSale = await makeSUT(newOwner.address, undefined, undefined, undefined, 50000);
        await _tokenSale.connect(newOwner).addWhitelistedAddresses([alice.address]);

        await usdt.connect(alice).approve(_tokenSale.address, getBigNumber(350, 6));
        await dai.connect(alice).approve(_tokenSale.address, getBigNumber(150));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(550, 6));
        await dai.connect(deployer).transfer(alice.address, getBigNumber(500));
        await dai.connect(deployer).transfer(bob.address, getBigNumber(500));

        await _tokenSale.connect(alice).buyWith(usdt.address, 35000);
        await dai.connect(alice).transfer(_tokenSale.address, getBigNumber(500));
        await dai.connect(bob).transfer(_tokenSale.address, getBigNumber(500));

        expect(await _tokenSale.balances(alice.address)).to.be.equal(35000);
        expect(await _tokenSale.balances(bob.address)).to.be.equal(0);

        expect(await _tokenSale.collected()).to.be.equal(35000);

        expect(await dai.balanceOf(_tokenSale.address)).to.be.equal(getBigNumber(1000));
        expect(await usdt.balanceOf(_tokenSale.address)).to.be.equal(getBigNumber(350, 6));

        expect(await dai.balanceOf(newOwner.address)).to.be.equal(getBigNumber(0));
        expect(await usdt.balanceOf(newOwner.address)).to.be.equal(getBigNumber(0));

        await _tokenSale.connect(newOwner).recoverErc20(dai.address);

        expect(await dai.balanceOf(_tokenSale.address)).to.be.equal(getBigNumber(0));
        expect(await dai.balanceOf(newOwner.address)).to.be.equal(getBigNumber(1000));

        await _tokenSale.connect(newOwner).recoverErc20(usdt.address);

        expect(await usdt.balanceOf(_tokenSale.address)).to.be.equal(getBigNumber(350, 6));
        expect(await usdt.balanceOf(newOwner.address)).to.be.equal(getBigNumber(0, 6));
      });
    });

    describe("changeOwner", () => {
      let _tokenSale: TokenSale;

      before(async () => {
        _tokenSale = await makeSUT(owner.address, undefined, undefined, undefined, 500);
      });

      it("it should revert if new owner is zero address", async () => {
        await expect(_tokenSale.connect(owner).transferOwnership(ADDRESS_ZERO, true)).to.be.revertedWith("Ownable: zero address");
      });

      it("it should store new owner address when non zero address is provided", async () => {
        await _tokenSale.connect(owner).transferOwnership(newOwner.address, false);

        expect(await _tokenSale.pendingOwner()).to.be.equal(newOwner.address);
      });
    });

    describe("acceptOwnership", () => {
      let _tokenSale: TokenSale;

      before(async () => {
        _tokenSale = await makeSUT(owner.address, undefined, undefined, undefined, 500);

        await _tokenSale.connect(owner).transferOwnership(newOwner.address, false);
      });

      it("it should revert if msg.sender is not a new owner", async () => {
        await expect(_tokenSale.connect(bob).claimOwnership()).to.be.revertedWith("Ownable: caller != pending owner");
      });

      it("it claim ownership correctly when msg.sender is a new owner", async () => {
        await expect(_tokenSale.connect(newOwner).claimOwnership())
          .to.emit(_tokenSale, "OwnershipTransferred")
          .withArgs(owner.address, newOwner.address);

        expect(await _tokenSale.pendingOwner()).to.be.equal(ADDRESS_ZERO);
        expect(await _tokenSale.owner()).to.be.equal(newOwner.address);
      });
    });

    describe("receive", () => {
      it("it should blocks direct ETH deposits by default", async () => {
        await expect(deployer.sendTransaction({ to: tokenSale.address, value: getBigNumber(200) })).to.be.reverted;
      });
    });
  });

  describe("Getters", () => {
    beforeEach(async () => {
      tokenSale = await makeSUT();

      await tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);
    });

    describe("endTime", () => {
      it("should correctly return sale end timestamp", async () => {
        const str = await tokenSale.startTime();
        const dur = await tokenSale["duration"]();
        expect(await tokenSale.endTime()).to.be.equal(str.add(dur));
      });
    });

    describe("balanceOf", () => {
      it("should correctly return balance of user", async () => {
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        const balance = await tokenSale.balanceOf(alice.address);
        expect(balance).to.equal(35000);
      });
    });

    describe("maxAllocationOf", () => {
      it("should correctly return max allocation of user", async () => {
        await tokenSale.addWhitelistedAddresses([alice.address]);

        let maxAllocation = await tokenSale.maxAllocationOf(alice.address);
        expect(maxAllocation).to.equal(50000);

        maxAllocation = await tokenSale.maxAllocationOf(bob.address);
        expect(maxAllocation).to.equal(0);

        await expect(tokenSale.connect(deployer).setWhitelistedOnly(false)).to.emit(tokenSale, "WhitelistChanged").withArgs(false);

        maxAllocation = await tokenSale.maxAllocationOf(bob.address);
        expect(maxAllocation).to.equal(50000);
      });
    });

    describe("remainingAllocation", () => {
      it("should correctly return remaining allocation for whitelisted accounts when WL is on, and 0 for all the rest", async () => {
        // maxPerAccount set to 500
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);
        let remainingAllocation = await tokenSale.remainingAllocation(alice.address);

        expect(remainingAllocation).to.equal(15000);

        remainingAllocation = await tokenSale.remainingAllocation(bob.address);

        expect(remainingAllocation).to.equal(0);

        // no maxPerAccount limit
        const _tokenSale = await makeSUT(undefined, undefined, undefined, 0);
        await _tokenSale.connect(deployer).addWhitelistedAddresses([alice.address]);

        await usdt.connect(alice).approve(_tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await _tokenSale.connect(alice).buyWith(usdt.address, 35000);

        remainingAllocation = await _tokenSale.remainingAllocation(alice.address);
        expect(remainingAllocation).to.equal(19965000);

        remainingAllocation = await _tokenSale.remainingAllocation(bob.address);
        expect(remainingAllocation).to.equal(0);
      });

      it("should correctly return remaining allocation for all accounts when WL is off", async () => {
        // maxPerAccount set to 500
        // set WL=off
        await expect(tokenSale.connect(deployer).setWhitelistedOnly(false)).to.emit(tokenSale, "WhitelistChanged").withArgs(false);

        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        let remainingAllocation = await tokenSale.remainingAllocation(alice.address);
        expect(remainingAllocation).to.equal(15000);

        remainingAllocation = await tokenSale.remainingAllocation(bob.address);
        expect(remainingAllocation).to.equal(50000);

        // revert WL=off
        await expect(tokenSale.connect(deployer).setWhitelistedOnly(true)).to.emit(tokenSale, "WhitelistChanged").withArgs(true);

        // no maxPerAccount limit
        const _tokenSale = await makeSUT(undefined, undefined, undefined, 0);
        await expect(_tokenSale.connect(deployer).setWhitelistedOnly(false)).to.emit(_tokenSale, "WhitelistChanged").withArgs(false);

        await usdt.connect(alice).approve(_tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await _tokenSale.connect(alice).buyWith(usdt.address, 35000);

        remainingAllocation = await _tokenSale.remainingAllocation(alice.address);
        expect(remainingAllocation).to.equal(19965000);

        remainingAllocation = await _tokenSale.remainingAllocation(bob.address);
        expect(remainingAllocation).to.equal(19965000);
      });
    });

    describe("isWhitelisted", () => {
      it("should correctly return if user is whitelisted", async () => {
        await tokenSale.addWhitelistedAddresses([alice.address]);

        let whitelisted: boolean = await tokenSale.isWhitelisted(alice.address);
        expect(whitelisted).to.equal(true);

        whitelisted = await tokenSale.isWhitelisted(bob.address);
        expect(whitelisted).to.equal(false);

        await tokenSale.connect(deployer).setWhitelistedOnly(false);

        whitelisted = await tokenSale.isWhitelisted(bob.address);
        expect(whitelisted).to.equal(true);

        await tokenSale.connect(deployer).setWhitelistedOnly(true);

        whitelisted = await tokenSale.isWhitelisted(bob.address);
        expect(whitelisted).to.equal(false);
      });
    });

    describe("acceptableStableCoins", () => {
      it("should correctly returns acceptable stablecoins", async () => {
        const stablecoins: string[] = await tokenSale.acceptableStableCoins();

        expect(stablecoins).to.be.lengthOf(2);
        expect(stablecoins[0]).to.be.equal(usdt.address);
        expect(stablecoins[1]).to.be.equal(dai.address);
      });
    });

    describe("getParticipantsNumber", () => {
      it("it should correctly counts and returns participants number", async () => {
        await tokenSale.addWhitelistedAddresses([alice.address, bob.address]);

        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await dai.connect(bob).approve(tokenSale.address, getBigNumber(500));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await dai.connect(deployer).transfer(bob.address, getBigNumber(500));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        let participantNumber = await tokenSale.getParticipantsNumber();
        expect(participantNumber).to.equal(1);

        await tokenSale.connect(bob).buyWith(dai.address, 25000);

        participantNumber = await tokenSale.getParticipantsNumber();
        expect(participantNumber).to.equal(2);

        await tokenSale.connect(bob).buyWith(dai.address, 25000);

        participantNumber = await tokenSale.getParticipantsNumber();
        expect(participantNumber).to.equal(2);
      });
    });

    describe("getParticipantDataAt", () => {
      it("it should correctly returns participant data at given index", async () => {
        await tokenSale.addWhitelistedAddresses([alice.address, bob.address]);

        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await dai.connect(bob).approve(tokenSale.address, getBigNumber(500));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await dai.connect(deployer).transfer(bob.address, getBigNumber(500));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        let participantData = await tokenSale.getParticipantDataAt(0);

        expect(participantData[0]).to.be.equal(alice.address);
        expect(participantData[1]).to.be.equal(35000);

        expect(participantData["_address"]).to.be.equal(alice.address);
        expect(participantData["_balance"]).to.be.equal(35000);

        await tokenSale.connect(bob).buyWith(dai.address, 25000);

        participantData = await tokenSale.getParticipantDataAt(1);

        expect(participantData[0]).to.be.equal(bob.address);
        expect(participantData[1]).to.be.equal(25000);

        expect(participantData["_address"]).to.be.equal(bob.address);
        expect(participantData["_balance"]).to.be.equal(25000);
      });

      it("it should revert with incorrect index", async () => {
        await expect(tokenSale.getParticipantDataAt(0)).to.be.revertedWith("Incorrect index");

        await tokenSale.addWhitelistedAddresses([alice.address]);
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        await tokenSale.getParticipantDataAt(0);

        await expect(tokenSale.getParticipantDataAt(1)).to.be.revertedWith("Incorrect index");
      });
    });

    describe("getParticipantsDataInRange", () => {
      it("it should correctly returns participants data in given range", async () => {
        await tokenSale.addWhitelistedAddresses([alice.address, bob.address]);

        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await dai.connect(bob).approve(tokenSale.address, getBigNumber(500));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));
        await dai.connect(deployer).transfer(bob.address, getBigNumber(500));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        let participantsData = await tokenSale.getParticipantsDataInRange(0, 0);

        expect(participantsData[0][0]).to.be.equal(alice.address);
        expect(participantsData[0][1]).to.be.equal(35000);

        expect(participantsData[0]["_address"]).to.be.equal(alice.address);
        expect(participantsData[0]["_balance"]).to.be.equal(35000);

        await tokenSale.connect(bob).buyWith(dai.address, 25000);

        participantsData = await tokenSale.getParticipantsDataInRange(1, 1);

        expect(participantsData[0][0]).to.be.equal(bob.address);
        expect(participantsData[0][1]).to.be.equal(25000);

        expect(participantsData[0]["_address"]).to.be.equal(bob.address);
        expect(participantsData[0]["_balance"]).to.be.equal(25000);

        participantsData = await tokenSale.getParticipantsDataInRange(0, 1);

        expect(participantsData[0][0]).to.be.equal(alice.address);
        expect(participantsData[0][1]).to.be.equal(35000);

        expect(participantsData[1]["_address"]).to.be.equal(bob.address);
        expect(participantsData[1]["_balance"]).to.be.equal(25000);
      });

      it("it should revert with incorrect range", async () => {
        await expect(tokenSale.getParticipantsDataInRange(1, 0)).to.be.revertedWith("Incorrect range");
        await expect(tokenSale.getParticipantsDataInRange(0, 0)).to.be.revertedWith("Incorrect range");

        await tokenSale.addWhitelistedAddresses([alice.address]);
        await usdt.connect(alice).approve(tokenSale.address, getBigNumber(350, 6));
        await usdt.connect(deployer).transfer(alice.address, getBigNumber(350, 6));

        await tokenSale.connect(alice).buyWith(usdt.address, 35000);

        await tokenSale.getParticipantsDataInRange(0, 0);

        await expect(tokenSale.getParticipantsDataInRange(0, 1)).to.be.revertedWith("Incorrect range");
      });
    });
  });
});
