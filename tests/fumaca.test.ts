import { h } from 'preact';
import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('fumaça', () => {
  it('App renderiza a casca com o título da página', () => {
    render(h(App, null));
    expect(screen.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeTruthy();
  });

  it('testes rodam no fuso Europe/Lisbon', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Lisbon');
    // 2026-11-05 12:20 UTC e 12:20 em Lisboa coincidem (horário de inverno, UTC+0)
    expect(new Date(2026, 10, 5, 12, 20).toISOString()).toBe('2026-11-05T12:20:00.000Z');
  });
});
