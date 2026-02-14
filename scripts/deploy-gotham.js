import hre from "hardhat";

async function main() {
  console.log("🚀 Deploying Gotham Platform to Etherlink Shadownet...\n");

  const { viem } = hre;
  const [walletClient] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  console.log("Deploying from account:", walletClient.account.address);
  console.log(`Deploying contract to ${hre.network.name}...\n`);

  // Deploy GothamFactory
  console.log("📝 Deploying GothamFactory...");
  const factory = await viem.deployContract("GothamFactory");

  console.log("✅ GothamFactory deployed to:", factory.address);
  console.log("📍 Explorer:", `https://shadownet.explorer.etherlink.com/address/${factory.address}\n`);

  // Test creating a project with the provided wallet addresses
  console.log("🧪 Testing project creation...");
  const testClient = process.env.CLIENT_WALLET_ADDRESS || "0xd8349aff09364F110bA64d05C7B2F3710fE45585";
  const testDeveloper = process.env.DEVELOPER_WALLET_ADDRESS || "0x20e493b5DF87CE996172326B72AaF3Af9c5eeb59";

  const createTx = await factory.write.createProject([testClient, testDeveloper]);
  await publicClient.waitForTransactionReceipt({ hash: createTx, confirmations: 1 });

  console.log("✅ Test project created!");
  console.log("Transaction hash:", createTx);

  // Get project count
  const projectCount = await factory.read.getTotalProjects();
  console.log("Total projects:", projectCount.toString(), "\n");

  // Summary
  console.log("════════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("════════════════════════════════════════════════════════");
  console.log("\nAdd this to your backend/.env file:");
  console.log(`GOTHAM_FACTORY_ADDRESS=${factory.address}`);
  console.log("\nContract Addresses:");
  console.log("- GothamFactory:", factory.address);
  console.log("\nTest Project Created:");
  console.log("- Client:", testClient);
  console.log("- Developer:", testDeveloper);
  console.log("- Project ID: 1");
  console.log("\nNext Steps:");
  console.log("1. Update backend/.env with GOTHAM_FACTORY_ADDRESS");
  console.log("2. Start backend: cd backend && npm start");
  console.log("3. Start frontend: cd apps/marketing && pnpm dev");
  console.log("4. Visit: http://localhost:3000/dashboard/verify");
  console.log("════════════════════════════════════════════════════════\n");

  return factory.address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
