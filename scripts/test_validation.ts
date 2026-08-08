import { containsProfanity } from '../src/lib/validation';

const testCases = [
  // Profane emails (should return true)
  { email: 'basitchutiya@gmail.com', expected: true },
  { email: 'abdul@bhosda.com', expected: true },
  { email: 'chutiya123@gmail.com', expected: true },
  { email: 'bhosdike@stcet.ac.in', expected: true },
  { email: 'test.madarchod@gmail.com', expected: true },
  { email: 'somegand@domain.com', expected: true },

  // Safe emails (should return false)
  { email: 'gandhi@gmail.com', expected: false },
  { email: 'gandharv@stcet.ac.in', expected: false },
  { email: 'abdul.siddiqui@gmail.com', expected: false },
  { email: 'basit@gmail.com', expected: false },
  { email: 'student123@stcet.ac.in', expected: false }
];

let failed = false;
testCases.forEach(({ email, expected }) => {
  const result = containsProfanity(email);
  if (result !== expected) {
    console.error(`FAIL: containsProfanity('${email}') returned ${result}, expected ${expected}`);
    failed = true;
  } else {
    console.log(`PASS: '${email}' => ${result}`);
  }
});

if (failed) {
  process.exit(1);
} else {
  console.log("All validation tests passed successfully!");
}
