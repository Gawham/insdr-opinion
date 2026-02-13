/**
 * Simple test script for Gemini AI integration
 * Run with: node test-gemini.js
 */

import { generateContent, autoSegment } from './services/geminiService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testGeminiIntegration() {
    console.log('🧪 Testing Gemini AI Integration\n');
    console.log(`Model: ${process.env.LLM_MODEL || 'gemini-3-flash-preview'}`);
    console.log(`API Key configured: ${process.env.GEMINI_API_KEY ? '✅ Yes' : '❌ No'}\n`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ Error: GEMINI_API_KEY not found in .env file');
        console.log('Please add your Gemini API key to .env:');
        console.log('GEMINI_API_KEY=your_key_here\n');
        process.exit(1);
    }

    try {
        // Test 1: Basic content generation
        console.log('Test 1: Basic Content Generation');
        console.log('Prompt: "Explain how AI works in a few words"\n');

        const response1 = await generateContent("Explain how AI works in a few words");
        console.log('✅ Response:', response1);
        console.log('\n' + '='.repeat(60) + '\n');

        // Test 2: Auto-segmentation
        console.log('Test 2: Auto-Segmentation');
        const sampleText = `
            Artificial Intelligence has revolutionized many industries.
            In healthcare, AI helps diagnose diseases and predict patient outcomes.
            In finance, it detects fraud and automates trading.
            Despite these advances, AI also raises important ethical questions
            about privacy, bias, and job displacement.
        `;
        console.log('Text to segment:', sampleText.trim());
        console.log('\nProcessing...\n');

        const segments = await autoSegment(sampleText);
        console.log('✅ Segmentation Result:');
        console.log(JSON.stringify(segments, null, 2));
        console.log('\n' + '='.repeat(60) + '\n');

        console.log('✅ All tests passed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

// Run tests
testGeminiIntegration();
