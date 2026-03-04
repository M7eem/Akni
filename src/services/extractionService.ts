import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exportImages } from 'pdf-export-images';
import { PDFParse } from 'pdf-parse';

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

async function extractPdf(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
  const images: Record<string, Buffer> = {};
  let fullText = '';

  // Extract text using pdf-parse
  try {
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    fullText = data.text;
  } catch (err) {
    console.warn(`Failed to extract text from PDF ${filename}:`, err);
  }

  // Extract images using pdf-export-images
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-extract-'));
  const tmpPdfPath = path.join(tmpDir, 'temp.pdf');
  
  try {
    fs.writeFileSync(tmpPdfPath, buffer);
    const exportedImages = await exportImages(tmpPdfPath, tmpDir) as any[];
    
    for (let i = 0; i < exportedImages.length; i++) {
      const img = exportedImages[i];
      // Skip tiny decorative images
      if (img.width < 100 || img.height < 100) continue;
      
      const imgBuffer = fs.readFileSync(img.file);
      const uniqueName = `${baseFilename}_img_${img.name}.png`;
      images[uniqueName] = imgBuffer;
      fullText += `\n[IMAGE: ${uniqueName}]`;
    }
    console.log(`PDF extraction: ${exportedImages.length} images found, ${Object.keys(images).length} kept`);
  } catch (err) {
    console.error(`Failed to extract images from PDF ${filename}:`, err);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { text: fullText, images };
}