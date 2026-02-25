/**
 * Debug script: test OCR/LLM extraction pipeline with a specific image.
 *
 * Usage:
 *   node scripts/debug-ocr.mjs IMG_9351.HEIC
 *   node scripts/debug-ocr.mjs IMG_9351.HEIC --mode=tesseract
 *   node scripts/debug-ocr.mjs IMG_9351.HEIC --mode=sharp-only
 */
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const MAX_WORDS = 50;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const JAPANESE_WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g;
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function splitJapaneseText(text) {
  const matches = text.match(JAPANESE_WORD_REGEX);
  if (!matches) return [];
  const unique = [...new Set(matches)];
  return unique
    .filter((w) => w.length >= 2 || KANJI_REGEX.test(w))
    .slice(0, MAX_WORDS);
}

/** Extract words with confidence from Tesseract structured data. */
function extractScoredWords(data) {
  const scored = [];
  if (data.blocks) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            if (!JAPANESE_CHAR_REGEX.test(word.text)) continue;
            const matches = word.text.match(JAPANESE_WORD_REGEX);
            if (!matches) continue;
            for (const m of matches) {
              scored.push({ text: m, confidence: word.confidence });
            }
          }
        }
      }
    }
  }
  // Dedup: keep highest confidence
  const best = new Map();
  for (const w of scored) {
    const prev = best.get(w.text);
    if (prev === undefined || w.confidence > prev) best.set(w.text, w.confidence);
  }
  // Filter + sort
  const entries = [...best.entries()].filter(
    ([text]) => text.length >= 2 || KANJI_REGEX.test(text),
  );
  entries.sort(([aText, aConf], [bText, bConf]) => {
    if (bConf !== aConf) return bConf - aConf;
    const aK = KANJI_REGEX.test(aText) ? 1 : 0;
    const bK = KANJI_REGEX.test(bText) ? 1 : 0;
    if (bK !== aK) return bK - aK;
    return bText.length - aText.length;
  });
  return entries.slice(0, MAX_WORDS).map(([text, conf]) => ({ text, confidence: conf }));
}

