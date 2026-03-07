import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PDFParse } from 'pdf-parse';

interface ExtractionResult {
  text: string;
  images: Record<string, Buffer>;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

// ── Shared resize helper ───────────────────────────────────────────
// Resizes to max 1024px and encodes as JPEG (quality 82).
// JPEG is ~10x smaller than PNG for photos/diagrams — 1.4MB → ~120KB.
// Falls back to original buffer if Sharp fails.
async function resizeToJpeg(input: Buffer, label: string): Promise<{ buffer: Buffer; ext: 'jpg' }> {
  try {
    const buffer = await sharp(input)
      .resize({ width: 1024, withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // fill transparency with white
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer, ext: 'jpg' };
  } catch (err) {
    console.warn(`Sharp resize failed for ${label}, using original:`, err);
    // Return original as-is; caller keeps its existing extension
    return { buffer: input, ext: 'jpg' };
  }
}
// ──────────────────────────────────────────────────────────────────

export async function extractContent(files: Express.Multer.File[]): Promise<ExtractionResult> {
  let allText = '';
  const allImages: Record<string, Buffer> = {};

  for (const file of files) {
    const buffer = fs.readFileSync(file.path);
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (ext === 'pptx') {
      const { text, images } = await extractPptx(buffer, file.originalname);
      allText += `\n\n=== FILE: ${file.originalname} ===\n\n${text}`;
      Object.assign(allImages, images);
    } else if (ext === 'pdf') {
      const { text, images } = await extractPdf(buffer, file.originalname);
      allText += `\n\n=== FILE: ${file.originalname} ===\n\n${text}`;
      Object.assign(allImages, images);
    }
  }

  console.log(`Extraction complete: ${Object.keys(allImages).length} images found`);
  return { text: allText, images: allImages };
}

async function extractPptx(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false });
  const slidesText: string[] = [];
  const images: Record<string, Buffer> = {};
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');

  for (const [filePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (!filePath.startsWith('ppt/media/')) continue;
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;

    try {
      const content = await zipEntry.async('nodebuffer');
      if (content && content.length > 0) {
        const { buffer: resized } = await resizeToJpeg(content, filePath);
        // Store with .jpg extension so Anki and browser both handle it correctly
        const uniqueName = `${baseFilename}_${path.basename(filePath, path.extname(filePath))}.jpg`;
        images[uniqueName] = resized;
      }
    } catch (err) {
      console.warn(`Failed to extract PPTX image ${filePath}:`, err);
    }
  }

  const slideFiles = Object.keys(zip.files)
    .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.match(/slide(\d+)\.xml/)?.[1] || '0');
      return n(a) - n(b);
    });

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile)?.async('string');
    if (!slideXml) continue;
    const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
    let slideContent = `[SLIDE ${slideNum}]\n`;
    const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
    slideContent += textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n');

    const relsFile = `ppt/slides/_rels/${slideFile.split('/').pop()}.rels`;
    const relsXml = await zip.file(relsFile)?.async('string');
    if (relsXml) {
      const rels = parser.parse(relsXml)?.Relationships?.Relationship;
      if (rels) {
        for (const rel of (Array.isArray(rels) ? rels : [rels])) {
          if ((rel['@_Type'] || '').includes('image')) {
            const origBase = path.basename(rel['@_Target'] || '', path.extname(rel['@_Target'] || ''));
            const uniqueName = `${baseFilename}_${origBase}.jpg`;
            if (images[uniqueName]) slideContent += `\n[IMAGE: ${uniqueName}]`;
          }
        }
      }
    }
    slidesText.push(slideContent);
  }

  console.log(`PPTX extraction: ${slideFiles.length} slides, ${Object.keys(images).length} images`);
  return { text: slidesText.join('\n\n---\n\n'), images };
}

async function extractPdf(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
  const images: Record<string, Buffer> = {};
  let fullText = '';

  try {
    const parser = new PDFParse({ data: buffer });

    // Extract text
    const textData = await parser.getText();
    fullText = textData.text;

    // Extract images
    const imageData = await parser.getImage({ imageThreshold: 150, imageDataUrl: false, imageBuffer: true });

    let imgCount = 0;
    for (const page of imageData.pages) {
      for (const img of page.images) {
        if (!img.data) continue;
        if (img.width < 150 || img.height < 150) continue;

        const imgBuffer = Buffer.from(img.data);
        // Store as .jpg — resizeToJpeg handles conversion
        const uniqueName = `${baseFilename}_img_p${page.pageNumber}_${img.name}.jpg`;

        const { buffer: resized } = await resizeToJpeg(imgBuffer, uniqueName);
        images[uniqueName] = resized;
        fullText += `\n[IMAGE: ${uniqueName}]`;
        imgCount++;
      }
    }

    console.log(`PDF extraction: ${imgCount} images kept`);
  } catch (err) {
    console.error(`Failed to extract from PDF ${filename}:`, err);
  }

  return { text: fullText, images };
}