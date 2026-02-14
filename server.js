
// @ts-nocheck
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createPublicClient, createWalletClient, http, custom, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Storage } from '@google-cloud/storage';
import multer from 'multer';
import dotenv from 'dotenv';
import {
    autoSegment,
    autoSegmentFile,
    generateContent,
    generateContentFromFile,
    generateContentFromUrl
} from './services/geminiService.js';
import {
    saveNegotiation,
    loadNegotiation,
    appendNegotiationMessage,
    finalizeNegotiation,
    addBlockchainAction
} from './services/negotiationService.js';
import { GOTHAM_FACTORY_ABI, PROJECT_ESCROW_ABI } from './contracts-abi.js';

dotenv.config();

// Type helper functions
/** @param {string | undefined} addr */
const asAddress = (addr) => /** @type {`0x${string}`} */(addr || '0x0');
/** @param {string} str */
const asHex = (str) => /** @type {`0x${string}`} */(str.startsWith('0x') ? str : `0x${str}`);

// 1. Etherlink Chain Definition
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

// 2. Client Initialization
const clientAccount = privateKeyToAccount(`0x${process.env.PRIVATE_KEY?.replace(/^0x/, '')}`);
const developerAccount = privateKeyToAccount(`0x${process.env.DEVELOPER_PRIVATE_KEY?.replace(/^0x/, '')}`);
const publicClient = createPublicClient({ chain: etherlinkShadownet, transport: http() });
const clientWalletClient = createWalletClient({ account: clientAccount, chain: etherlinkShadownet, transport: http() });
const developerWalletClient = createWalletClient({ account: developerAccount, chain: etherlinkShadownet, transport: http() });

console.log('\n=== WALLET INITIALIZATION ===');
console.log('Client Wallet Address:', clientAccount.address);
console.log('Developer Wallet Address:', developerAccount.address);
console.log('Factory Contract:', process.env.GOTHAM_FACTORY_ADDRESS);
console.log('============================\n');

// 3. GCP Storage Setup
// const storage = new Storage({ keyFilename: process.env.GCP_KEYFILE_PATH });
// const bucket = storage.bucket(process.env.BUCKET_NAME);
const upload = multer({ storage: multer.memoryStorage() });

// CONTRACT ABI
const YOUR_CONTRACT_ABI = [
    {
        "inputs": [
            { "internalType": "bytes32", "name": "_contextHash", "type": "bytes32" },
            { "internalType": "string", "name": "_modelId", "type": "string" },
            { "internalType": "bytes32", "name": "_outputHash", "type": "bytes32" }
        ],
        "name": "submitRequest",
        "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "bytes32", "name": "requestId", "type": "bytes32" },
            { "indexed": false, "internalType": "bytes32", "name": "contextHash", "type": "bytes32" },
            { "indexed": false, "internalType": "string", "name": "modelId", "type": "string" },
            { "indexed": false, "internalType": "bytes32", "name": "outputHash", "type": "bytes32" },
            { "indexed": false, "internalType": "address", "name": "requester", "type": "address" }
        ],
        "name": "RequestSubmitted",
        "type": "event"
    }
];

const app = express();
app.use(cors());
app.use(express.json());

