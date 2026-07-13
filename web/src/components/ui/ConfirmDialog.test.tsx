import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';

/**
 * The promise-based confirm replacing native window.confirm: 确定 resolves true,
 * 取消 / escape resolves false, and the passed copy renders in the themed dialog.
 */
function Harness({ onResult }: { onResult: (v: boolean) => void }): JSX.Element {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        onResult(await confirm({ title: '删除任务', description: '确定删除这个任务？' }));
      }}
    >
      触发
    </button>
  );
}

function renderHarness(): boolean[] {
  const results: boolean[] = [];
  render(
    <ConfirmProvider>
      <Harness onResult={(v) => results.push(v)} />
    </ConfirmProvider>,
  );
  return results;
}

describe('ConfirmProvider / useConfirm', () => {
  it('renders the copy and resolves true when confirmed', async () => {
    const results = renderHarness();
    fireEvent.click(screen.getByText('触发'));

    // Themed dialog shows the passed title + description (not a native box).
    expect(await screen.findByText('删除任务')).toBeTruthy();
    expect(screen.getByText('确定删除这个任务？')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('resolves false when cancelled', async () => {
    const results = renderHarness();
    fireEvent.click(screen.getByText('触发'));
    await screen.findByText('删除任务');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(results).toEqual([false]));
  });

  it('useConfirm without a provider throws', () => {
    // Silence the expected React error boundary noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bare(): JSX.Element {
      useConfirm();
      return <span />;
    }
    expect(() => render(<Bare />)).toThrow(/ConfirmProvider/);
    spy.mockRestore();
  });
});
