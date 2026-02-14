import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Etherlink Chain Definition
const etherlinkShadownet = {
    id: 127823,
    name: 'Etherlink Shadownet',
    nativeCurrency: { name: 'Tezos', symbol: 'XTZ', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://node.shadownet.etherlink.com'] },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://shadownet.explorer.etherlink.com' },
    }
};

// Initialize clients
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: etherlinkShadownet, transport: http() });
const walletClient = createWalletClient({ account, chain: etherlinkShadownet, transport: http() });

// Read compiled contract
const contractPath = path.join(__dirname, '../artifacts/contracts/GothamFactory.sol/GothamFactory.json');
const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

async function main() {
    console.log("🚀 Deploying Gotham Platform to Etherlink Shadownet...\n");

    console.log("Deploying from account:", account.address);

    // Check balance
    const balance = await publicClient.getBalance({ address: account.address });
    console.log("Account balance:", (Number(balance) / 1e18).toFixed(4), "XTZ\n");

    if (balance === 0n) {
        console.error("❌ Account has no balance. Please fund it at https://shadownet.faucet.etherlink.com/");
        process.exit(1);
    }

    // Deploy contract
    console.log("📝 Deploying GothamFactory...");

    const hash = await walletClient.deployContract({
        abi: contractJson.abi,
        bytecode: contractJson.bytecode,
        args: [],
    });

    console.log("Transaction hash:", hash);
    console.log("Waiting for confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const contractAddress = receipt.contractAddress;
    console.log("✅ GothamFactory deployed to:", contractAddress);
    console.log("📍 Explorer:", `https://shadownet.explorer.etherlink.com/address/${contractAddress}\n`);

    // Test creating a project
    console.log("🧪 Testing project creation...");
    const testClient = process.env.CLIENT_WALLET_ADDRESS || "0xd8349aff09364F110bA64d05C7B2F3710fE45585";
    const testDeveloper = process.env.DEVELOPER_WALLET_ADDRESS || "0x20e493b5DF87CE996172326B72AaF3Af9c5eeb59";

    const createHash = await walletClient.writeContract({
        address: contractAddress,
        abi: contractJson.abi,
        functionName: 'createProject',
        args: [testClient, testDeveloper],
    });

    console.log("Create project tx:", createHash);
    await publicClient.waitForTransactionReceipt({ hash: createHash });

    console.log("✅ Test project created!\n");

    // Get project count
    const projectCount = await publicClient.readContract({
        address: contractAddress,
        abi: contractJson.abi,
        functionName: 'getTotalProjects',
    });

    console.log("Total projects:", projectCount.toString(), "\n");

    // Summary
    console.log("════════════════════════════════════════════════════════");
    console.log("🎉 DEPLOYMENT COMPLETE");
    console.log("════════════════════════════════════════════════════════");
    console.log("\nAdd this to your backend/.env file:");
    console.log(`GOTHAM_FACTORY_ADDRESS=${contractAddress}`);
    console.log("\nContract Addresses:");
    console.log("- GothamFactory:", contractAddress);
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

    return contractAddress;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:");
        console.error(error);
        process.exit(1);
    });