// Helper function to parse AI audit response
function parseAuditResponse(response) {
    const decisionMatch = response.match(/DECISION:\s*(PASS|FAIL)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?:\n|$)/i);

    return {
        decision: decisionMatch ? decisionMatch[1].toUpperCase() : 'FAIL',
        reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided',
        passed: decisionMatch && decisionMatch[1].toUpperCase() === 'PASS'
    };
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Verify transaction on Etherlink
app.get('/verify/:txHash', async (req, res) => {
    try {
        const { txHash } = req.params;

        // Fetch transaction from Etherlink explorer API
        const explorerUrl = `https://shadownet.explorer.etherlink.com/api/v2/transactions/${txHash}`;
        const response = await fetch(explorerUrl);

        if (!response.ok) {
            return res.status(404).json({
                error: "Transaction not found",
                txHash
            });
        }

        const txData = await response.json();

        // Parse the response
        const verification = {
            txHash: txData.hash,
            status: txData.status === 'ok' ? 'SUCCESS' : 'FAILED',
            blockNumber: txData.block_number,
            confirmations: txData.confirmations,
            timestamp: txData.timestamp,
            from: txData.from.hash,
            to: txData.to.hash,
            gasUsed: txData.gas_used,
            verified: txData.status === 'ok',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${txHash}`,
            contractAddress: process.env.CONTRACT_ADDRESS,
            isAuditContract: txData.to.hash.toLowerCase() === process.env.CONTRACT_ADDRESS.toLowerCase()
        };

        // Get transaction receipt for logs/events
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

        if (receipt && receipt.logs && receipt.logs.length > 0) {
            verification.requestId = receipt.logs[0]?.topics[1] || null;
            verification.events = receipt.logs.length;
        }

        res.status(200).json({
            message: "Transaction verified successfully",
            verification
        });

    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/audit-request', upload.single('contextFile'), async (req, res) => {
    try {
        const { llmOutput, modelId } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No contextFile provided" });
        }

        // A. Generate Cryptographic Hashes
        const contextHash = keccak256(file.buffer); // Fingerprint of the context
        const outputHash = keccak256(toHex(llmOutput)); // Fingerprint of the AI claim

        // B. Upload File to GCP Bucket (Mocked for now if credentials not set)
        let gcsUrl = "https://storage.googleapis.com/mock-bucket/mock-file";
        if (process.env.GCP_PROJECT_ID && process.env.BUCKET_NAME) {
            try {
                const storage = new Storage({
                    keyFilename: process.env.GCP_KEYFILE_PATH,
                    projectId: process.env.GCP_PROJECT_ID
                });
                const bucket = storage.bucket(process.env.BUCKET_NAME);
                const blob = bucket.file(`verify/${Date.now()}-${file.originalname}`);
                const blobStream = blob.createWriteStream();
                blobStream.end(file.buffer);
                gcsUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

                await new Promise((resolve, reject) => {
                    blobStream.on('finish', resolve);
                    blobStream.on('error', reject);
                });
            } catch (e) {
                console.warn("GCS Upload failed, continuing with mock URL", e);
            }
        }


        // C. Interact with Etherlink Smart Contract
        // Calling the 'submitRequest' function on your deployed contract
        const hash = await clientWalletClient.writeContract({
            address: process.env.CONTRACT_ADDRESS,
            abi: YOUR_CONTRACT_ABI,
            functionName: 'submitRequest',
            args: [contextHash, modelId, outputHash],
        });

        res.status(200).json({
            message: "Audit Request Submitted",
            transactionHash: hash,
            gcsUrl: gcsUrl,
            status: "Consensus Pending"
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Auto-segment endpoint using Gemini AI
app.post('/auto-segment', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: "No text provided for segmentation" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY not configured. Please set it in your .env file"
            });
        }

        const result = await autoSegment(text);

        res.status(200).json({
            message: "Auto-segmentation completed",
            model: process.env.LLM_MODEL || "gemini-3-flash-preview",
            result
        });

    } catch (error) {
        console.error("Auto-segment error:", error);
        res.status(500).json({ error: error.message });
    }
});

// General AI generation endpoint
app.post('/generate', async (req, res) => {
    try {
        const { prompt, model } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "No prompt provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY not configured. Please set it in your .env file"
            });
        }

        const content = await generateContent(prompt, model);

        res.status(200).json({
            message: "Content generated successfully",
            model: model || process.env.LLM_MODEL || "gemini-3-flash-preview",
            content
        });

    } catch (error) {
        console.error("Generate error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Analyze document from file upload
app.post('/analyze-document', upload.single('file'), async (req, res) => {
    try {
        const { prompt, model } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY not configured. Please set it in your .env file"
            });
        }

        const defaultPrompt = "Summarize this document and extract key insights";
        const content = await generateContentFromFile(
            file.buffer,
            file.mimetype,
            prompt || defaultPrompt,
            model
        );

        res.status(200).json({
            message: "Document analyzed successfully",
            model: model || process.env.LLM_MODEL || "gemini-3-flash-preview",
            fileName: file.originalname,
            mimeType: file.mimetype,
            content
        });

    } catch (error) {
        console.error("Analyze document error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Auto-segment document from file upload
app.post('/auto-segment-document', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY not configured. Please set it in your .env file"
            });
        }

        const result = await autoSegmentFile(file.buffer, file.mimetype);

        res.status(200).json({
            message: "Document auto-segmentation completed",
            model: process.env.LLM_MODEL || "gemini-3-flash-preview",
            fileName: file.originalname,
            mimeType: file.mimetype,
            result
        });

    } catch (error) {
        console.error("Auto-segment document error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Analyze document from URL
app.post('/analyze-url', async (req, res) => {
    try {
        const { url, prompt, model } = req.body;

        if (!url) {
            return res.status(400).json({ error: "No URL provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                error: "GEMINI_API_KEY not configured. Please set it in your .env file"
            });
        }

        const defaultPrompt = "Summarize this document and extract key insights";
        const content = await generateContentFromUrl(url, prompt || defaultPrompt, model);

        res.status(200).json({
            message: "URL document analyzed successfully",
            model: model || process.env.LLM_MODEL || "gemini-3-flash-preview",
            url,
            content
        });

    } catch (error) {
        console.error("Analyze URL error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// GOTHAM PLATFORM ENDPOINTS
// ========================================

// Create new project
app.post('/gotham/create-project', async (req, res) => {
    try {
        console.log('\n=== CREATE PROJECT ===');
        const { clientAddress, developerAddress } = req.body;

        // Use developer address from .env if not provided or override if POC mode
        const actualDeveloperAddress = developerAddress || developerAccount.address;

        console.log('Request:', { clientAddress, developerAddress: actualDeveloperAddress });
        console.log('⚠️  Developer address from .env:', developerAccount.address);

        if (actualDeveloperAddress.toLowerCase() !== developerAccount.address.toLowerCase()) {
            console.log('⚠️  WARNING: Using different developer address than .env!');
            console.log('   Requested:', actualDeveloperAddress);
            console.log('   .env has:', developerAccount.address);
        }

        if (!clientAddress || !actualDeveloperAddress) {
            console.log('❌ Missing addresses');
            return res.status(400).json({ error: "Client and developer addresses required" });
        }

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            console.log('❌ Factory address not configured');
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Call factory contract to create new project (use client wallet)
        console.log('📝 Calling createProject on factory...');
        console.log('   Using wallet:', clientAccount.address);
        console.log('   Factory address:', process.env.GOTHAM_FACTORY_ADDRESS);
        const hash = await clientWalletClient.writeContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'createProject',
            args: [clientAddress, actualDeveloperAddress],
        });
        console.log('✅ Transaction sent:', hash);
        console.log('⏳ Waiting for receipt to get project ID...');

        // Wait for transaction receipt to get project ID and escrow address
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Parse logs to get projectId and escrowContract from ProjectCreated event
        let projectId, escrowContract;
        if (receipt.logs && receipt.logs.length > 0) {
            // First topic is event signature, second is projectId
            projectId = receipt.logs[0].topics[1];
            escrowContract = receipt.logs[0].topics[2];
        }

        const parsedProjectId = projectId ? parseInt(projectId, 16) : null;

        // Save initial negotiation with addresses
        if (parsedProjectId) {
            await saveNegotiation(parsedProjectId, {
                projectId: parsedProjectId,
                clientAddress,
                developerAddress: actualDeveloperAddress,
                messages: [],
                terms: {},
                status: 'ongoing'
            });

            await addBlockchainAction(parsedProjectId, {
                action: 'create_project',
                transactionHash: hash,
                blockNumber: receipt.blockNumber.toString(),
                from: clientAccount.address,
                to: process.env.GOTHAM_FACTORY_ADDRESS,
                escrowContract,
                status: 'success',
                explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
            });
        }

        console.log('✅ Project created successfully');
        console.log('   Transaction:', hash);
        console.log('   Project ID:', parsedProjectId);
        console.log('   Escrow Contract:', escrowContract);
        console.log('======================\n');

        res.status(200).json({
            message: "Project created successfully",
            transactionHash: hash,
            projectId: parsedProjectId,
            escrowContract,
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error('\n❌ CREATE PROJECT ERROR:');
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        res.status(500).json({ error: error.message });
    }
});

// Save negotiation message
app.post('/gotham/negotiation/:projectId/message', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { sender, content, senderRole } = req.body;

        if (!content || !sender || !senderRole) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const message = { sender, content, senderRole };
        const negotiation = await appendNegotiationMessage(parseInt(projectId), message);

        res.status(200).json({
            message: "Message added to negotiation",
            negotiation
        });

    } catch (error) {
        console.error("Negotiation message error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get negotiation data
app.get('/gotham/negotiation/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const negotiation = await loadNegotiation(parseInt(projectId));

        if (!negotiation) {
            return res.status(404).json({ error: "Negotiation not found" });
        }

        res.status(200).json(negotiation);

    } catch (error) {
        console.error("Get negotiation error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Finalize negotiation - HYBRID: supports both wallet and backend signing
app.post('/gotham/negotiation/:projectId/finalize', async (req, res) => {
    try {
        console.log('\n=== FINALIZE CONTRACT ===');
        const { projectId } = req.params;
        const { finalTerms, escrowAmount, deadline, transactionHash } = req.body;
        console.log('Project ID:', projectId);
        console.log('Escrow Amount:', escrowAmount, 'wei');
        console.log('Deadline:', deadline);
        console.log('Transaction Hash provided:', transactionHash || 'None (POC mode)');

        if (!finalTerms || !escrowAmount || !deadline) {
            console.log('❌ Missing required fields');
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Generate AI evaluation prompt based on final terms
        const promptTemplate = `You are an AI auditor evaluating code submission for a development project.

PROJECT REQUIREMENTS:
${JSON.stringify(finalTerms, null, 2)}

EVALUATION CRITERIA:
- Does the code repository contain all required features?
- Are all deliverables implemented according to specifications?
- Is the code quality acceptable (no major bugs, follows best practices)?
- Does the submission meet the deadline requirements?

Respond in EXACTLY this format:
DECISION: [PASS or FAIL]
REASON: [One sentence explaining your decision]

Be strict but fair in your evaluation.`;

        console.log('\n📋 GENERATED AUDIT CRITERIA:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(promptTemplate);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const aiPromptHash = keccak256(toHex(promptTemplate));
        const negotiationTermsHash = keccak256(toHex(JSON.stringify(finalTerms)));

        let hash = transactionHash;
        let receipt;

        // If no transactionHash, backend signs (POC mode)
        if (!transactionHash) {
            console.log("🔧 POC Mode: Backend signing transaction");

            console.log('📖 Reading escrow contract address from factory...');
            const escrowAddress = await publicClient.readContract({
                address: process.env.GOTHAM_FACTORY_ADDRESS,
                abi: GOTHAM_FACTORY_ABI,
                functionName: 'getProjectContract',
                args: [BigInt(projectId)]
            });
            console.log('   Escrow address:', escrowAddress);

            console.log('📝 Signing contract...');
            console.log('   Using wallet:', clientAccount.address, '(CLIENT)');
            console.log('   Function: signContract');
            console.log('   Args:', {
                negotiationTermsHash,
                aiPromptHash,
                escrowAmount: escrowAmount.toString(),
                deadline: deadline.toString()
            });

            hash = await clientWalletClient.writeContract({
                address: escrowAddress,
                abi: PROJECT_ESCROW_ABI,
                functionName: 'signContract',
                args: [negotiationTermsHash, aiPromptHash, BigInt(escrowAmount), BigInt(deadline)],
            });
            console.log('✅ Transaction sent:', hash);
            console.log('⏳ Waiting for transaction confirmation...');

            receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log('✅ Transaction confirmed in block:', receipt.blockNumber.toString());
        } else {
            console.log("🌐 Wallet Mode: Using frontend transaction");
            hash = transactionHash;
        }

        // Save finalized negotiation with AI prompt
        const negotiation = await finalizeNegotiation(parseInt(projectId), {
            ...finalTerms,
            escrowAmount,
            deadline,
            aiEvaluationPrompt: promptTemplate,
            aiPromptHash,
            negotiationTermsHash
        });

        // Save blockchain action immediately (status: pending)
        await addBlockchainAction(parseInt(projectId), {
            action: 'sign_contract',
            transactionHash: hash,
            negotiationTermsHash,
            aiPromptHash,
            status: 'pending',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

        console.log('✅ Contract signing transaction broadcasted');
        console.log('   Transaction:', hash);
        console.log('   Mode:', transactionHash ? 'Wallet' : 'POC');
        console.log('   Status: PENDING (check status separately)');
        console.log('========================\n');

        res.status(200).json({
            message: "Transaction submitted - check status to confirm",
            negotiation,
            transactionHash: hash,
            aiPromptHash,
            negotiationTermsHash,
            status: 'pending',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error('\n❌ FINALIZE NEGOTIATION ERROR:');
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        if (error.cause) console.error('   Cause:', error.cause);
        res.status(500).json({ error: error.message });
    }
});

// Fund escrow - HYBRID: supports both wallet and backend signing
app.post('/gotham/fund-escrow/:projectId', async (req, res) => {
    try {
        console.log('\n=== FUND ESCROW ===');
        const { projectId } = req.params;
        const { escrowAmount, transactionHash } = req.body;
        console.log('Project ID:', projectId);
        console.log('Escrow Amount:', escrowAmount, 'wei');
        console.log('Transaction Hash provided:', transactionHash || 'None (POC mode)');

        if (!escrowAmount) {
            console.log('❌ Missing escrow amount');
            return res.status(400).json({ error: "Missing escrow amount" });
        }

        let hash = transactionHash;
        let receipt;

        // If no transactionHash, backend signs (POC mode)
        if (!transactionHash) {
            console.log('🔧 POC Mode: Backend funding escrow');

            console.log('📖 Reading escrow contract address from factory...');
            const escrowAddress = await publicClient.readContract({
                address: process.env.GOTHAM_FACTORY_ADDRESS,
                abi: GOTHAM_FACTORY_ABI,
                functionName: 'getProjectContract',
                args: [BigInt(projectId)]
            });
            console.log('   Escrow address:', escrowAddress);

            console.log('💰 Funding escrow...');
            console.log('   Using wallet:', clientAccount.address, '(CLIENT)');
            console.log('   Function: fundEscrow');
            console.log('   Value:', escrowAmount, 'wei');

            hash = await clientWalletClient.writeContract({
                address: escrowAddress,
                abi: PROJECT_ESCROW_ABI,
                functionName: 'fundEscrow',
                value: BigInt(escrowAmount),
            });
            console.log('✅ Transaction sent:', hash);
            console.log('⏳ Waiting for transaction confirmation...');

            receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log('✅ Transaction confirmed in block:', receipt.blockNumber.toString());
        } else {
            console.log('🌐 Wallet Mode: Using frontend transaction');
            hash = transactionHash;
        }

        // Save blockchain action immediately (status: pending)
        await addBlockchainAction(parseInt(projectId), {
            action: 'fund_escrow',
            transactionHash: hash,
            value: escrowAmount,
            status: 'pending',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

        console.log('✅ Escrow funding transaction broadcasted');
        console.log('   Transaction:', hash);
        console.log('   Amount:', escrowAmount, 'wei');
        console.log('   Mode:', transactionHash ? 'Wallet' : 'POC');
        console.log('   Status: PENDING (check status separately)');
        console.log('===================\n');

        res.status(200).json({
            message: "Transaction submitted - check status to confirm",
            transactionHash: hash,
            projectId,
            escrowAmount,
            status: 'pending',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error('\n❌ FUND ESCROW ERROR:');
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        if (error.cause) console.error('   Cause:', error.cause);
        res.status(500).json({ error: error.message });
    }
});

// Submit code and run AI audit immediately (POC simplified flow)
app.post('/gotham/submit-code/:projectId', upload.single('codeArchive'), async (req, res) => {
    try {
        console.log('\n=== SUBMIT CODE & AUTO-AUDIT (POC MODE) ===');
        const { projectId } = req.params;
        const file = req.file;
        console.log('Project ID:', projectId);
        console.log('File:', file ? `${file.originalname} (${file.size} bytes)` : 'None');

        if (!file) {
            console.log('❌ No code archive provided');
            return res.status(400).json({ error: "No code archive provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            console.log('❌ GEMINI_API_KEY not configured');
            return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
        }

        // Load negotiation to get AI evaluation prompt
        console.log('📖 Loading project negotiation...');
        const negotiation = await loadNegotiation(parseInt(projectId));
        if (!negotiation || !negotiation.terms.aiEvaluationPrompt) {
            console.log('❌ No AI evaluation prompt found');
            return res.status(400).json({ error: "No AI evaluation prompt found for this project" });
        }

        const aiPrompt = negotiation.terms.aiEvaluationPrompt;
        console.log('✅ AI prompt loaded');
        console.log('\n📋 AUDIT CRITERIA:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(aiPrompt);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Run 3 independent AI audits simultaneously
        console.log('🤖 Starting 3 AI audits in parallel...');
        const startTime = Date.now();
        const auditPromises = [
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt)
        ];
        console.log('   ⚡ Audit 1 started');
        console.log('   ⚡ Audit 2 started');
        console.log('   ⚡ Audit 3 started');
        console.log('   ⏳ Waiting for all audits to complete...');

        const auditResults = await Promise.all(auditPromises);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ All 3 audits completed in ${duration}s (ran in parallel)`);

        // Parse audit results to extract decisions and reasons
        const parsedAudits = auditResults.map(result => parseAuditResponse(result));

        // Analyze results for consensus
        console.log('📊 Analyzing audit results...');
        const passCount = parsedAudits.filter(audit => audit.passed).length;

        const consensusReached = passCount === 3; // All 3 must pass
        console.log(`   Pass count: ${passCount}/3`);
        console.log(`   Consensus: ${consensusReached ? '✅ REACHED (APPROVED)' : '❌ NOT REACHED (REJECTED)'}`);

        // Log each audit decision and reason
        parsedAudits.forEach((audit, i) => {
            console.log(`   Audit ${i + 1}: ${audit.decision} - ${audit.reason}`);
        });

        // Get escrow contract address
        console.log('📖 Reading escrow contract address...');
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });
        console.log('   Escrow address:', escrowAddress);

        const auditHashes = auditResults.map(result => keccak256(toHex(result)));

        // Compute consensus OFF-CHAIN
        console.log('📊 Computing consensus off-chain...');
        const passResults = parsedAudits.map(audit => audit.passed);

        passResults.forEach((passed, i) => {
            console.log(`   Audit ${i + 1}: ${passed ? 'PASS ✅' : 'FAIL ❌'}`);
        });

        // Create combined consensus hash from all 3 audit hashes
        const combinedHashInput = (auditHashes[0] || '') + (auditHashes[1]?.slice(2) || '') + (auditHashes[2]?.slice(2) || '');
        const consensusHash = asHex(keccak256(asHex(combinedHashInput)));
        console.log('   Consensus hash:', consensusHash);

        // Submit SINGLE consensus transaction to blockchain via FACTORY
        console.log('📝 Submitting consensus to blockchain (1 transaction)...');
        console.log('   Using wallet:', clientAccount.address, '(CLIENT)');
        console.log('   Calling factory at:', process.env.GOTHAM_FACTORY_ADDRESS);

        const hash = await clientWalletClient.writeContract({
            address: asAddress(process.env.GOTHAM_FACTORY_ADDRESS),
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'submitConsensus',
            args: [BigInt(projectId), consensusHash, consensusReached],
        });
        console.log('✅ Consensus submitted to blockchain via factory');
        console.log('   Transaction:', hash);

        // Save blockchain action with all audit details (stored locally, not on-chain)
        await addBlockchainAction(parseInt(projectId), {
            action: 'ai_audit_complete',
            filename: file.originalname,
            fileSize: file.size,
            auditResults: passResults.map((passed, i) => ({
                auditIndex: i + 1,
                passed,
                decision: parsedAudits[i].decision,
                reason: parsedAudits[i].reason,
                hash: auditHashes[i]
            })),
            consensusHash,
            consensusTransaction: hash,
            consensusReached,
            passCount,
            decision: consensusReached ? 'APPROVED' : 'REJECTED',
            status: 'pending',
        });

        console.log('✅ Code audited and consensus saved to blockchain');
        console.log('   Consensus:', consensusReached ? 'APPROVED ✅' : 'REJECTED ❌');
        console.log('   Blockchain TXs: 1 (down from 3)');
        console.log('========================================\n');

        res.status(200).json({
            message: "Code audited successfully",
            projectId,
            consensusReached,
            passCount,
            decision: consensusReached ? 'APPROVED' : 'REJECTED',
            consensusTransaction: hash,
            consensusHash,
            auditResults: parsedAudits.map((audit, idx) => ({
                auditIndex: idx + 1,
                hash: auditHashes[idx],
                decision: audit.decision,
                passed: audit.passed,
                reason: audit.reason
            }))
        });

    } catch (error) {
        console.error('\n❌ SUBMIT CODE & AUDIT ERROR:');
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        if (error.cause) console.error('   Cause:', error.cause);
        res.status(500).json({ error: error.message });
    }
});

