import chalk from "chalk";

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployResult } from "hardhat-deploy/types";

const displayLogs = true;

function dim(logMessage: string) {
  if (displayLogs) {
    console.log(chalk.dim(logMessage));
  }
}

function cyan(logMessage: string) {
  if (displayLogs) {
    console.log(chalk.cyan(logMessage));
  }
}

function yellow(logMessage: string) {
  if (displayLogs) {
    console.log(chalk.yellow(logMessage));
  }
}

function green(logMessage: string) {
  if (displayLogs) {
    console.log(chalk.green(logMessage));
  }
}

function displayResult(name: string, result: DeployResult) {
  if (!result.newlyDeployed) {
    yellow(`Re-used existing ${name} at ${result.address}`);
  } else {
    green(`${name} deployed at ${result.address}`);
  }
}

const chainName = (chainId: number) => {
  switch (chainId) {
    case 1:
      return "Mainnet";
    case 4:
      return "Rinkeby";
    default:
      return "Unknown";
  }
};

const chainStableCoins = (chainId: number) => {
  switch (chainId) {
    case 1:
      return ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]; // Mainnet: usdt, usdc
    case 4:
      return ["0x8162AF7F8755c18B11f82F4B3c270B748aEE24B1", "0x5Eca482A51E739DF5473a0c09cd5de813d163ed5"]; // Rinkeby: mock usdt, mock usdc
    default:
      return ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]; // Mainnet: usdt, usdc
  }
};

const deployFunction: any = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments, getChainId, ethers } = hre;
  const { deploy } = deployments;

  const { deployer, owner } = await getNamedAccounts();

  const chainId = parseInt(await getChainId());

  // 31337 is unit testing, 1337 is for coverage
  const isTestEnvironment = chainId === 31337 || chainId === 1337;

  dim("\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
  dim("Synapse Network SeedSale - Deploy Script");
  dim("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n");

  dim(`network: ${chainName(chainId)} (${isTestEnvironment ? "local" : "remote"})`);
  dim(`deployer: ${deployer}`);

  cyan("\nDeploying TokenSale...");

  const beneficiary: string = "0xbbe982A9BC956B6b315C934e52DE29AB3f6a0185";
  const startTime: number = 1623747600;
  const duration: number = 122400;
  const min: number = 1_00;
  const max: number = 250_00;
  const cap: number = 50_000_00;
  const stableCoinsAddresses: Array<string> = chainStableCoins(chainId);

  const tokenSaleResult = await deploy("TokenSale", {
    from: deployer,
    args: [owner, beneficiary, min, max, cap, startTime, duration, stableCoinsAddresses],
    skipIfAlreadyDeployed: true,
  });

  displayResult("TokenSale", tokenSaleResult);

  const tokenSalContract = await ethers.getContractAt("TokenSale", tokenSaleResult.address);

  console.log(await tokenSalContract.acceptableStableCoins());
  console.log(await tokenSalContract.beneficiary());

  green(`Done!`);
};

export default deployFunction;
