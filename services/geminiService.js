import { GoogleGenAI } from "@google/genai";

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
