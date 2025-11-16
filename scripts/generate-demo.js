import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsPDF } from 'jspdf';

async function main() {
  const samplePath = path.resolve('sample/sample-session.json');
  const raw = await readFile(samplePath, 'utf-8');
  const session = JSON.parse(raw);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFontSize(20);
  doc.text('Sample Session Summary', 40, 60);
  doc.setFontSize(12);
  let cursorY = 100;
  session.events.forEach((event, index) => {
    const lines = [`${index + 1}. ${event.type} @ ${event.timestamp}`, `URL: ${event.url}`];
    if (event.typedText) {
      lines.push(`Typed: ${event.typedText}`);
    }
    doc.text(lines, 40, cursorY);
    cursorY += 50;
    if (cursorY > 720) {
      doc.addPage();
      cursorY = 60;
    }
  });

  const output = doc.output('arraybuffer');
  await writeFile(path.resolve('sample/sample-session.pdf'), Buffer.from(output));
  console.log('Demo PDF generated at sample/sample-session.pdf');
}

main().catch((error) => {
  console.error('Failed to generate demo PDF', error);
  process.exit(1);
});

