import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

async function testPDFProcessing() {
  try {
    console.log('🔍 Reading PDF file...');
    const pdfPath = './test_knitting_pattern.pdf';
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    
    console.log(`✅ PDF loaded: ${data.length} bytes`);
    
    console.log('🔍 Opening PDF document...');
    getDocument.globalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const pdf = await getDocument({ data }).promise;
    
    console.log(`✅ PDF opened: ${pdf.numPages} page(s)`);
    
    console.log('🔍 Getting first page...');
    const page = await pdf.getPage(1);
    
    console.log(`✅ Page retrieved`);
    
    console.log('🔍 Extracting text...');
    const textContent = await page.getTextContent();
    const text = textContent.items.filter(item => 'str' in item).map(item => item.str).join(' ');
    
    console.log(`✅ Text extracted: ${text.substring(0, 100)}...`);
    console.log(`✅ Text length: ${text.length} characters`);
    
    await pdf.destroy();
    console.log('✅ PDF processing completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ PDF processing failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

testPDFProcessing().then(success => {
  process.exit(success ? 0 : 1);
});
