import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter-preact';
import { MisuPage } from './MisuPage.jsx';

describe('MisuPage', () => {
  it('lists data tools and nests club information under About', () => {
    render(<Router><MisuPage /></Router>);
    expect(screen.getByRole('link', { name: /Users/ }).getAttribute('href')).toBe('/app/misu/users');
    expect(screen.getByRole('link', { name: /About/ }).getAttribute('href')).toBe('/app/misu/about');
    expect(screen.getByRole('link', { name: /New meeting/ }).getAttribute('href')).toBe('/app/meetings/new');
  });
});
