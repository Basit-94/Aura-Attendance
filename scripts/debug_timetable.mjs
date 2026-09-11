import fs from 'fs';
import { parseTimetableImage } from '../src/lib/ocr.ts';

async function check(stream, group) {
  const buf = fs.readFileSync('TimeTable.jpeg');
  console.log(`=== CHECKING STREAM: "${stream}" | GROUP: "${group}" ===`);
  const res = await parseTimetableImage(buf, 'image/jpeg', stream, group);
  console.log(`Total slots extracted: ${res.length}\n`);
  for (const c of res) {
    console.log(`${c.dayOfWeek.padEnd(9)} | ${c.startTime} - ${c.endTime} | [${c.type.padEnd(7)}] ${c.subjectName}`);
  }
}

check(process.argv[2] || 'CSE I', process.argv[3] || 'Group A').catch(console.error);
