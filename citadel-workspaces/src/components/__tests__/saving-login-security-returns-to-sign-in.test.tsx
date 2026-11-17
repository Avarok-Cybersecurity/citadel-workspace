/**
 * Saving the sign-in's security settings returns to the sign-in form.
 *
 * Measured live: Advanced options → Security Settings "Configure" → Save left the
 * settings panel open forever. Login passed onComplete, and SecuritySettings calls
 * onComplete INSTEAD of onNext -- the only callback that closed the panel -- so Save
 * stored the values and stranded the user; only Back led out. Rendered for real.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Login } from '../Login';

describe('the sign-in security settings', () => {
  it('closes on Save and shows Sign In again', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <MemoryRouter>
            <Login onNext={(): void => {}} onCancel={(): void => {}} initialUsername="pat" />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText(/advanced options/i));
    fireEvent.click(await screen.findByRole('button', { name: /configure/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor((): void => { expect(screen.getByTestId('login-submit')).toBeInTheDocument(); });
    expect(screen.queryByText('Configure security settings for your workspace connection')).toBeNull();
  });
});
