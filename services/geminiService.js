import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize the client with API key from environment
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Generate content using Gemini AI
 * @param {string} prompt - The prompt to send to Gemini
 * @param {string} model - The model to use (default: gemini-3-flash-preview)
 * @returns {Promise<string>} - The generated content
 */
export async function generateContent(prompt, model = process.env.LLM_MODEL || "gemini-3-flash-preview") {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error(`Failed to generate content: ${error.message}`);
  }
}

/**
 * Generate content from a file (PDF, image, etc.) using Gemini AI
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} mimeType - The MIME type of the file (e.g., 'application/pdf', 'image/png')
 * @param {string} prompt - The prompt/question about the file
 * @param {string} model - The model to use (default: gemini-3-flash-preview)
 * @returns {Promise<string>} - The generated content
 */
export async function generateContentFromFile(fileBuffer, mimeType, prompt, model = process.env.LLM_MODEL || "gemini-3-flash-preview") {
  try {
    // Supported MIME types for Gemini inline data
    const supportedMimeTypes = [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/webm'
    ];

    let contents;

    // Check if MIME type is supported for inline data
    if (supportedMimeTypes.includes(mimeType)) {
      // Use inline data for supported types
      console.log(`Using inline data for supported MIME type: ${mimeType}`);
      contents = [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: fileBuffer.toString("base64")
          }
        }
      ];
    } else {
      // For unsupported types (text files, scripts, etc.), extract text content
      console.log(`Extracting text content for unsupported MIME type: ${mimeType}`);
      const textContent = fileBuffer.toString('utf-8');
      contents = [
        { text: `${prompt}\n\nFile content:\n\`\`\`\n${textContent}\n\`\`\`` }
      ];
    }

    const response = await ai.models.generateContent({
      model,
      contents: contents
    });

    return response.text;
  } catch (error) {
    console.error("Gemini File API Error:", error);
    throw new Error(`Failed to generate content from file: ${error.message}`);
  }
}

/**
 * Fetch a file from URL and generate content using Gemini AI
 * @param {string} fileUrl - The URL of the file to fetch
 * @param {string} prompt - The prompt/question about the file
 * @param {string} model - The model to use (default: gemini-3-flash-preview)
 * @returns {Promise<string>} - The generated content
 */
export async function generateContentFromUrl(fileUrl, prompt, model = process.env.LLM_MODEL || "gemini-3-flash-preview") {
  try {
    // Fetch the file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file from URL: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'application/pdf';

    const contents = [
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType,
          data: Buffer.from(arrayBuffer).toString("base64")
        }
      }
    ];

    const result = await ai.models.generateContent({
      model,
      contents: contents
    });

    return result.text;
  } catch (error) {
    console.error("Gemini URL Fetch Error:", error);
    throw new Error(`Failed to generate content from URL: ${error.message}`);
  }
}

/**
 * Auto-segment text content using Gemini AI
 * @param {string} text - The text to segment
 * @returns {Promise<object>} - The segmented content with metadata
 */
export async function autoSegment(text) {
  const prompt = `Analyze the following text and segment it into logical sections.
For each segment, provide:
- A title
- A summary
- Key points
- Sentiment (positive, neutral, negative)

Return the result as a JSON object.

Text to analyze:
${text}`;

  try {
    const response = await generateContent(prompt);

    // Try to parse as JSON, fallback to raw response
    try {
      return JSON.parse(response);
    } catch {
      return {
        segments: [{
          title: "Auto-generated analysis",
          content: response,
          sentiment: "neutral"
        }]
      };
    }
  } catch (error) {
    throw new Error(`Auto-segmentation failed: ${error.message}`);
  }
}

/**
 * Auto-segment a document file using Gemini AI
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} mimeType - The MIME type of the file
 * @returns {Promise<object>} - The segmented content with metadata
 */
export async function autoSegmentFile(fileBuffer, mimeType) {
  const prompt = `Analyze this document and segment it into logical sections.
For each segment, provide:
- A title
- A summary
- Key points
- Sentiment (positive, neutral, negative)

Return the result as a JSON object.`;

  try {
    const response = await generateContentFromFile(fileBuffer, mimeType, prompt);

    // Try to parse as JSON, fallback to raw response
    try {
      return JSON.parse(response);
    } catch {
      return {
        segments: [{
          title: "Auto-generated analysis",
          content: response,
          sentiment: "neutral"
        }]
      };
    }
  } catch (error) {
    throw new Error(`File auto-segmentation failed: ${error.message}`);
  }
}
