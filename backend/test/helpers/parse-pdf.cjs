// Run Mozilla PDF.js in native Node, outside Jest's VM realm.
// The PDF bytes arrive on stdin; no application or environment configuration is loaded.
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(Buffer.concat(chunks)),
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    try {
      const document = await loading.promise;
      const texts = [];
      for (let page = 1; page <= document.numPages; page++) {
        const parsed = await document.getPage(page);
        const content = await parsed.getTextContent();
        texts.push(
          content.items
            .filter((item) => typeof item.str === 'string')
            .map((item) => item.str)
            .join(' '),
        );
        parsed.cleanup();
      }
      process.stdout.write(
        JSON.stringify({
          text: texts.join(' ').replace(/\s+/g, ' '),
          pages: document.numPages,
        }),
      );
    } finally {
      await loading.destroy();
    }
  } catch {
    process.stderr.write('PDF text parsing failed');
    process.exitCode = 1;
  }
});
