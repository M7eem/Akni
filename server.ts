import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { extractContent } from './src/services/extractionService';
import { generateFlashcards } from './src/services/geminiService';
import { createAnkiPackage } from './src/services/ankiService';
import { generateOcclusionCards, detectLabelsForImage, generateOcclusionCardsFromLabels } from './src/services/occlusionService';
import { requireAuth, optionalAuth, AuthenticatedRequest, getAdminStorage, getDownloadURL } from './src/authMiddleware';
import { checkAndIncrementUsage, checkUsage, saveDeckHistory } from './src/services/adminDeckHistoryService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://ais-dev-w4lsz5lcwsypn5bifzj3yf-7935056271.europe-west3.run.app',
  'https://ais-pre-w4lsz5lcwsypn5bifzj3yf-7935056271.europe-west3.run.app'
];

if (process.env.RAILWAY_STATIC_URL) {
  allowedOrigins.push(`https://${process.env.RAILWAY_STATIC_URL}`);
}
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const PORT = 3000;

// ── Rate Limiting ─────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 generation requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many generation requests from this IP, please try again after an hour' }
});

app.use('/api/', apiLimiter);

// ── Uploads directory ─────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({ 
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.pdf' && ext !== '.pptx') {
      return cb(new Error('Only .pdf and .pptx files are allowed'));
    }
    cb(null, true);
  }
});

// ── Session store ─────────────────────────────────────────────
const sessionStore = new Map<string, any>();

// ── Helpers ───────────────────────────────────────────────────

/** Detect image mime type from buffer magic bytes.
 *  PDF-extracted images are almost always JPEG, so we default to that. */
function detectMimeType(buffer: Buffer): string {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  return 'image/jpeg'; // PDF images are usually JPEG
}

function getApiKey(): string | undefined {
  const keys = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.API_KEY];
  const validKey = keys.find(k => k && k.trim() !== '' && k.trim() !== 'undefined');
  return validKey?.trim();
}

// ── Routes ────────────────────────────────────────────────────

/** Serve a single image from session by name (lazy-loading in UI) */
app.get('/api/image/:sessionId/:imageName', (req, res) => {
  const { sessionId, imageName } = req.params;
  const session = sessionStore.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const decodedName = decodeURIComponent(imageName);
  const imageBuffer = session.images[decodedName] || session.images[imageName];
  if (!imageBuffer) return res.status(404).json({ error: 'Image not found' });

  res.setHeader('Content-Type', detectMimeType(imageBuffer as Buffer));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(imageBuffer);
});

/** Extract images from uploaded files, store in session, return names only */
app.post('/api/extract-images', optionalAuth, upload.array('files'), async (req: AuthenticatedRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }
      if (!req.isAdmin) {
        try {
          await checkUsage(req.user.uid, req.user.email);
        } catch (error: any) {
          if (error.message === 'LIMIT_REACHED') {
            return res.status(429).json({ error: 'LIMIT_REACHED', message: 'Monthly limit reached' });
          }
          // Non-blocking: If Firestore fails, log it but allow the user to proceed
          console.warn(`Firestore usage check failed for user ${req.user.uid}, proceeding anyway:`, error);
        }
      }
    } else {
      if (req.headers['x-guest-trial'] !== 'true') {
        return res.status(401).json({ error: 'Unauthorized: Guest trial already used or missing header' });
      }
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    try {
      const extractionResult = await extractContent(files);

      const sessionId = uuidv4();
      sessionStore.set(sessionId, extractionResult);

      // Names only — client fetches images lazily via /api/image/:sessionId/:name
      const imageList = Object.keys(extractionResult.images).map(name => ({ name, mimeType: 'image/png' }));

      console.log(`Session ${sessionId}: ${imageList.length} images stored`);

      res.json({ sessionId, images: imageList });
    } finally {
      files.forEach(file => { try { fs.unlinkSync(file.path); } catch {} });
    }
  } catch (error) {
    console.error('Error extracting images:', error);
    res.status(500).json({ error: 'Failed to extract images. Please try again later.' });
  }
});

/** Detect labels for an image already in session — no base64 over the wire */
app.post('/api/detect-labels', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }
      if (!req.isAdmin) {
        try {
          await checkUsage(req.user.uid, req.user.email);
        } catch (error: any) {
          if (error.message === 'LIMIT_REACHED') {
            return res.status(429).json({ error: 'LIMIT_REACHED', message: 'Monthly limit reached' });
          }
          // Non-blocking: If Firestore fails, log it but allow the user to proceed
          console.warn(`Firestore usage check failed for user ${req.user.uid}, proceeding anyway:`, error);
        }
      }
    } else {
      if (req.headers['x-guest-trial'] !== 'true') {
        return res.status(401).json({ error: 'Unauthorized: Guest trial already used or missing header' });
      }
    }

    const { sessionId, imageName } = req.body;
    if (!sessionId || !imageName) {
      return res.status(400).json({ error: 'sessionId and imageName are required' });
    }

    const session = sessionStore.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const decodedName = decodeURIComponent(imageName);
    const imageBuffer = session.images[decodedName] || session.images[imageName];
    if (!imageBuffer) {
      console.error(`Image "${decodedName}" not found. Available:`, Object.keys(session.images).slice(0, 10));
      return res.status(404).json({ error: 'Image not found in session' });
    }

    const apiKey = getApiKey();
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const buf = imageBuffer as Buffer;
    const mimeType = detectMimeType(buf);
    console.log(`detect-labels: "${decodedName}" — mime: ${mimeType}, size: ${buf.length} bytes`);

    if (buf.length < 100) {
      return res.status(400).json({ error: 'Image buffer too small, likely corrupted' });
    }

    const imageBase64 = buf.toString('base64');
    const labels = await detectLabelsForImage(imageBase64, apiKey);

    res.json({ labels });
  } catch (error) {
    console.error('Error detecting labels:', error);
    res.status(500).json({ error: 'Failed to detect labels. Please try again later.' });
  }
});

