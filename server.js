
import express from 'express';
import cors from 'cors';
import { createPublicClient, createWalletClient, http, custom, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Storage } from '@google-cloud/storage';
import multer from 'multer';
import dotenv from 'dotenv';
import { autoSegment, generateContent } from './services/geminiService.js';

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`LLM Model: ${process.env.LLM_MODEL || 'gemini-3-flash-preview'}`);
});
