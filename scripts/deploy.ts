
import hre from "hardhat";
import "@nomicfoundation/hardhat-ethers";


async function main() {
    // @ts-ignore: hre.ethers is injected at runtime
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    // @ts-ignore: hre.ethers is injected at runtime
    const OpinionAudit = await hre.ethers.getContractFactory("OpinionAudit");
    const opinionAudit = await OpinionAudit.deploy();

    await opinionAudit.waitForDeployment();

    console.log("OpinionAudit deployed to:", await opinionAudit.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
