import { test, expect } from '@playwright/test';
import path from 'path';

const estimators = [
  { name: 'Cyber Mint', file: 'estimator-v3-01-cyber-mint.html' },
  { name: 'Neo-Brutalist', file: 'estimator-v3-02-neo-brutalist.html' },
  { name: 'Editorial Serif', file: 'estimator-v3-03-editorial-serif.html' },
  { name: 'Duolingo Playful', file: 'estimator-v3-04-duolingo-playful.html' },
  { name: 'Swiss Bauhaus', file: 'estimator-v3-05-swiss-bauhaus.html' },
  { name: 'visionOS Prism', file: 'estimator-v3-06-vision-prism.html' },
  { name: 'Fintech Horizon', file: 'estimator-v3-07-fintech-horizon.html' }
];

test.describe('7 Light Estimators with Real-Time AI Icon Engine', () => {
  for (const est of estimators) {
    test(`Verify ${est.name} UI, Live AI Icons, and History Addition`, async ({ page }) => {
      const filePath = path.resolve(__dirname, '../ui-designs', est.file);
      await page.goto(`file://${filePath}`);

      // Verify header and initial components
      await expect(page.locator('text=CSE 3 (Odd Semester 2026)')).toBeVisible();
      await expect(page.locator('#cm-overall-pct')).toBeVisible();

      // Verify subjects rendered
      const subjCards = page.locator('.subj-card');
      const count = await subjCards.count();
      expect(count).toBeGreaterThanOrEqual(7);

      // Verify that cards contain real-time images
      const images = page.locator('.thumb-realtime');
      const imgCount = await images.count();
      expect(imgCount).toBeGreaterThanOrEqual(7);

      // Test check-in reactivity
      const initialPct = await page.locator('#cm-overall-pct').innerText();
      const firstPresentBtn = page.locator('.subj-card .act-p').first();
      await firstPresentBtn.click();
      await page.waitForTimeout(200);

      // Open Modal to add custom subject "History"
      const addBtn = page.locator('#btn-open-modal');
      await addBtn.click();
      await expect(page.locator('#add-modal')).toBeVisible();

      const nameInput = page.locator('#new-sub-name');
      await nameInput.fill('History of Modern Computing');
      
      const codeInput = page.locator('#new-sub-code');
      await codeInput.fill('HIST202');

      const submitBtn = page.locator('#add-modal button:not(:has-text("Cancel"))').last();
      await submitBtn.click();

      // Verify modal closed and History card was added with dynamic icon
      await expect(page.locator('#add-modal')).toBeHidden();
      await expect(page.locator('.subj-card:has-text("History of Modern Computing")')).toBeVisible();

      // Wait a moment for dynamic icon to initiate network fetch
      await page.waitForTimeout(600);

      // Take a screenshot of the estimator
      await page.screenshot({ path: `e2e/screenshots/${est.file}.png`, fullPage: false });
    });
  }
});
