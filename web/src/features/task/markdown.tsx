import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, SAFE markdown renderer (§8 — "评论 markdown 渲染做 XSS 净化").
 *
 * Rather than parse HTML and sanitize it, we never produce raw HTML at all: the
 * source text is tokenized and emitted as React elements. Because React escapes
 * all text content by default and we only ever create a fixed, known set of
 * elements (never `dangerouslySetInnerHTML`), arbitrary markup in user input is
 * rendered inert — the safest possible posture for v1.
 *
 * Supported subset (grown for long-form 资产 documents, still fixed & safe):
 *  - paragraphs separated by blank lines, single newlines → <br/>
 *  - headings # … #### (mapped onto the app's type scale)
 *  - GFM pipe tables (header + |---| separator; :--- / :---: / ---: alignment)
 *  - blockquotes (> …), horizontal rules (--- / ***)
 *  - fenced code blocks ```...```
 *  - inline `code`, **bold**, *italic*
 *  - links [text](http(s)://… | mailto:…) — other protocols are dropped
 *  - bullet lists (- / *) and ordered lists (1. / 1、 / 1))
 *  - @mentions — highlighted by a regex (no name lookup needed)
 */

/** Only these URL schemes are allowed in links; everything else is dropped. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url.trim());
}

/**
 * Render inline markup within a single line of text. Handles `code`, **bold**,
 * *italic*, links, and @mentions. Order matters: inline code first (so its
 * contents aren't re-parsed), then links, then emphasis, then mentions.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize into code spans vs. plain runs first; code spans are opaque.
  const codeSplit = text.split(/(`[^`]+`)/g);
  codeSplit.forEach((chunk, ci) => {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${ci}`}
          className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {chunk.slice(1, -1)}
        </code>,
      );
      return;
    }
    renderInlineNonCode(chunk, `${keyPrefix}-${ci}`, nodes);
  });
  return nodes;
}

function renderInlineNonCode(text: string, keyPrefix: string, out: ReactNode[]): void {
  // Links: [label](url)
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = linkRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      renderEmphasisAndMentions(text.slice(lastIndex, match.index), `${keyPrefix}-t${i}`, out);
    }
    const [, label, url] = match;
    if (url && isSafeUrl(url)) {
      out.push(
        <a
          key={`${keyPrefix}-l${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary underline underline-offset-2 hover:no-underline"
        >
          {label}
        </a>,
      );
    } else {
      // Unsafe/unknown scheme — render the label as plain text, drop the href.
      out.push(<Fragment key={`${keyPrefix}-l${i}`}>{label}</Fragment>);
    }
    lastIndex = linkRe.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) {
    renderEmphasisAndMentions(text.slice(lastIndex), `${keyPrefix}-end`, out);
  }
}

function renderEmphasisAndMentions(text: string, keyPrefix: string, out: ReactNode[]): void {
  // **bold** and *italic* and @mentions, processed via a combined tokenizer.
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|@[\w一-龥-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(
        <Fragment key={`${keyPrefix}-p${i}`}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
    }
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      out.push(
        <em key={`${keyPrefix}-i${i}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      // @mention
      out.push(
        <span
          key={`${keyPrefix}-m${i}`}
          className="rounded bg-primary/10 px-1 font-medium text-primary"
        >
          {token}
        </span>,
      );
    }
    lastIndex = re.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) {
    out.push(<Fragment key={`${keyPrefix}-pend`}>{text.slice(lastIndex)}</Fragment>);
  }
}

/** #… heading line → level (1-4) + text, or null. */
function parseHeading(line: string): { level: number; text: string } | null {
  const m = /^\s{0,3}(#{1,4})\s+(.*)$/.exec(line);
  if (!m) return null;
  return { level: m[1]!.length, text: m[2]!.trim() };
}

/** App-scale classes per heading level (documents live inside text-sm bodies). */
const HEADING_CLASS: Record<number, string> = {
  1: 'text-lg font-semibold leading-snug',
  2: 'mt-1 border-b border-border pb-1 text-base font-semibold leading-snug',
  3: 'text-sm font-semibold leading-snug',
  4: 'text-sm font-medium leading-snug text-muted-foreground',
};

/** A GFM table row `| a | b |` → trimmed cells (boundary pipes dropped). */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/** Is this a `|---|:---:|` header separator? Returns per-column alignment. */
function parseTableSeparator(line: string): Array<'left' | 'center' | 'right'> | null {
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line) || !line.includes('-')) return null;
  const cells = parseTableRow(line);
  if (cells.length === 0) return null;
  const aligns: Array<'left' | 'center' | 'right'> = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    aligns.push(
      cell.startsWith(':') && cell.endsWith(':')
        ? 'center'
        : cell.endsWith(':')
          ? 'right'
          : 'left',
    );
  }
  return aligns;
}

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/** Lines that terminate a paragraph because a block construct starts. */
function isBlockStart(line: string): boolean {
  return (
    line.trimStart().startsWith('```') ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.、)]\s+/.test(line) ||
    parseHeading(line) !== null ||
    /^\s*>/.test(line) ||
    /^\s*(-{3,}|\*{3,})\s*$/.test(line) ||
    line.includes('|')
  );
}

