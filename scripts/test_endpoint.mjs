import fs from 'fs';

async function test() {
  const buf = fs.readFileSync('TimeTable.jpeg');
  const blob = new Blob([buf], { type: 'image/jpeg' });
  const form = new FormData();
  form.append('file', blob, 'TimeTable.jpeg');
  form.append('branchSection', 'CSE 3');
  form.append('labGroup', 'Group A');

  console.log('Sending request to http://localhost:3000/api/timetable/parse...');
  const t0 = Date.now();
  const res = await fetch('http://localhost:3000/api/timetable/parse', {
    method: 'POST',
    body: form,
  });
  console.log('Status:', res.status, 'Time:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const text = await res.text();
  console.log('Response:', text.slice(0, 400));
}

test().catch(console.error);
