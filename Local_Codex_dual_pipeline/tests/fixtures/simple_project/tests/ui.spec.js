const path = require('path');
const { test, expect } = require('@playwright/test');

const toFileUrl = (relativePath) => {
  const absolutePath = path.resolve(__dirname, relativePath);
  return `file:///${absolutePath.replace(/\\/g, '/')}`;
};

test.beforeEach(async ({ page }) => {
  await page.goto(toFileUrl('../public/index.html'));
});

test('happy path builds a scenario from the prompt', async ({ page }) => {
  await page.getByLabel('Test prompt').fill('Verify the sign-up form accepts a valid email.');
  await page.getByRole('button', { name: 'Run test' }).click();

  await expect(page.locator('#error')).toBeHidden();
  await expect(page.getByTestId('scenario-output')).toContainText('Scenario ready:');
  await expect(page.getByTestId('scenario-output')).toContainText('Verify the sign-up form');
  await expect(page.locator('#steps li')).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('3 steps ready');
});

test('shows an error when the prompt is empty', async ({ page }) => {
  await page.getByRole('button', { name: 'Run test' }).click();

  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toHaveText('Please enter a UI test prompt.');
  await expect(page.getByTestId('scenario-output')).toHaveText('');
  await expect(page.locator('#steps li')).toHaveCount(0);
});

test('supports keyboard navigation and labeling', async ({ page }) => {
  const promptField = page.getByLabel('Test prompt');
  await promptField.focus();
  await expect(promptField).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Run test' })).toBeFocused();
});
