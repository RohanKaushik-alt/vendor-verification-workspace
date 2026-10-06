'use strict';

/**
 * Generates the 3 sample vendor documents used in the demo:
 *
 *   data/samples/ABC-Registration-Certificate.pdf
 *   data/samples/ABC-GST-Certificate.pdf
 *   data/samples/ABC-Bank-Document.pdf
 *
 * The GST certificate deliberately spells the company name differently
 * ("ABC Technology Pvt Ltd" vs "ABC Technologies Pvt Ltd") so the AI
 * comparison step has a real mismatch to detect.
 *
 * Run: npm run samples
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const outDir = path.join(__dirname, '..', 'data', 'samples');
fs.mkdirSync(outDir, { recursive: true });

async function makePdf(fileName, title, lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.35, 0.35, 0.35);

  page.drawRectangle({ x: 40, y: 792, width: 515, height: 2, color: ink });
  page.drawText(title, { x: 40, y: 760, size: 18, font: bold, color: ink });
  page.drawText('Sample document generated for assessment demo purposes', {
    x: 40,
    y: 742,
    size: 9,
    font: regular,
    color: muted,
  });

  let y = 700;
  for (const line of lines) {
    if (line === '') {
      y -= 12;
      continue;
    }
    const isLabel = line.includes(':');
    page.drawText(line, { x: 40, y, size: 12, font: isLabel ? bold : regular, color: ink });
    y -= 22;
  }

  page.drawText('Authorised Signatory', { x: 40, y: 80, size: 11, font: regular, color: muted });
  page.drawLine({ start: { x: 40, y: 100 }, end: { x: 220, y: 100 }, thickness: 1, color: muted });

  const bytes = await doc.save();
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, bytes);
  console.log('created', filePath, `${(bytes.length / 1024).toFixed(1)} KB`);
}

async function main() {
  await makePdf('ABC-Registration-Certificate.pdf', 'CERTIFICATE OF INCORPORATION', [
    'Registrar of Companies, Karnataka',
    '',
    'Company Name: ABC Technologies Pvt Ltd',
    'Registration Number: U74999KA2016PTC091234',
    'CIN: U74999KA2016PTC091234',
    'Date of Incorporation: 12/04/2016',
    'Registered Address: 4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    '',
    'This is to certify that the above mentioned company is duly',
    'incorporated and exists as on the date of this certificate.',
  ]);

  await makePdf('ABC-GST-Certificate.pdf', 'GST REGISTRATION CERTIFICATE', [
    'Government of India - Goods and Services Tax Network',
    '',
    'Company Name: ABC Technology Pvt Ltd',
    'GSTIN: 29AABCA1234A1Z5',
    'Registration Number: U74999KA2016PTC091234',
    'Address: 4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    'Date of Registration: 01/07/2017',
    '',
    'Principal Place of Business: Bengaluru, Karnataka',
  ]);

  await makePdf('ABC-Bank-Document.pdf', 'BANK ACCOUNT VERIFICATION LETTER', [
    'HDFC Bank Ltd - Corporate Banking Branch: Koramangala, Bengaluru',
    '',
    'Company Name: ABC Technologies Pvt Ltd',
    'Account Number: 50100234567890',
    'IFSC Code: HDFC0001234',
    'Account Type: Current Account',
    'Address: 4th Floor, Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103, India',
    '',
    'The account mentioned above is active and in the name of the company.',
  ]);

  console.log('\nSample documents ready. Upload them from the Documents tab.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