/**
 * Render a full markdown body to safe React nodes. Block-level handling: code
 * fences, headings, tables, blockquotes, rules, bullet/ordered lists, paragraphs.
 */
export function renderMarkdown(source: string): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  let blockKey = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block.
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      i += 1; // consume closing fence (if present)
      blocks.push(
        <pre
          key={`blk-${blockKey++}`}
          className="scrollbar-thin overflow-x-auto rounded-md bg-secondary p-3 text-xs"
        >
          <code className="font-mono text-foreground">{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading # … ####.
    const heading = parseHeading(line);
    if (heading) {
      const Tag = `h${heading.level}` as 'h1' | 'h2' | 'h3' | 'h4';
      blocks.push(
        <Tag key={`blk-${blockKey++}`} className={HEADING_CLASS[heading.level]}>
          {renderInline(heading.text, `blk-${blockKey}-h`)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    // Horizontal rule (checked before lists: `---` has no trailing content).
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`blk-${blockKey++}`} className="border-border" />);
      i += 1;
      continue;
    }

    // Blockquote: consecutive `>` lines become one quote block.
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`blk-${blockKey++}`}
          className="border-l-2 border-primary/40 pl-3 text-muted-foreground"
        >
          {quoteLines.map((ql, idx) => (
            <Fragment key={idx}>
              {idx > 0 && <br />}
              {renderInline(ql, `blk-${blockKey}-q${idx}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    // GFM table: a header row containing `|` followed by a `|---|` separator.
    if (line.includes('|') && i + 1 < lines.length) {
      const aligns = parseTableSeparator(lines[i + 1]!);
      if (aligns) {
        const header = parseTableRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
          rows.push(parseTableRow(lines[i]!));
          i += 1;
        }
        const alignAt = (col: number): string => ALIGN_CLASS[aligns[col] ?? 'left'];
        blocks.push(
          <div key={`blk-${blockKey++}`} className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[24rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {header.map((cell, ci) => (
                    <th
                      key={ci}
                      scope="col"
                      className={`px-2 py-1.5 align-top font-semibold text-foreground ${alignAt(ci)}`}
                    >
                      {renderInline(cell, `blk-${blockKey}-th${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/60 last:border-0">
                    {header.map((_, ci) => (
                      <td key={ci} className={`px-2 py-1.5 align-top ${alignAt(ci)}`}>
                        {renderInline(row[ci] ?? '', `blk-${blockKey}-r${ri}c${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    // Ordered list (1. / 1、 / 1)).
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+[.、)]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`blk-${blockKey++}`} className="ml-5 list-decimal space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `blk-${blockKey}-oli${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Bullet list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`blk-${blockKey++}`} className="ml-4 list-disc space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `blk-${blockKey}-li${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Blank line — skip (paragraph separator).
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines.
    const paraLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines[i]!)) {
      paraLines.push(lines[i]!);
      i += 1;
    }
    // Defensive: a lone block-start line reaching here (e.g. `|`-line whose
    // separator never came) must still consume ONE line or we'd loop forever.
    if (paraLines.length === 0) {
      paraLines.push(lines[i]!);
      i += 1;
    }
    blocks.push(
      <p key={`blk-${blockKey++}`} className="whitespace-pre-wrap leading-relaxed">
        {paraLines.map((pl, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl, `blk-${blockKey}-p${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-3 text-sm text-foreground">{blocks}</div>;
}
