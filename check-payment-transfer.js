import { createPublicClient, http, formatEther, decodeEventLog } from 'viem';
import dotenv from 'dotenv';
import { PROJECT_ESCROW_ABI } from './contracts-abi.js';

dotenv.config();

const etherlinkShadownet = {
    id: 127823,
    name: 'Etherlink Shadownet',
    nativeCurrency: { name: 'Tezos', symbol: 'XTZ', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://node.shadownet.etherlink.com'] },
    }
};

const publicClient = createPublicClient({ chain: etherlinkShadownet, transport: http() });

// The consensus transaction that should have triggered payment
const txHash = '0xde4cc377f4021cb785e13ab5491e421bf8bae5d69e649cd614759801e195da88';

console.log('=== CHECKING PAYMENT TRANSFER IN TRANSACTION ===\n');
console.log('Transaction:', txHash);
console.log('Explorer:', `https://shadownet.explorer.etherlink.com/tx/${txHash}\n`);

const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

console.log('Status:', receipt.status);
console.log('Block:', receipt.blockNumber.toString());
console.log('Gas Used:', receipt.gasUsed.toString());

console.log('\n--- EVENTS EMITTED ---\n');

let paymentFound = false;
let consensusFound = false;

for (const log of receipt.logs) {
    try {
        // Try to decode as escrow contract events
        const decoded = decodeEventLog({
            abi: PROJECT_ESCROW_ABI,
            data: log.data,
            topics: log.topics
        });

        if (decoded.eventName === 'PaymentReleased') {
            paymentFound = true;
            console.log('🎉 PAYMENT RELEASED EVENT:');
            console.log('   Developer:', decoded.args.developer);
            console.log('   Amount:', formatEther(decoded.args.amount), 'XTZ');
            console.log('   Contract:', log.address);
        } else if (decoded.eventName === 'ConsensusSubmitted') {
            consensusFound = true;
            console.log('✅ CONSENSUS SUBMITTED EVENT:');
            console.log('   Hash:', decoded.args.consensusHash);
            console.log('   Passed:', decoded.args.passed);
        } else {
            console.log(`📝 ${decoded.eventName} event`);
        }
    } catch (e) {
        // Not an escrow event, skip
    }
}

console.log('\n=== SUMMARY ===');
if (consensusFound) console.log('✅ Consensus was submitted');
if (paymentFound) {
    console.log('✅ Payment was released (as internal transaction)');
    console.log('');
    console.log('💡 The payment transfer does NOT have its own transaction hash.');
    console.log('   It\'s an "internal transaction" within this main transaction.');
    console.log('');
    console.log('   To verify on the explorer:');
    console.log('   1. Open the transaction in the explorer');
    console.log('   2. Look for "Internal Transactions" or "Logs" tab');
    console.log('   3. You should see the XTZ transfer to the developer');
} else {
    console.log('❌ Payment was NOT released in this transaction');
}
