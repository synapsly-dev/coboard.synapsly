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
 * Supported subset (intentionally small):
 *  - paragraphs separated by blank lines, single newlines → <br/>
 *  - fenced code blocks ```...```
 *  - inline `code`, **bold**, *italic*
 *  - links [text](http(s)://… | mailto:…) — other protocols are dropped
 *  - bullet lists (lines starting with - or *)
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

/**
 * Render a full markdown body to safe React nodes. Block-level handling: code
 * fences, bullet lists, and paragraphs.
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
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trimStart().startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]!)
    ) {
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
