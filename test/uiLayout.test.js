import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../client/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client/styles.css', import.meta.url), 'utf8');

describe('responsive chess UI layout', () => {
  it('retains the explicit discovery-card destinations', () => {
    expect(app).toContain("'opening-explorer': function ()");
    expect(app).toContain("'tournament-setup': function ()");
    expect(html).toContain('data-target="setup"');
    expect(html).toContain('data-target="spectator"');
  });

  it('keeps the primary home action prominent without removing secondary features', () => {
    const primaryRules = [...css.matchAll(/#main-menu \.menu-btn\.primary \{[^}]*\}/g)].map((m) => m[0]);
    const spanningRule = primaryRules.find((rule) => rule.includes('grid-column: 1 / -1;'));
    expect(spanningRule, 'expected a #main-menu .menu-btn.primary rule that spans the full grid row').toBeDefined();
    expect(html).toContain('id="home-online-play-btn"');
    expect(html).toContain('id="home-tournament-btn"');
    expect(html).toContain('id="settings-btn"');
  });

  it('keeps the home screen grouped and gives section headings clear separation', () => {
    expect(html).toContain('id="play-heading"');
    expect(html).toContain('aria-labelledby="learn-heading"');
    expect(html).toContain('aria-labelledby="watch-heading"');
    expect(css).toContain('#main-menu .home-section-title { padding-bottom: 8px; border-bottom: 1px solid var(--border); }');
    const targets = [...html.matchAll(/data-target="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('stacks the active game before medium screens squeeze the board and sidebar', () => {
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('#game .game-layout { grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('calc((100vw - 84px) / 8)');
    expect(css).toContain('#game .side { width: min(100%, 560px); }');
  });
});
