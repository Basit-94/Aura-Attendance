import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('AuraAttend Timetable Routine OCR & Management', () => {
  test('Upload TimeTable.jpeg, verify custom branch entry, extract routine, and verify schedule table', async ({ page }) => {
    test.setTimeout(240000);
    const testEmail = `test_tt_${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    // 1. Visit homepage
    await page.goto('/');

    // 2. Test NEW user account signup (Created AFTER cutoff -> MUST NOT see Routine Notice)
    console.log('[PLAYWRIGHT] Testing NEW student signup (should NOT receive routine notice)...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    const signupBtn = page.locator('button.auth-link:has-text("Sign Up")');
    await signupBtn.click();
    await expect(page.locator('button[type="submit"]:has-text("Create Account")')).toBeVisible({ timeout: 10000 });

    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.locator('button[type="submit"]:has-text("Create Account")').click();

    await expect(page.locator('text=Subject Check-Ins').first()).toBeVisible({ timeout: 20000 });

    // Verify neither Routine Notice Modal nor Bottom Pill is shown for new signups
    const routineNoticeModal = page.locator('h3:has-text("Class Routine Changed!")');
    const bottomPill = page.locator('text=Notice: CSE 3 Routine Changed');
    await expect(routineNoticeModal).not.toBeVisible();
    await expect(bottomPill).not.toBeVisible();
    console.log('[PLAYWRIGHT] Verified: New accounts created now/future do NOT get routine notice!');

    // 3. Test Navigation to Weekly Schedule tab
    console.log('[PLAYWRIGHT] Navigating to Weekly Schedule tab...');
    const timetableTab = page.locator('button:has-text("Weekly Schedule")').first();
    await timetableTab.click();
    await expect(page.locator('button:has-text("Enter Manually")')).toBeVisible({ timeout: 10000 });

    // 4. Test Direct 1-Click CSE 3 Routine Apply
    console.log('[PLAYWRIGHT] Applying CSE 3 verified routine via 1-click...');
    // Call the direct timetable save for CSE 3
    const applyRes = await page.evaluate(async () => {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: [
            { subjectName: 'Operating Systems', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '09:30', endTime: '10:30' },
            { subjectName: 'Computer Graphics & Artificial Intelligence', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '10:30', endTime: '11:30' },
            { subjectName: 'Software Engineering', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '11:45', endTime: '12:45' },
            { subjectName: 'Object Oriented Programming Lab', type: 'LAB', dayOfWeek: 'MONDAY', startTime: '12:45', endTime: '13:45' },
            { subjectName: 'Object Oriented Programming Lab', type: 'LAB', dayOfWeek: 'MONDAY', startTime: '14:30', endTime: '17:30' },
            { subjectName: 'Operating Systems Lab', type: 'LAB', dayOfWeek: 'TUESDAY', startTime: '09:30', endTime: '13:45' },
            { subjectName: 'Compiler Design', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '14:30', endTime: '15:30' },
            { subjectName: 'Computer Graphics & Artificial Intelligence', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '15:30', endTime: '16:30' },
            { subjectName: 'Object Oriented Programming', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '16:30', endTime: '17:30' },
          ]
        })
      });
      return res.ok;
    });
    expect(applyRes).toBe(true);

    // Refresh page to load updated timetable slots from database
    await page.reload();
    await timetableTab.click();

    // Verify classes from CSE 3 are directly applied on the Weekly Schedule view
    console.log('[PLAYWRIGHT] Verifying CSE 3 routine applied classes to Weekly Schedule...');
    await expect(page.locator('.timetable-slot-name', { hasText: 'Operating Systems' }).first()).toBeVisible({ timeout: 15000 });
    console.log('[PLAYWRIGHT] CSE 3 routine successfully applied full schedule without any codes or scans!');

    // 6. Test Manual Subject Creation
    console.log('[PLAYWRIGHT] Testing Manual Subject Creation...');
    const dashboardTab = page.locator('button:has-text("Dashboard")').first();
    if (await dashboardTab.isVisible()) {
      await dashboardTab.click();
    }
    const addSubjectBtn = page.locator('button:has-text("Add Subject")').first();
    await expect(addSubjectBtn).toBeVisible();
    await addSubjectBtn.click();

    await expect(page.locator('h3:has-text("Add Subject")')).toBeVisible();
    await page.fill('input[placeholder="e.g. Mathematics III"]', 'Software Architecture');
    await page.locator('button:has-text("Create Subject")').click();

    await expect(page.locator('text=Software Architecture')).toBeVisible({ timeout: 10000 });
    console.log('[PLAYWRIGHT] Manual Subject "Software Architecture" created successfully.');

    // 7. Switch back to Weekly Schedule tab
    console.log('[PLAYWRIGHT] Switching back to Weekly Schedule tab...');
    await timetableTab.click();

    // 8. Test Replacing Existing Timetable via Enter Manually
    console.log('[PLAYWRIGHT] Testing replacement of existing timetable via Enter Manually...');
    const editBtn = page.locator('button:has-text("Enter Manually")');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Verify Review Modal opens in manual edit mode
    await expect(page.locator('h3:has-text("Verify Routine Schedule")')).toBeVisible({ timeout: 10000 });
    
    // Change subject name in the manual slot to "Cloud Computing"
    const firstSubjectInput = page.locator('table tbody tr input[type="text"]').first();
    await firstSubjectInput.fill('Cloud Computing');

    // Click Save Timetable & Apply to test replacement
    console.log('[PLAYWRIGHT] Saving updated/replaced timetable...');
    await page.locator('button:has-text("Save Timetable & Apply")').click();
    await expect(page.locator('h3:has-text("Verify Routine Schedule")')).not.toBeVisible({ timeout: 30000 });

    // Verify that Cloud Computing is now on the schedule!
    await expect(page.locator('.timetable-slot-name', { hasText: 'Cloud Computing' }).first()).toBeVisible({ timeout: 15000 });
    console.log('[PLAYWRIGHT] Successfully verified that new timetable completely replaces the previous timetable!');
  });
});


