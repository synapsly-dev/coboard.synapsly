import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderMarkdown } from './markdown';

/**
 * Block-level coverage for the safe markdown renderer — grown for long-form
 * 资产 documents (headings, GFM tables, blockquotes, ordered lists, rules).
 */
describe('renderMarkdown blocks', () => {
  it('renders #–#### headings at their levels with inline markup', () => {
    render(
      <>{renderMarkdown('# 一级\n\n## 二级 **重点**\n\n### 三级\n\n#### 四级')}</>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '一级' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '二级 重点' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: '三级' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: '四级' })).toBeTruthy();
    // ##### is NOT a heading — stays a paragraph.
    const { container } = render(<>{renderMarkdown('##### 五级')}</>);
    expect(container.querySelector('h5')).toBeNull();
  });

  it('renders a GFM pipe table with header, rows and alignment', () => {
    render(
      <>
        {renderMarkdown(
          '| 模块 | 状态 | 说明 |\n|---|:---:|---|\n| 看板 | ✅ | 四列 **生命周期** |\n| 导出 | 🚧 | CSV |',
        )}
      </>,
    );
    const table = screen.getByRole('table');
    expect(table).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 body rows
    expect(screen.getByRole('columnheader', { name: '状态' }).className).toContain('text-center');
    expect(screen.getByText('生命周期')).toBeTruthy(); // inline bold inside cell
  });

  it('does NOT treat a prose line containing | as a table (no separator)', () => {
    const { container } = render(<>{renderMarkdown('甲 | 乙\n没有分隔行')}</>);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('甲 | 乙');
  });

  it('renders blockquotes, ordered lists and horizontal rules', () => {
    const { container } = render(
      <>
        {renderMarkdown(
          '> **一句话定位**：测试引用\n> 第二行\n\n---\n\n1. 第一项\n2. 第二项\n\n- 圆点项',
        )}
      </>,
    );
    const quote = container.querySelector('blockquote');
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain('一句话定位');
    expect(quote!.textContent).toContain('第二行');
    expect(container.querySelector('hr')).not.toBeNull();
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('ul')!.querySelectorAll('li')).toHaveLength(1);
  });

  it('never emits raw HTML (script content stays inert text)', () => {
    const { container } = render(
      <>{renderMarkdown('## <script>alert(1)</script>\n\n| a<b> | c |\n|---|---|\n| <img x> | d |')}</>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