async function convertToJpeg(inputPath) {
  console.log('\n--- Step 1: Convert image to JPEG via sharp ---');
  const start = Date.now();

  const buf = await readFile(inputPath);
  console.log(`  Input: ${inputPath}`);
  console.log(`  Input size: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

  const metadata = await sharp(buf).metadata();
  console.log(`  Format: ${metadata.format}`);
  console.log(`  Dimensions: ${metadata.width}x${metadata.height}`);

  // Resize to max 2048px on longest side (reduces payload and improves OCR)
  const maxDim = 2048;
  let resizeOpts = {};
  if (metadata.width > maxDim || metadata.height > maxDim) {
    if (metadata.width >= metadata.height) {
      resizeOpts = { width: maxDim };
    } else {
      resizeOpts = { height: maxDim };
    }
    console.log(`  Resizing to max ${maxDim}px...`);
  }

  const jpegBuf = await sharp(buf)
    .resize(resizeOpts)
    .jpeg({ quality: 85 })
    .toBuffer();

  const jpegMeta = await sharp(jpegBuf).metadata();
  console.log(`  Output: JPEG ${jpegMeta.width}x${jpegMeta.height}`);
  console.log(`  Output size: ${(jpegBuf.length / 1024).toFixed(0)} KB`);
  console.log(`  Conversion took: ${Date.now() - start}ms`);

  return jpegBuf;
}

function bufferToDataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function testTesseract(dataUrl) {
  console.log('\n--- Step 2: Tesseract.js OCR ---');
  const start = Date.now();

  const worker = await createWorker('jpn', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Progress: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });

  const { data } = await worker.recognize(dataUrl);
  await worker.terminate();

  console.log(`\n  OCR took: ${Date.now() - start}ms`);
  console.log(`  Confidence: ${data.confidence}%`);
  console.log(`  Raw text length: ${data.text.length} chars`);
  // Use scored word extraction from structured data
  const scored = extractScoredWords(data);
  console.log(`\n  Scored words (top ${scored.length}, max ${MAX_WORDS}):`);
  scored.forEach((w, i) => console.log(`    ${i + 1}. ${w.text} (${w.confidence.toFixed(1)}%)`));

  return { words: scored, confidence: data.confidence };
}

async function testTesseractWithPreprocessing(inputPath) {
  console.log('\n--- Step 3: Tesseract.js OCR with preprocessing (grayscale + contrast) ---');
  const start = Date.now();

  const buf = await readFile(inputPath);

  // Preprocess: grayscale, normalize, sharpen
  const processedBuf = await sharp(buf)
    .resize({ width: 2048 })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log(`  Preprocessed size: ${(processedBuf.length / 1024).toFixed(0)} KB`);

  const dataUrl = bufferToDataUrl(processedBuf);
  const worker = await createWorker('jpn', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Progress: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });

  const { data } = await worker.recognize(dataUrl);
  await worker.terminate();

  console.log(`\n  OCR took: ${Date.now() - start}ms`);
  console.log(`  Confidence: ${data.confidence}%`);
  console.log(`  Raw text length: ${data.text.length} chars`);
  console.log('\n  --- Preprocessed OCR Text ---');
  console.log(data.text);
  console.log('  --- End Preprocessed Text ---');

  const words = splitJapaneseText(data.text);
  console.log(`\n  Extracted words (${words.length}):`);
  words.forEach((w, i) => console.log(`    ${i + 1}. ${w}`));

  return { text: data.text, words, confidence: data.confidence };
}

async function testTesseractInverted(inputPath) {
  console.log('\n--- Step 4: Tesseract.js OCR with INVERTED image (for dark bg + light text) ---');
  const start = Date.now();

  const buf = await readFile(inputPath);

  const processedBuf = await sharp(buf)
    .resize({ width: 2048 })
    .grayscale()
    .negate()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log(`  Inverted+preprocessed size: ${(processedBuf.length / 1024).toFixed(0)} KB`);

  const dataUrl = bufferToDataUrl(processedBuf);
  const worker = await createWorker('jpn', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Progress: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });

  const { data } = await worker.recognize(dataUrl);
  await worker.terminate();

  console.log(`\n  OCR took: ${Date.now() - start}ms`);
  console.log(`  Confidence: ${data.confidence}%`);
  console.log(`  Raw text length: ${data.text.length} chars`);
  console.log('\n  --- Inverted OCR Text ---');
  console.log(data.text);
  console.log('  --- End Inverted Text ---');

  const words = splitJapaneseText(data.text);
  console.log(`\n  Extracted words (${words.length}):`);
  words.forEach((w, i) => console.log(`    ${i + 1}. ${w}`));

  return { text: data.text, words, confidence: data.confidence };
}

// --- Main ---
const args = process.argv.slice(2);
const imagePath = args.find((a) => !a.startsWith('--'));
const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'all';

if (!imagePath) {
  console.error('Usage: node scripts/debug-ocr.mjs <image-path> [--mode=all|sharp-only|tesseract]');
  process.exit(1);
}

const fullPath = resolve(imagePath);
console.log(`\nDebugging OCR pipeline for: ${fullPath}`);
console.log(`Extension: ${extname(fullPath)}`);
console.log(`Mode: ${modeArg}`);

try {
  const jpegBuf = await convertToJpeg(fullPath);

  if (modeArg === 'sharp-only') {
    console.log('\nDone (sharp-only mode).');
    process.exit(0);
  }

  // Step 2: plain JPEG → Tesseract
  const dataUrl = bufferToDataUrl(jpegBuf);
  const plainResult = await testTesseract(dataUrl);

  // Step 3: preprocessed → Tesseract
  const preprocessedResult = await testTesseractWithPreprocessing(fullPath);

  // Step 4: inverted → Tesseract (for dark background signs)
  const invertedResult = await testTesseractInverted(fullPath);

  // Summary
  console.log('\n\n========== SUMMARY ==========');
  console.log(`Plain JPEG:      ${plainResult.confidence}% confidence, ${plainResult.words.length} words`);
  console.log(`Preprocessed:    ${preprocessedResult.confidence}% confidence, ${preprocessedResult.words.length} words`);
  console.log(`Inverted:        ${invertedResult.confidence}% confidence, ${invertedResult.words.length} words`);
  console.log('=============================\n');
} catch (err) {
  console.error('\nFATAL:', err);
  process.exit(1);
}
