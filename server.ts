import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractContent } from './src/services/extractionService';
import { generateFlashcards } from './src/services/geminiService';
import { createAnkiPackage } from './src/services/ankiService';
import { generateOcclusionCards } from './src/services/occlusionService';
import dotenv from 'dotenv';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Check for .env file existence for debugging
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('.env file found at:', envPath);
} else {
  console.warn('No .env file found at:', envPath);
}

const upload = multer({ dest: uploadDir });

// API Routes
app.post('/api/generate', upload.array('files'), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const deckName = req.body.deck_name;
    let cardTypes: string[] = ['basic'];
    
    try {
      if (req.body.card_types) {
        cardTypes = JSON.parse(req.body.card_types);
      }
    } catch (e) {
      console.warn('Failed to parse card_types, defaulting to basic', e);
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    if (!deckName) {
      return res.status(400).json({ error: 'Deck name is required' });
    }

    console.log(`Processing ${files.length} files for deck: ${deckName}`);

    // 1. Extract content
    const extractionResult = await extractContent(files);
    
    // 2. Generate flashcards with AI
    const cards = await generateFlashcards(extractionResult.text, extractionResult.images, deckName, cardTypes);

    // 2.5 Generate occlusion cards if requested
    const includeOcclusion = req.body.include_occlusion !== 'false';
    let occlusionCards: any[] = [];
    
    if (includeOcclusion) {
      console.log('Generating occlusion cards...');
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        occlusionCards = await generateOcclusionCards(extractionResult.images, apiKey);
        console.log(`Generated ${occlusionCards.length} occlusion cards`);
      } else {
        console.warn('Skipping occlusion generation: No API key found');
      }
    }

    // 3. Create .apkg file
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    const timestamp = Date.now();
    const outputFilename = `${deckName.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.apkg`;
    const outputPath = path.join(outputDir, outputFilename);

    await createAnkiPackage(cards, outputPath, deckName, extractionResult.images, cardTypes, occlusionCards);

    // Verify file exists and has content
    const fileSize = fs.statSync(outputPath).size;
    console.log(`Generated .apkg file: ${outputFilename} (${fileSize} bytes)`);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Content-Length', fileSize);

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('close', () => {
      // Cleanup after stream finishes
      files.forEach(file => { try { fs.unlinkSync(file.path); } catch {} });
      try { fs.unlinkSync(outputPath); } catch {}
    });

  } catch (error) {
    console.error('Error generating flashcards:', error);
    if (error instanceof Error) {
        console.error('Stack:', error.stack);
    }
    res.status(500).json({ 
        error: 'Failed to generate flashcards', 
        details: (error as Error).message,
        stack: process.env.NODE_ENV !== 'production' ? (error as Error).stack : undefined
    });
  }
});

// Vite middleware setup
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Serve static files in production
  app.use(express.static(path.join(__dirname, 'dist')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});



app.get('/api/models', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API Key not configured' });
  }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch models', details: (error as Error).message });
  }
});