/** Generate Anki deck from session content */
app.post('/api/generate', generateLimiter, optionalAuth, upload.none(), async (req: AuthenticatedRequest, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
      }
      if (!req.isAdmin) {
        try {
          await checkAndIncrementUsage(req.user.uid, req.user.email);
        } catch (error: any) {
          if (error.message === 'LIMIT_REACHED') {
            return res.status(429).json({ error: 'LIMIT_REACHED', message: 'Monthly limit reached' });
          }
          // Non-blocking: If Firestore fails, log it but allow the user to proceed
          console.warn(`Firestore usage check failed for user ${req.user.uid}, proceeding anyway:`, error);
        }
      }
    } else {
      if (req.headers['x-guest-trial'] !== 'true') {
        return res.status(401).json({ error: 'Unauthorized: Guest trial already used or missing header' });
      }
    }

    const { sessionId, deck_name, selected_images, card_types, occlusionData } = req.body;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!deck_name) return res.status(400).json({ error: 'deck_name is required' });

    const extractionResult = sessionStore.get(sessionId);
    if (!extractionResult) {
      return res.status(400).json({ error: 'Session expired. Please re-upload your files.' });
    }

    const selectedImageNames: string[] = JSON.parse(selected_images || '[]');
    const cardTypes: string[] = JSON.parse(card_types || '["basic"]');
    const parsedOcclusionData = occlusionData ? JSON.parse(occlusionData) : null;

    console.log(`Generating deck: "${deck_name}", card types: ${cardTypes.join(', ')}`);

    const cards = await generateFlashcards(extractionResult.text, extractionResult.images, deck_name, cardTypes);
    console.log(`Generated ${cards.length} regular cards`);

    let occlusionCards: any[] = [];

    if (Array.isArray(parsedOcclusionData)) {
      console.log(`Generating occlusion cards from ${parsedOcclusionData.length} images...`);
      for (const item of parsedOcclusionData) {
        if (item.imageName && item.labels && item.labels.length > 0) {
          const imageBuffer = extractionResult.images[item.imageName];
          if (imageBuffer) {
            const cards = await generateOcclusionCardsFromLabels(
              item.imageName,
              imageBuffer,
              item.labels
            );
            occlusionCards.push(...cards);
          }
        }
      }
      console.log(`Generated ${occlusionCards.length} total occlusion cards`);
    } else if (parsedOcclusionData?.imageName && parsedOcclusionData?.labels) {
      console.log(`Generating occlusion cards from ${parsedOcclusionData.labels.length} labels...`);
      const imageBuffer = extractionResult.images[parsedOcclusionData.imageName];
      if (imageBuffer) {
        occlusionCards = await generateOcclusionCardsFromLabels(
          parsedOcclusionData.imageName,
          imageBuffer,
          parsedOcclusionData.labels
        );
        console.log(`Generated ${occlusionCards.length} occlusion cards`);
      }
    } else if (selectedImageNames.length > 0) {
      const apiKey = getApiKey();
      if (apiKey) {
        const selectedImages: Record<string, Buffer> = {};
        for (const name of selectedImageNames) {
          if (extractionResult.images[name]) selectedImages[name] = extractionResult.images[name];
        }
        occlusionCards = await generateOcclusionCards(selectedImages, apiKey);
        console.log(`Generated ${occlusionCards.length} auto-occlusion cards`);
      }
    }

    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const timestamp = Date.now();
    const outputFilename = `${deck_name.replace(/[^a-z0-9]/gi, '_')}.apkg`;
    const outputPath = path.join(outputDir, outputFilename);

    await createAnkiPackage(cards, outputPath, deck_name, extractionResult.images, cardTypes, occlusionCards);

    sessionStore.delete(sessionId);

    const fileSize = fs.statSync(outputPath).size;
    const totalCards = cards.length + occlusionCards.length;
    console.log(`APKG ready: ${outputFilename} (${fileSize} bytes, ${totalCards} cards)`);

    if (req.user) {
      try {
        const storage = getAdminStorage();
        const bucket = storage.bucket();
        const deckId = uuidv4();
        const storagePath = `users/${req.user.uid}/decks/${deckId}.apkg`;
        const file = bucket.file(storagePath);
        
        await file.save(fs.readFileSync(outputPath), {
          metadata: {
            contentType: 'application/octet-stream',
          }
        });
        
        // Get the download URL
        const downloadUrl = await getDownloadURL(file);

        await saveDeckHistory(req.user.uid, {
          deckName: deck_name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'My Deck',
          cardCount: totalCards,
          fileName: outputFilename,
          downloadUrl: downloadUrl
        });
        console.log(`Uploaded deck to Storage and saved history for user ${req.user.uid}`);
      } catch (uploadError) {
        console.error('Failed to upload deck to Storage or save history:', uploadError);
      }
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Card-Count');
    res.setHeader('X-Card-Count', totalCards.toString());
    res.setHeader('Content-Length', fileSize.toString());

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);
    res.on('finish', () => {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (err) {
        console.error('Error unlinking output file:', err);
      }
    });

  } catch (error) {
    console.error('Error generating flashcards:', error);
    if (error instanceof Error) console.error('Stack:', error.stack);
    res.status(500).json({
      error: 'Failed to generate flashcards. Please try again later.'
    });
  }
});

// ── Vite / Static ─────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});