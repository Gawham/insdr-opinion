import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEGOTIATIONS_DIR = path.join(__dirname, '../data/negotiations');

// Ensure negotiations directory exists
async function ensureDirectoryExists() {
    try {
        await fs.access(NEGOTIATIONS_DIR);
    } catch {
        await fs.mkdir(NEGOTIATIONS_DIR, { recursive: true });
    }
}

/**
 * Save negotiation data to JSON file
 * @param {number} projectId - Project ID
 * @param {object} negotiationData - Negotiation messages and terms
 */
export async function saveNegotiation(projectId, negotiationData) {
    await ensureDirectoryExists();
    const filePath = path.join(NEGOTIATIONS_DIR, `project-${projectId}.json`);

    const data = {
        projectId,
        lastUpdated: new Date().toISOString(),
        ...negotiationData
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return data;
}

/**
 * Load negotiation data from JSON file
 * @param {number} projectId - Project ID
 */
export async function loadNegotiation(projectId) {
    await ensureDirectoryExists();
    const filePath = path.join(NEGOTIATIONS_DIR, `project-${projectId}.json`);

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null; // File doesn't exist
        }
        throw error;
    }
}

/**
 * Append message to negotiation
 * @param {number} projectId - Project ID
 * @param {object} message - Message object with sender, content, timestamp
 */
export async function appendNegotiationMessage(projectId, message) {
    let negotiation = await loadNegotiation(projectId);

    if (!negotiation) {
        negotiation = {
            projectId,
            messages: [],
            terms: {},
            status: 'ongoing'
        };
    }

    negotiation.messages.push({
        ...message,
        timestamp: new Date().toISOString()
    });

    await saveNegotiation(projectId, negotiation);
    return negotiation;
}

/**
 * Finalize negotiation terms
 * @param {number} projectId - Project ID
 * @param {object} finalTerms - Final agreed terms
 */
export async function finalizeNegotiation(projectId, finalTerms) {
    let negotiation = await loadNegotiation(projectId);

    if (!negotiation) {
        throw new Error('Negotiation not found');
    }

    negotiation.terms = finalTerms;
    negotiation.status = 'finalized';
    negotiation.finalizedAt = new Date().toISOString();

    await saveNegotiation(projectId, negotiation);
    return negotiation;
}
