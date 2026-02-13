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

### 1. Analyze Document (File Upload)
Analyze uploaded documents (PDF, images, etc.) using Gemini AI with multimodal capabilities.

**Endpoint**: `POST /analyze-document`

**Content-Type**: `multipart/form-data`

**Request Body (form-data)**:
- `file` (required): The document file (PDF, PNG, JPG, etc.)
- `prompt` (optional): Custom prompt for analysis (default: "Summarize this document and extract key insights")
- `model` (optional): Model to use (default: from env)

**Example Request (cURL)**:
```bash
curl -X POST http://localhost:4000/analyze-document \
  -F "file=@/path/to/document.pdf" \
  -F "prompt=Summarize this document"
```

**Response**:
```json
{
  "message": "Document analyzed successfully",
  "model": "gemini-3-flash-preview",
  "fileName": "document.pdf",
  "mimeType": "application/pdf",
  "content": "AI-generated analysis..."
}
```

### 2. Auto-Segment Document (File Upload)
Automatically segment uploaded documents into logical sections.

**Endpoint**: `POST /auto-segment-document`

**Content-Type**: `multipart/form-data`

**Request Body (form-data)**:
- `file` (required): The document file to segment

**Example Request (cURL)**:
```bash
curl -X POST http://localhost:4000/auto-segment-document \
  -F "file=@/path/to/document.pdf"
```

**Response**:
```json
{
  "message": "Document auto-segmentation completed",
  "model": "gemini-3-flash-preview",
  "fileName": "document.pdf",
  "mimeType": "application/pdf",
  "result": {
    "segments": [...]
  }
}
```

### 3. Analyze Document from URL
Fetch and analyze a document from a URL.

**Endpoint**: `POST /analyze-url`

**Request Body**:
```json
{
  "url": "https://example.com/document.pdf",
  "prompt": "Summarize this document",  // optional
  "model": "gemini-3-flash-preview"     // optional
}
```

**Example Request (cURL)**:
```bash
curl -X POST http://localhost:4000/analyze-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf", "prompt": "Summarize this research paper"}'
```

**Response**:
```json
{
  "message": "URL document analyzed successfully",
  "model": "gemini-3-flash-preview",
  "url": "https://...",
  "content": "AI-generated summary..."
}
```

### 4. Auto-Segment Text
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

### 5. General Generation Endpoint
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

### 6. Health Check
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

- **`generateContent(prompt, model)`**: Core function for generating AI content from text
- **`generateContentFromFile(fileBuffer, mimeType, prompt, model)`**: Generate content from uploaded files (PDF, images, etc.)
- **`generateContentFromUrl(fileUrl, prompt, model)`**: Fetch and analyze documents from URLs
- **`autoSegment(text)`**: Automatically segment text content
- **`autoSegmentFile(fileBuffer, mimeType)`**: Automatically segment document files

## Example Usage

### Using cURL:

```bash
# Analyze a PDF document
curl -X POST http://localhost:4000/analyze-document \
  -F "file=@/path/to/document.pdf" \
  -F "prompt=Summarize this document"

# Auto-segment a document
curl -X POST http://localhost:4000/auto-segment-document \
  -F "file=@/path/to/document.pdf"

# Analyze document from URL
curl -X POST http://localhost:4000/analyze-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/doc.pdf", "prompt": "What are the key findings?"}'

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
// Analyze a document file
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('prompt', 'Summarize this document');

const docResponse = await fetch('http://localhost:4000/analyze-document', {
  method: 'POST',
  body: formData
});
const docData = await docResponse.json();
console.log(docData.content);

// Analyze document from URL
const urlResponse = await fetch('http://localhost:4000/analyze-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com/document.pdf',
    prompt: 'What are the main points?'
  })
});
const urlData = await urlResponse.json();
console.log(urlData.content);

// Auto-segment text
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
