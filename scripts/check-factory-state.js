import { createPublicClient, http } from 'viem';
import dotenv from 'dotenv';
dotenv.config();

const etherlinkShadownet = {
    id: 127823,
    name: 'Etherlink Shadownet',
    network: 'etherlink-shadownet',
    nativeCurrency: { name: 'XTZ', symbol: 'XTZ', decimals: 18 },
    rpcUrls: {
        default: { http: [process.env.ETHERLINK_RPC || 'https://node.shadownet.etherlink.com'] },
        public: { http: [process.env.ETHERLINK_RPC || 'https://node.shadownet.etherlink.com'] },
    },
};

const publicClient = createPublicClient({
    chain: etherlinkShadownet,
    transport: http()
});

const FACTORY_ABI = [
    {
        "inputs": [],
        "name": "projectCount",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "name": "projects",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
];

const factoryAddress = process.env.GOTHAM_FACTORY_ADDRESS || '0x96093ba550524cd9b0b0b8bcc9751c0569d180fd';

console.log('\n=== CHECKING FACTORY STATE ===');
console.log('Factory address:', factoryAddress);

const projectCount = await publicClient.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'projectCount'
});

console.log('Total projects:', projectCount.toString());
console.log('\nProject mappings:');

for (let i = 1; i <= Number(projectCount); i++) {
    const escrowAddress = await publicClient.readContract({
        address: factoryAddress,
        abi: FACTORY_ABI,
        functionName: 'projects',
        args: [BigInt(i)]
    });
    console.log(`  Project ${i}: ${escrowAddress}`);
}

console.log('===============================\n');
