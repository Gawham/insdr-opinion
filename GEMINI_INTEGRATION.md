# Gemini AI Integration

This backend now includes Google Gemini AI integration for auto-segmentation and content generation.

## Setup

1. **Install dependencies** (already done):
   ```bash
   npm install @google/genai
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` and fill in your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   LLM_MODEL=gemini-3-flash-preview
   ```

3. **Get your Gemini API Key**:
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key
   - Add it to your `.env` file

## API Endpoints

### 1. Auto-Segment Endpoint
Analyzes and segments text content into logical sections with metadata.

**Endpoint**: `POST /auto-segment`

**Request Body**:
```json
{
  "text": "Your text content to analyze and segment..."
}
```

**Response**:
```json
{
  "message": "Auto-segmentation completed",
  "model": "gemini-3-flash-preview",
  "result": {
    "segments": [
      {
        "title": "Section Title",
        "summary": "Brief summary",
        "key_points": ["Point 1", "Point 2"],
        "sentiment": "positive"
      }
    ]
  }
}
```

### 2. General Generation Endpoint
Generate content based on any prompt.

**Endpoint**: `POST /generate`

**Request Body**:
```json
{
  "prompt": "Explain how AI works in a few words",
  "model": "gemini-3-flash-preview" // optional, defaults to env variable
}
```

**Response**:
```json
{
  "message": "Content generated successfully",
  "model": "gemini-3-flash-preview",
  "content": "AI is a computer system that mimics human intelligence..."
}
```

### 3. Health Check
Check if the server is running.

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "OK",
  "message": "Server is running"
}
```

## Service Architecture

The Gemini integration is modularized in `/services/geminiService.js`:

- **`generateContent(prompt, model)`**: Core function for generating AI content
- **`autoSegment(text)`**: Specialized function for text segmentation

## Example Usage

### Using cURL:

```bash
# Auto-segment text
curl -X POST http://localhost:4000/auto-segment \
  -H "Content-Type: application/json" \
  -d '{"text": "Your long text here..."}'

# Generate content
curl -X POST http://localhost:4000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain blockchain in simple terms"}'
```

### Using JavaScript/Fetch:

```javascript
// Auto-segment
const response = await fetch('http://localhost:4000/auto-segment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'Your text to analyze...'
  })
});
const data = await response.json();
console.log(data.result);

// Generate content
const genResponse = await fetch('http://localhost:4000/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Explain AI in simple terms'
  })
});
const genData = await genResponse.json();
console.log(genData.content);
```

## Error Handling

All endpoints return appropriate error messages:

- **400 Bad Request**: Missing required fields
- **500 Internal Server Error**: API key not configured or AI generation failed

## Models

The default model is `gemini-3-flash-preview`. You can:
- Set it in `.env` via `LLM_MODEL`
- Override it per request in the `/generate` endpoint

## Security Notes

- Never commit your `.env` file with actual API keys
- Keep your `GEMINI_API_KEY` secure
- The `.gitignore` file already excludes `.env`
