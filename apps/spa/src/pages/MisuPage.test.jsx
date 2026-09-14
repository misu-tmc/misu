import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter-preact';
import { MisuPage } from './MisuPage.jsx';
import { authUser } from '../state/auth.js';

describe('MisuPage', () => {
  it('lists data tools and nests club information under About', () => {
    authUser.value = { id: 7, role: 'editor' };
    render(<Router><MisuPage /></Router>);
    expect(screen.getByRole('link', { name: /Users/ }).getAttribute('href')).toBe('/app/misu/users');
    expect(screen.getByRole('link', { name: /^Meetings / }).getAttribute('href')).toBe('/app/misu/meetings');
    expect(screen.getByRole('link', { name: /About/ }).getAttribute('href')).toBe('/app/misu/about');
    expect(screen.getByRole('link', { name: /New meeting/ }).getAttribute('href')).toBe('/app/meetings/new');
  });
});