// Run AI audit (3 Gemini calls for consensus)
app.post('/gotham/audit/:projectId', upload.single('codeArchive'), async (req, res) => {
    try {
        console.log('\n=== AI AUDIT ===');
        const { projectId } = req.params;
        const file = req.file;
        console.log('Project ID:', projectId);
        console.log('File:', file ? `${file.originalname} (${file.size} bytes)` : 'None');

        if (!file) {
            console.log('❌ No code archive provided');
            return res.status(400).json({ error: "No code archive provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            console.log('❌ GEMINI_API_KEY not configured');
            return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
        }

        // Load negotiation to get AI evaluation prompt
        console.log('📖 Loading project negotiation...');
        const negotiation = await loadNegotiation(parseInt(projectId));
        if (!negotiation || !negotiation.terms.aiEvaluationPrompt) {
            console.log('❌ No AI evaluation prompt found');
            return res.status(400).json({ error: "No AI evaluation prompt found for this project" });
        }

        const aiPrompt = negotiation.terms.aiEvaluationPrompt;
        console.log('✅ AI prompt loaded');
        console.log('\n📋 AUDIT CRITERIA:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(aiPrompt);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Run 3 independent AI audits simultaneously
        console.log('🤖 Starting 3 AI audits in parallel...');
        const startTime = Date.now();
        const auditPromises = [
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt)
        ];
        console.log('   ⚡ Audit 1 started');
        console.log('   ⚡ Audit 2 started');
        console.log('   ⚡ Audit 3 started');
        console.log('   ⏳ Waiting for all audits to complete...');

        const auditResults = await Promise.all(auditPromises);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ All 3 audits completed in ${duration}s (ran in parallel)`);

        // Parse audit results to extract decisions and reasons
        const parsedAudits = auditResults.map(result => parseAuditResponse(result));

        // Analyze results for consensus
        console.log('📊 Analyzing audit results...');
        const passCount = parsedAudits.filter(audit => audit.passed).length;

        const consensusReached = passCount === 3; // All 3 must pass
        console.log(`   Pass count: ${passCount}/3`);
        console.log(`   Consensus: ${consensusReached ? '✅ REACHED' : '❌ NOT REACHED'}`);

        // Log each audit decision and reason
        parsedAudits.forEach((audit, i) => {
            console.log(`   Audit ${i + 1}: ${audit.decision} - ${audit.reason}`);
        });

        // Submit audit results to blockchain
        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            console.log('❌ Factory address not configured');
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Get project escrow contract address
        console.log('📖 Reading escrow contract address...');
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });
        console.log('   Escrow address:', escrowAddress);

        const auditHashes = auditResults.map(result => keccak256(toHex(result)));

        // Compute consensus OFF-CHAIN
        console.log('📊 Computing consensus off-chain...');
        const passResults = parsedAudits.map(audit => audit.passed);

        passResults.forEach((passed, i) => {
            console.log(`   Audit ${i + 1}: ${passed ? 'PASS ✅' : 'FAIL ❌'}`);
        });

        // Create combined consensus hash from all 3 audit hashes
        const combinedHashInput = auditHashes[0] + auditHashes[1].slice(2) + auditHashes[2].slice(2);
        const consensusHash = keccak256(combinedHashInput);
        console.log('   Consensus hash:', consensusHash);

        // Submit SINGLE consensus transaction to blockchain via FACTORY
        console.log('📝 Submitting consensus to blockchain (1 transaction)...');
        console.log('   Using wallet:', clientAccount.address, '(CLIENT)');
        console.log('   Calling factory at:', process.env.GOTHAM_FACTORY_ADDRESS);

        const hash = await clientWalletClient.writeContract({
            address: asAddress(process.env.GOTHAM_FACTORY_ADDRESS),
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'submitConsensus',
            args: [BigInt(projectId), consensusHash, consensusReached],
        });
        console.log('✅ Consensus submitted to blockchain via factory');
        console.log('   Transaction:', hash);

        console.log('✅ AI audit completed');
        console.log('   Consensus:', consensusReached ? 'REACHED ✅' : 'NOT REACHED ❌');
        console.log('   Pass count:', passCount, '/ 3');
        console.log('   Blockchain TXs: 1 (down from 3)');
        console.log('==============\n');

        res.status(200).json({
            message: "AI audit completed",
            projectId,
            consensusReached,
            passCount,
            consensusTransaction: hash,
            consensusHash,
            auditResults: parsedAudits.map((audit, idx) => ({
                auditIndex: idx + 1,
                hash: auditHashes[idx],
                decision: audit.decision,
                passed: audit.passed,
                reason: audit.reason
            }))
        });

    } catch (error) {
        console.error('\n❌ AI AUDIT ERROR:');
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        if (error.cause) console.error('   Cause:', error.cause);
        res.status(500).json({ error: error.message });
    }
});

// Get audit history from blockchain
app.get('/gotham/project/:projectId/audit-history', async (req, res) => {
    try {
        console.log('\n=== GET AUDIT HISTORY FROM BLOCKCHAIN ===');
        const { projectId } = req.params;
        console.log('Project ID:', projectId);

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            console.log('❌ Factory address not configured');
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Get escrow contract address
        console.log('📖 Reading escrow contract address...');
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });
        console.log('   Escrow address:', escrowAddress);

        // Read consensus result from blockchain (NEW: single transaction instead of 3)
        console.log('📖 Reading consensus result from blockchain...');
        const consensusResult = await publicClient.readContract({
            address: escrowAddress,
            abi: PROJECT_ESCROW_ABI,
            functionName: 'getConsensusResult'
        });

        const [consensusHash, timestamp, passed, submitted] = consensusResult;

        // Load local negotiation data to get individual audit details
        console.log('📖 Loading local audit details...');
        const negotiation = await loadNegotiation(parseInt(projectId));

        // Find the audit action in blockchain actions
        const auditAction = negotiation.blockchainActions?.find(
            action => action.action === 'ai_audit_complete'
        );

        // Prepare individual audit results (stored locally, not on-chain)
        let individualAudits = [];
        if (auditAction && auditAction.auditResults) {
            individualAudits = auditAction.auditResults.map(audit => ({
                auditIndex: audit.auditIndex,
                auditHash: audit.hash,
                passed: audit.passed,
                submitted: true,
                timestamp: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null
            }));
        }

        // Calculate summary
        const totalAudits = submitted ? 3 : 0; // Always 3 if submitted
        const passedAudits = submitted ? (passed ? 3 : individualAudits.filter(a => a.passed).length) : 0;
        const failedAudits = submitted ? (totalAudits - passedAudits) : 0;

        console.log('✅ Consensus history retrieved');
        console.log('   Blockchain Consensus:', submitted ? (passed ? 'APPROVED ✅' : 'REJECTED ❌') : 'PENDING ⏳');
        console.log('   Individual Audits (local):', individualAudits.length);
        console.log('   Passed:', passedAudits, '/ Failed:', failedAudits);
        console.log('=========================================\n');

        res.status(200).json({
            projectId,
            escrowAddress,
            // On-chain consensus data
            consensus: {
                hash: consensusHash,
                timestamp: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null,
                passed,
                submitted
            },
            // Individual audits (from local storage)
            audits: individualAudits,
            summary: {
                totalAudits,
                passedAudits,
                failedAudits,
                consensusReached: passed && submitted,
                decision: submitted ? (passed ? 'APPROVED' : 'REJECTED') : 'PENDING',
                blockchainTransactions: submitted ? 1 : 0 // NEW: Show we only used 1 tx
            }
        });

    } catch (error) {
        console.error('\n❌ GET AUDIT HISTORY ERROR:');
        console.error('   Message:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Check transaction status
app.get('/gotham/check-transaction/:txHash', async (req, res) => {
    try {
        console.log('\n=== CHECK TRANSACTION STATUS ===');
        const { txHash } = req.params;
        console.log('Transaction Hash:', txHash);

        try {
            // Try to get receipt without waiting
            const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

            if (receipt) {
                console.log('✅ Transaction confirmed!');
                console.log('   Block:', receipt.blockNumber.toString());
                console.log('   Status:', receipt.status === 'success' ? 'SUCCESS' : 'FAILED');

                res.status(200).json({
                    status: receipt.status === 'success' ? 'confirmed' : 'failed',
                    receipt: {
                        blockNumber: receipt.blockNumber.toString(),
                        gasUsed: receipt.gasUsed.toString(),
                        from: receipt.from,
                        to: receipt.to,
                        status: receipt.status
                    },
                    explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${txHash}`
                });
            }
        } catch (error) {
            // Receipt not found = transaction still pending
            console.log('⏳ Transaction still pending');
            res.status(200).json({
                status: 'pending',
                transactionHash: txHash,
                message: 'Transaction is pending confirmation',
                explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${txHash}`
            });
        }

    } catch (error) {
        console.error('\n❌ CHECK TRANSACTION ERROR:');
        console.error('   Message:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// List all available projects
app.get('/gotham/projects', async (req, res) => {
    try {
        console.log('\n=== LIST ALL PROJECTS ===');

        const negotiationsDir = path.join(process.cwd(), 'data', 'negotiations');

        // Check if directory exists
        if (!fs.existsSync(negotiationsDir)) {
            console.log('No negotiations directory found');
            return res.status(200).json({ projects: [] });
        }

        // Read all files in the negotiations directory
        const files = fs.readdirSync(negotiationsDir);
        const projectFiles = files.filter(f => f.startsWith('project-') && f.endsWith('.json'));

        const projects = [];
        for (const file of projectFiles) {
            try {
                const filePath = path.join(negotiationsDir, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

                // Extract project summary
                projects.push({
                    projectId: data.projectId,
                    clientAddress: data.clientAddress,
                    developerAddress: data.developerAddress,
                    status: data.status,
                    messageCount: data.messages?.length || 0,
                    hasTerms: !!data.terms && Object.keys(data.terms).length > 0,
                    lastUpdated: fs.statSync(filePath).mtime
                });
            } catch (err) {
                console.error(`Error reading project file ${file}:`, err);
            }
        }

        // Sort by project ID descending (newest first)
        projects.sort((a, b) => b.projectId - a.projectId);

        console.log(`✅ Found ${projects.length} projects`);
        console.log('========================\n');

        res.status(200).json({ projects });

    } catch (error) {
        console.error('\n❌ LIST PROJECTS ERROR:');
        console.error('   Message:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get project details
app.get('/gotham/project/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Get project details from factory contract
        const projectDetails = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectDetails',
            args: [BigInt(projectId)]
        });

        const [escrowContract, client, developer, escrowAmount, status, deadline] = projectDetails;

        // Get negotiation data
        const negotiation = await loadNegotiation(parseInt(projectId));

        res.status(200).json({
            projectId,
            escrowContract,
            client,
            developer,
            escrowAmount: escrowAmount.toString(),
            status,
            deadline: deadline.toString(),
            negotiation
        });

    } catch (error) {
        console.error("Get project error:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`LLM Model: ${process.env.LLM_MODEL || 'gemini-3-flash-preview'}`);
});
