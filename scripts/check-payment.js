import { createPublicClient, http, formatEther } from 'viem';
import dotenv from 'dotenv';
dotenv.config();

const etherlinkShadownet = {
    id: 127823,
    name: 'Etherlink Shadownet',
    rpcUrls: {
        default: { http: ['https://node.shadownet.etherlink.com'] },
    },
};

const client = createPublicClient({
    chain: etherlinkShadownet,
    transport: http()
});

const escrowAddress = '0xf5F626D1f57B4bCb80bbB2Cb3b37bF4f1dAa360b';
const devWallet = '0x4b7236b9c62902935816eD94585516b837fCC611';

console.log('🔍 Checking payment status for Project 2...\n');

// Check escrow balance
const escrowBalance = await client.getBalance({ address: escrowAddress });
console.log('Escrow balance:', formatEther(escrowBalance), 'XTZ');

// Check developer balance
const devBalance = await client.getBalance({ address: devWallet });
console.log('Developer balance:', formatEther(devBalance), 'XTZ');

// Check escrow contract status
const ESCROW_ABI = [{
    "inputs": [],
    "name": "status",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
}, {
    "inputs": [],
    "name": "auditCount",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
}];

const status = await client.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'status'
});

const auditCount = await client.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'auditCount'
});

const statusNames = ['Negotiating', 'ContractSigned', 'Funded', 'UnderDevelopment',
                     'CodeSubmitted', 'AuditPassed', 'AuditFailed', 'Completed', 'Disputed', 'Cancelled'];

console.log('\n📊 Contract State:');
console.log('Status:', statusNames[status] || status);
console.log('Total audits:', auditCount.toString());

if (escrowBalance === 0n && status === 7) {
    console.log('\n✅ PAYMENT RELEASED! Developer received 0.025 XTZ');
} else if (escrowBalance > 0n) {
    console.log('\n❌ Payment still in escrow (' + formatEther(escrowBalance) + ' XTZ)');
    console.log('Status should be "Completed" (7) but is:', statusNames[status]);
} else {
    console.log('\n⚠️ Escrow empty but status is:', statusNames[status]);
}
