/**
 * Test script for Gemini AI document analysis features
 * Run with: node test-document-analysis.js
 */

import { generateContentFromUrl, generateContentFromFile, autoSegmentFile } from './services/geminiService.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function testDocumentAnalysis() {
    console.log('🧪 Testing Gemini AI Document Analysis\n');
    console.log(`Model: ${process.env.LLM_MODEL || 'gemini-3-flash-preview'}`);
    console.log(`API Key configured: ${process.env.GEMINI_API_KEY ? '✅ Yes' : '❌ No'}\n`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ Error: GEMINI_API_KEY not found in .env file');
        console.log('Please add your Gemini API key to .env:');
        console.log('GEMINI_API_KEY=your_key_here\n');
        process.exit(1);
    }

    try {
        // Test 1: Analyze document from URL
        console.log('Test 1: Analyze PDF from URL');
        console.log('URL: https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf');
        console.log('Prompt: "Summarize this research paper"\n');
        console.log('Fetching and analyzing document...\n');

        const urlResult = await generateContentFromUrl(
            'https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf',
            'Summarize this research paper in 3-5 bullet points'
        );

        console.log('✅ URL Analysis Result:');
        console.log(urlResult);
        console.log('\n' + '='.repeat(60) + '\n');

        // Test 2: Analyze local file (if exists)
        const testFilePath = './test.pdf';
        if (fs.existsSync(testFilePath)) {
            console.log('Test 2: Analyze Local PDF File');
            console.log(`File: ${testFilePath}\n`);

            const fileBuffer = fs.readFileSync(testFilePath);
            const fileResult = await generateContentFromFile(
                fileBuffer,
                'application/pdf',
                'What are the main topics discussed in this document?'
            );

            console.log('✅ File Analysis Result:');
            console.log(fileResult);
            console.log('\n' + '='.repeat(60) + '\n');

            // Test 3: Auto-segment local file
            console.log('Test 3: Auto-Segment Local PDF');
            console.log('Processing document segmentation...\n');

            const segmentResult = await autoSegmentFile(fileBuffer, 'application/pdf');

            console.log('✅ Segmentation Result:');
            console.log(JSON.stringify(segmentResult, null, 2));
            console.log('\n' + '='.repeat(60) + '\n');
        } else {
            console.log('ℹ️  Skipping local file tests (test.pdf not found)');
            console.log('   Place a test.pdf file in the backend directory to test local file analysis\n');
            console.log('='.repeat(60) + '\n');
        }

        console.log('✅ All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

// Run tests
testDocumentAnalysis();
