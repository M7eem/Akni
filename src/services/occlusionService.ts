import sharp from 'sharp';
import { GoogleGenAI, Type } from '@google/genai';

export interface DetectedLabel {
  id?: string;
  label: string;
  x: number; // fraction 0-1
  y: number;
  w: number;
  h: number;
}

export interface OcclusionCard {
  front: string;
  back: string;
  frontImageName: string;
  frontImageBuffer: Buffer;
  backImageName: string;
  backImageBuffer: Buffer;
}

/** Detect mime type from buffer magic bytes */
function detectMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  return 'image/jpeg'; // PDF images are almost always JPEG
}

export async function detectLabelsForImage(
  imageBase64: string,
  apiKey: string
): Promise<DetectedLabel[]> {
  const ai = new GoogleGenAI({ apiKey });

  // Decode base64 to detect actual mime type from magic bytes
  const buf = Buffer.from(imageBase64, 'base64');
  const mimeType = detectMimeType(buf);

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType,
            data: imageBase64
          }
        },
        {
          text: `You are an expert medical illustrator and anatomist. Your task is to precisely detect and locate ALL anatomical text labels in this diagram.

STRICT INCLUSION RULES:
1. Include EVERY text label that points to a structure via a line, arrow, or bracket.
2. Include both short labels (e.g., "Vermis") and multi-line labels.
3. If a label is inside a box or bubble, include the text.

STRICT EXCLUSION RULES:
1. DO NOT include the main title, figure numbers (e.g., "Fig 1.2"), or captions describing the whole image.
2. DO NOT include copyright text, watermarks, scale bars, or logos.
3. DO NOT include single letters (e.g., "A", "B") unless they are clearly anatomical abbreviations.

BOUNDING BOX RULES (CRITICAL FOR ACCURACY):
1. The bounding box MUST tightly wrap the text characters ONLY.
2. DO NOT include the pointing line, arrow, or bracket in the bounding box.
3. DO NOT include excessive whitespace around the text.
4. For multi-line labels, the box must cover all lines of the text.
5. Coordinates (x, y, w, h) must be precise fractions of the full image dimensions (0.000 to 1.000).
6. x = left edge of the text, y = top edge of the text, w = width of the text, h = height of the text.`
        }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: "The text of the label" },
            x: { type: Type.NUMBER, description: "X coordinate of top-left corner (0.0 to 1.0)" },
            y: { type: Type.NUMBER, description: "Y coordinate of top-left corner (0.0 to 1.0)" },
            w: { type: Type.NUMBER, description: "Width of the bounding box (0.0 to 1.0)" },
            h: { type: Type.NUMBER, description: "Height of the bounding box (0.0 to 1.0)" }
          },
          required: ["label", "x", "y", "w", "h"]
        }
      }
    }
  });

  const raw = response.text?.trim() || '[]';
  const labels: DetectedLabel[] = JSON.parse(raw);

  return labels.map((l, i) => ({ ...l, id: Date.now().toString() + i }));
}

export async function generateOcclusionCardsFromLabels(
  imageName: string,
  imageBuffer: Buffer,
  labels: DetectedLabel[]
): Promise<OcclusionCard[]> {
  const allCards: OcclusionCard[] = [];
  if (!labels || labels.length === 0) return allCards;

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const baseName = imageName.replace(/\.[^.]+$/, ''); // strip any extension

  for (let i = 0; i < labels.length; i++) {
    const labelData = labels[i];

    try {
      const pad = 0.008; // 0.8% of image dimensions as padding
      
      let frontSvgRects = '';
      let backSvgRects = '';
      
      for (let j = 0; j < labels.length; j++) {
        const l = labels[j];
        const px = Math.max(0, Math.floor((l.x - pad) * width));
        const py = Math.max(0, Math.floor((l.y - pad) * height));
        const pw = Math.min(width - px, Math.floor((l.w + pad * 2) * width));
        const ph = Math.min(height - py, Math.floor((l.h + pad * 2) * height));
        
        if (i === j) {
          // Target label - red box on front, NO box on back
          frontSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#e74c3c" rx="4"/>`;
        } else {
          // Other labels - yellow box on front AND back
          frontSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f1c40f" rx="4"/>`;
          backSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f1c40f" rx="4"/>`;
        }
      }

      const frontOverlay = Buffer.from(
        `<svg width="${width}" height="${height}">
          ${frontSvgRects}
        </svg>`
      );
      
      const backOverlay = Buffer.from(
        `<svg width="${width}" height="${height}">
          ${backSvgRects}
        </svg>`
      );

      const frontBuffer = await sharp(imageBuffer)
        .composite([{ input: frontOverlay, blend: 'over' }])
        .png()
        .toBuffer();
        
      const backBuffer = await sharp(imageBuffer)
        .composite([{ input: backOverlay, blend: 'over' }])
        .png()
        .toBuffer();

      const frontImageName = `occl_${baseName}_label_${i}_front.png`;
      const backImageName = `occl_${baseName}_label_${i}_back.png`;

      allCards.push({
        front: `<img src="${frontImageName}"><br><br>What structure is hidden by the <b>red box</b>?`,
        back: `<img src="${backImageName}"><br><br><b>${labelData.label}</b>`,
        frontImageName,
        frontImageBuffer: frontBuffer,
        backImageName,
        backImageBuffer: backBuffer
      });

    } catch (labelErr) {
      console.warn(`Failed to process label ${i} for ${imageName}:`, labelErr);
      continue;
    }
  }

  return allCards;
}

