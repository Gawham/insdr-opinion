
import express from 'express';
import cors from 'cors';
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
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: etherlinkShadownet, transport: http() });
const walletClient = createWalletClient({ account, chain: etherlinkShadownet, transport: http() });

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
        const hash = await walletClient.writeContract({
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
        const { clientAddress, developerAddress } = req.body;

        if (!clientAddress || !developerAddress) {
            return res.status(400).json({ error: "Client and developer addresses required" });
        }

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Call factory contract to create new project
        const hash = await walletClient.writeContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'createProject',
            args: [clientAddress, developerAddress],
        });

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
                developerAddress,
                messages: [],
                terms: {},
                status: 'ongoing'
            });

            await addBlockchainAction(parsedProjectId, {
                action: 'create_project',
                transactionHash: hash,
                blockNumber: receipt.blockNumber.toString(),
                from: account.address,
                to: process.env.GOTHAM_FACTORY_ADDRESS,
                escrowContract,
                status: 'success',
                explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
            });
        }

        res.status(200).json({
            message: "Project created successfully",
            transactionHash: hash,
            projectId: parsedProjectId,
            escrowContract,
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error("Create project error:", error);
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

// Finalize negotiation and generate AI prompt
app.post('/gotham/negotiation/:projectId/finalize', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { finalTerms, escrowAmount, deadline } = req.body;

        if (!finalTerms || !escrowAmount || !deadline) {
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

Analyze the submitted code repository and respond with:
1. PASS or FAIL
2. Detailed reasoning for your decision
3. List of completed requirements
4. List of missing or incomplete requirements (if any)

Be strict but fair in your evaluation.`;

        const aiPromptHash = keccak256(toHex(promptTemplate));
        const negotiationTermsHash = keccak256(toHex(JSON.stringify(finalTerms)));

        // Get project escrow contract address
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });

        // Call signContract on the escrow contract
        const hash = await walletClient.writeContract({
            address: escrowAddress,
            abi: PROJECT_ESCROW_ABI,
            functionName: 'signContract',
            args: [
                negotiationTermsHash,
                aiPromptHash,
                BigInt(escrowAmount),
                BigInt(deadline)
            ],
        });

        // Wait for transaction receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Save finalized negotiation with AI prompt
        const negotiation = await finalizeNegotiation(parseInt(projectId), {
            ...finalTerms,
            escrowAmount,
            deadline,
            aiEvaluationPrompt: promptTemplate,
            aiPromptHash,
            negotiationTermsHash
        });

        // Save blockchain action
        await addBlockchainAction(parseInt(projectId), {
            action: 'sign_contract',
            transactionHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            from: account.address,
            to: escrowAddress,
            negotiationTermsHash,
            aiPromptHash,
            status: 'success',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

        res.status(200).json({
            message: "Contract signed on blockchain",
            negotiation,
            transactionHash: hash,
            aiPromptHash,
            negotiationTermsHash,
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error("Finalize negotiation error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Fund escrow (client deposits payment)
app.post('/gotham/fund-escrow/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { escrowAmount } = req.body;

        if (!escrowAmount) {
            return res.status(400).json({ error: "Escrow amount not provided" });
        }

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Get project escrow contract address
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });

        // Call escrow contract to fund (payable function)
        const hash = await walletClient.writeContract({
            address: escrowAddress,
            abi: PROJECT_ESCROW_ABI,
            functionName: 'fundEscrow',
            value: BigInt(escrowAmount),
        });

        // Wait for transaction receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Save blockchain action
        await addBlockchainAction(parseInt(projectId), {
            action: 'fund_escrow',
            transactionHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            from: account.address,
            to: escrowAddress,
            value: escrowAmount,
            status: 'success',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

        res.status(200).json({
            message: "Escrow funded successfully",
            transactionHash: hash,
            projectId,
            escrowAmount,
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error("Fund escrow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Submit code for audit (developer uploads code)
app.post('/gotham/submit-code/:projectId', upload.single('codeArchive'), async (req, res) => {
    try {
        const { projectId } = req.params;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No code archive provided" });
        }

        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Generate hash of submitted code
        const codeHash = keccak256(file.buffer);

        // Get project escrow contract address
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });

        // Call escrow contract to submit code
        const hash = await walletClient.writeContract({
            address: escrowAddress,
            abi: PROJECT_ESCROW_ABI,
            functionName: 'submitCode',
            args: [codeHash],
        });

        // Wait for transaction receipt
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Save blockchain action
        await addBlockchainAction(parseInt(projectId), {
            action: 'submit_code',
            transactionHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            from: account.address,
            to: escrowAddress,
            codeHash,
            status: 'success',
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

        res.status(200).json({
            message: "Code submitted for audit",
            transactionHash: hash,
            codeHash,
            projectId,
            explorerUrl: `https://shadownet.explorer.etherlink.com/tx/${hash}`
        });

    } catch (error) {
        console.error("Submit code error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Run AI audit (3 Gemini calls for consensus)
app.post('/gotham/audit/:projectId', upload.single('codeArchive'), async (req, res) => {
    try {
        const { projectId } = req.params;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No code archive provided" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
        }

        // Load negotiation to get AI evaluation prompt
        const negotiation = await loadNegotiation(parseInt(projectId));
        if (!negotiation || !negotiation.terms.aiEvaluationPrompt) {
            return res.status(400).json({ error: "No AI evaluation prompt found for this project" });
        }

        const aiPrompt = negotiation.terms.aiEvaluationPrompt;

        // Run 3 independent AI audits
        const auditPromises = [
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt),
            generateContentFromFile(file.buffer, file.mimetype, aiPrompt)
        ];

        const auditResults = await Promise.all(auditPromises);

        // Analyze results for consensus
        const passCount = auditResults.filter(result =>
            result.toLowerCase().includes('pass') && !result.toLowerCase().includes('fail')
        ).length;

        const consensusReached = passCount === 3; // All 3 must pass

        // Submit audit results to blockchain
        if (!process.env.GOTHAM_FACTORY_ADDRESS) {
            return res.status(500).json({ error: "GOTHAM_FACTORY_ADDRESS not configured" });
        }

        // Get project escrow contract address
        const escrowAddress = await publicClient.readContract({
            address: process.env.GOTHAM_FACTORY_ADDRESS,
            abi: GOTHAM_FACTORY_ABI,
            functionName: 'getProjectContract',
            args: [BigInt(projectId)]
        });

        const auditHashes = auditResults.map(result => keccak256(toHex(result)));

        // Submit each audit result to the escrow contract
        for (let i = 0; i < 3; i++) {
            const passed = auditResults[i].toLowerCase().includes('pass') &&
                         !auditResults[i].toLowerCase().includes('fail');

            await walletClient.writeContract({
                address: escrowAddress,
                abi: PROJECT_ESCROW_ABI,
                functionName: 'submitAuditResult',
                args: [auditHashes[i], passed],
            });
        }

        res.status(200).json({
            message: "AI audit completed",
            projectId,
            consensusReached,
            passCount,
            auditResults: auditResults.map((result, idx) => ({
                auditIndex: idx,
                hash: auditHashes[idx],
                passed: result.toLowerCase().includes('pass') && !result.toLowerCase().includes('fail'),
                summary: result.substring(0, 200) + '...'
            }))
        });

    } catch (error) {
        console.error("AI audit error:", error);
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
