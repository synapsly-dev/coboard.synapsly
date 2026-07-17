import { RichText, Text, View } from '@tarojs/components';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineMarkdown(source: string): string {
  const code: string[] = [];
  let value = escapeHtml(source).replace(/`([^`]+)`/g, (_match, body: string) => {
    const index = code.push(`<code class="md-inline-code">${body}</code>`) - 1;
    return `@@CODE${index}@@`;
  });
  value = value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="md-link" href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return value.replace(/@@CODE(\d+)@@/g, (_match, index: string) => code[Number(index)] ?? '');
}

function tableHtml(lines: string[]): string | null {
  if (lines.length < 2 || !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[1] ?? '')) return null;
  const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const head = cells(lines[0] ?? '');
  const body = lines.slice(2);
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((line) => `<tr>${cells(line).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) { index += 1; continue; }
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) { code.push(lines[index] ?? ''); index += 1; }
      index += 1;
      blocks.push(`<pre class="md-code"><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const tableLines = [line];
    let tableEnd = index + 1;
    while (tableEnd < lines.length && (lines[tableEnd] ?? '').includes('|') && (lines[tableEnd] ?? '').trim()) { tableLines.push(lines[tableEnd] ?? ''); tableEnd += 1; }
    const table = tableHtml(tableLines);
    if (table) { blocks.push(table); index = tableEnd; continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { const level = heading[1]?.length ?? 1; blocks.push(`<h${level} class="md-h${level}">${inlineMarkdown(heading[2] ?? '')}</h${level}>`); index += 1; continue; }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) { quote.push((lines[index] ?? '').replace(/^>\s?/, '')); index += 1; }
      blocks.push(`<blockquote class="md-quote">${quote.map(inlineMarkdown).join('<br/>')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) { items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, '')); index += 1; }
      blocks.push(`<ul class="md-list">${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) { items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, '')); index += 1; }
      blocks.push(`<ol class="md-list">${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) { blocks.push('<hr class="md-rule"/>'); index += 1; continue; }
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(#{1,4})\s+|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[index] ?? '')) { paragraph.push((lines[index] ?? '').trim()); index += 1; }
    blocks.push(`<p class="md-p">${paragraph.map(inlineMarkdown).join('<br/>')}</p>`);
  }
  return blocks.join('');
}

export function Markdown({ source, empty }: { source?: string | null; empty?: string }): JSX.Element {
  if (!source?.trim()) return <View className="markdown markdown--empty"><Text>{empty ?? '暂无内容'}</Text></View>;
  return <RichText className="markdown" nodes={markdownToHtml(source)} />;
}
