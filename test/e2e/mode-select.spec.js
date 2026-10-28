// @ts-check
const { test, expect } = require('@playwright/test');

test('choosing Single-Player vs AI in the Mode dropdown shows difficulty and colour rows', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.click('#new-game-btn');
  await expect(page.locator('#setup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#ai-options')).toHaveClass(/hidden/);

  await page.locator('#mode-select').selectOption('ai');

  await expect(page.locator('#ai-options')).not.toHaveClass(/hidden/);
  await expect(page.locator('#color-options')).not.toHaveClass(/hidden/);
});

test('bot card shows difficulty and colour rows', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.click('#home-bots-btn');
  await expect(page.locator('#ai-options')).not.toHaveClass(/hidden/);
  await expect(page.locator('#color-options')).not.toHaveClass(/hidden/);
});

test('hotseat game applies a legal move and advances the turn', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.click('#new-game-btn');
  await page.locator('#mode-select').selectOption('2p');
  await page.click('#start-btn');
  await expect(page.locator('#game')).not.toHaveClass(/hidden/);
  await page.locator('#sq-e2').click();
  await page.locator('#sq-e4').click();
  await expect(page.locator('#status')).toHaveText('Black to move');
  await expect(page.locator('#move-list')).toContainText('e4');
});

test('AI game responds after the human makes a legal move', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.click('#new-game-btn');
  await page.locator('#mode-select').selectOption('ai');
  await page.locator('#difficulty-select').selectOption('easy');
  await page.locator('#color-select').selectOption('white');
  await page.click('#start-btn');
  await expect(page.locator('#game')).not.toHaveClass(/hidden/);
  await page.locator('#sq-e2').click();
  await page.locator('#sq-e4').click();
  await expect(page.locator('#move-list li')).toContainText(/1\. e4\s+\S+/, { timeout: 10000 });
  await expect(page.locator('#status')).toContainText('White to move');
});