export async function generateOcclusionCards(
  images: Record<string, Buffer>,
  apiKey: string
): Promise<OcclusionCard[]> {
  const ai = new GoogleGenAI({ apiKey });
  const allCards: OcclusionCard[] = [];

  for (const [imageName, imageBuffer] of Object.entries(images)) {
    try {
      const mimeType = detectMimeType(imageBuffer);

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBuffer.toString('base64')
              }
            },
            {
              text: `You are an expert medical illustrator and anatomist. Your task is to precisely detect and locate ALL anatomical text labels in this diagram for image occlusion flashcards.

STRICT INCLUSION RULES:
1. Include EVERY text label that points to a structure via a line, arrow, or bracket.
2. Include both short labels (e.g., "Vermis") and multi-line labels.
3. If a label is inside a box or bubble, include the text.

STRICT EXCLUSION RULES:
1. DO NOT include the main title, figure numbers (e.g., "Fig 1.2"), or captions describing the whole image.
2. DO NOT include copyright text, watermarks, scale bars, or logos.
3. DO NOT include single letters (e.g., "A", "B") unless they are clearly anatomical abbreviations.

BOUNDING BOX RULES (CRITICAL FOR ACCURACY):
1. The bounding box MUST tightly wrap the text characters ONLY.
2. DO NOT include the pointing line, arrow, or bracket in the bounding box.
3. DO NOT include excessive whitespace around the text.
4. For multi-line labels, the box must cover all lines of the text.
5. Coordinates (x, y, w, h) must be precise fractions of the full image dimensions (0.000 to 1.000).
6. x = left edge of the text, y = top edge of the text, w = width of the text, h = height of the text.`
            }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING, description: "The text of the label" },
                x: { type: Type.NUMBER, description: "X coordinate of top-left corner (0.0 to 1.0)" },
                y: { type: Type.NUMBER, description: "Y coordinate of top-left corner (0.0 to 1.0)" },
                w: { type: Type.NUMBER, description: "Width of the bounding box (0.0 to 1.0)" },
                h: { type: Type.NUMBER, description: "Height of the bounding box (0.0 to 1.0)" }
              },
              required: ["label", "x", "y", "w", "h"]
            }
          }
        }
      });

      const raw = response.text?.trim() || '[]';
      const labels: DetectedLabel[] = JSON.parse(raw);

      if (labels.length === 0) continue;

      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width!;
      const height = metadata.height!;

      const baseName = imageName.replace(/\.[^.]+$/, '');

      for (let i = 0; i < labels.length; i++) {
        const labelData = labels[i];

        try {
          const pad = 0.008; // 0.8% of image dimensions as padding
          
          let frontSvgRects = '';
          let backSvgRects = '';
          
          for (let j = 0; j < labels.length; j++) {
            const l = labels[j];
            const px = Math.max(0, Math.floor((l.x - pad) * width));
            const py = Math.max(0, Math.floor((l.y - pad) * height));
            const pw = Math.min(width - px, Math.floor((l.w + pad * 2) * width));
            const ph = Math.min(height - py, Math.floor((l.h + pad * 2) * height));
            
            if (i === j) {
              // Target label - red box on front, NO box on back
              frontSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#e74c3c" rx="3"/>`;
            } else {
              // Other labels - yellow box on front AND back
              frontSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f1c40f" rx="3"/>`;
              backSvgRects += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f1c40f" rx="3"/>`;
            }
          }

          const frontOverlay = Buffer.from(
            `<svg width="${width}" height="${height}">
              ${frontSvgRects}
            </svg>`
          );
          
          const backOverlay = Buffer.from(
            `<svg width="${width}" height="${height}">
              ${backSvgRects}
            </svg>`
          );

          const frontBuffer = await sharp(imageBuffer)
            .composite([{ input: frontOverlay, blend: 'over' }])
            .png()
            .toBuffer();
            
          const backBuffer = await sharp(imageBuffer)
            .composite([{ input: backOverlay, blend: 'over' }])
            .png()
            .toBuffer();

          const frontImageName = `occl_${baseName}_label_${i}_front.png`;
          const backImageName = `occl_${baseName}_label_${i}_back.png`;

          allCards.push({
            front: `<img src="${frontImageName}"><br><br>What structure is hidden by the <b>red box</b>?`,
            back: `<img src="${backImageName}"><br><br><b>${labelData.label}</b>`,
            frontImageName,
            frontImageBuffer: frontBuffer,
            backImageName,
            backImageBuffer: backBuffer
          });

        } catch (labelErr) {
          console.warn(`Failed to process label ${i} for ${imageName}:`, labelErr);
          continue;
        }
      }

    } catch (imageErr) {
      console.warn(`Failed to process image ${imageName} for occlusion:`, imageErr);
      continue;
    }
  }

  console.log(`Generated ${allCards.length} occlusion cards from ${Object.keys(images).length} images`);
  return allCards;
}