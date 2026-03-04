import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

interface ExtractionResult {
  text: string;
  images: Record<string, Buffer>;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

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
    const uniqueName = `${baseFilename}_${path.basename(filePath)}`;
    try {
      const content = await zipEntry.async('nodebuffer');
      if (content && content.length > 0) images[uniqueName] = content;
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
            const uniqueName = `${baseFilename}_${path.basename(rel['@_Target'] || '')}`;
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

/** Resolve a PDF.js object — handles both already-resolved and pending objects */
function resolvePdfObj(objs: any, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      // Try synchronous get first (already resolved)
      const obj = objs.get(name);
      resolve(obj);
    } catch {
      // Not resolved yet — use callback form
      try {
        objs.get(name, (obj: any) => {
          if (obj) resolve(obj);
          else reject(new Error(`Object ${name} resolved to null`));
        });
      } catch (err) {
        reject(err);
      }
    }
  });
}

async function extractPdf(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
  const images: Record<string, Buffer> = {};

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // Extract text
    const content = await page.getTextContent();
    fullText += `\n[PAGE ${i}]\n${content.items.map((item: any) => item.str).join(' ')}`;

    // Extract images
    try {
      const ops = await page.getOperatorList();
      const imgNames = new Set<string>();
      for (let j = 0; j < ops.fnArray.length; j++) {
        if (ops.fnArray[j] === 85) imgNames.add(ops.argsArray[j][0]); // paintImageXObject
      }

      for (const imgName of imgNames) {
        try {
          const img = await resolvePdfObj((page as any).objs, imgName);

          if (!img || !img.data || !img.width || !img.height) continue;

          const w = img.width;
          const h = img.height;
          if (w < 100 || h < 100) continue; // skip tiny decorative images

          const rawData = Buffer.from(img.data as Uint8Array);
          const expectedBytes4ch = w * h * 4;
          const expectedBytes3ch = w * h * 3;

          // Auto-detect channels from actual data length
          let channels: 3 | 4;
          if (rawData.length === expectedBytes4ch) {
            channels = 4;
          } else if (rawData.length === expectedBytes3ch) {
            channels = 3;
          } else {
            // Data length doesn't match either — try to infer closest
            const ratio = rawData.length / (w * h);
            channels = ratio > 3.5 ? 4 : 3;
            console.warn(`Image ${imgName} (${w}x${h}): unexpected size ${rawData.length}, expected ${expectedBytes4ch} or ${expectedBytes3ch}, guessing ${channels}ch`);
          }

          const pngBuffer = await sharp(rawData, {
            raw: { width: w, height: h, channels }
          }).png().toBuffer();

          const uniqueName = `${baseFilename}_page${i}_img_${imgName}.png`;
          images[uniqueName] = pngBuffer;
          fullText += `\n[IMAGE: ${uniqueName}]`;
          console.log(`Encoded: ${uniqueName} (${w}x${h} ${channels}ch → ${pngBuffer.length} bytes)`);

        } catch (imgErr) {
          console.warn(`Failed to encode image ${imgName} on page ${i}:`, (imgErr as Error).message);
        }
      }
    } catch {}
  }

  console.log(`PDF extraction: ${pdf.numPages} pages, ${Object.keys(images).length} images`);
  return { text: fullText, images };
}