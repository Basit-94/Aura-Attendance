/**
 * Validates whether an email address contains profane, abusive, or vulgar language.
 * Covers common English and Hinglish (Hindi/Urdu in Latin script) profanity.
 */
export function containsProfanity(email: string): boolean {
  const normalized = email.toLowerCase().trim();

  // List of specific profane/abusive substrings
  const specificProfanities = [
    'chutiya',
    'bhosda',
    'bhosdike',
    'bhosdi',
    'madarchod',
    'behenchod',
    'behnchod',
    'harami',
    'randi',
    'fuck',
    'bitch',
    'asshole',
    'cunt',
    'sisterfucker',
    'motherfucker',
    'lund'
  ];

  // Check if any specific profane word is present
  if (specificProfanities.some(word => normalized.includes(word))) {
    return true;
  }

  // Check 'gand' but exclude 'gandh' (to avoid blocking names like Gandhi or Gandhar)
  if (normalized.includes('gand') && !normalized.includes('gandh')) {
    return true;
  }

  return false;
}
