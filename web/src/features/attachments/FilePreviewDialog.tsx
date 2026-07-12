import { Download } from 'lucide-react';
import { isImageMime } from 'shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui';

/**
 * In-app file preview (§7.2), shared by task / idea / comment attachments.
 * Renders a whitelisted file inline: images in an <img> lightbox, PDFs in an
 * embedded <iframe>. Both fetch the bytes with `?inline=1` (Content-Disposition:
 * inline + nosniff). A 下载 link is always offered as a fallback. Non-previewable
 * files never open this dialog. URL construction stays with the caller — each
 * owner type has its own routes.
 */

export interface PreviewableFile {
  filename: string;
  mime: string;
}

export function FilePreviewDialog({
  file,
  previewSrc,
  downloadUrl,
  open,
  onOpenChange,
}: {
  file: PreviewableFile | null;
  /** `?inline=1` URL used as the <img>/<iframe> src. */
  previewSrc: string;
  downloadUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const isImage = file ? isImageMime(file.mime) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all pr-8 text-base font-medium">
            {file?.filename ?? '预览'}
          </DialogTitle>
        </DialogHeader>

        {file && (
          <>
            {isImage ? (
              <div className="flex max-h-[72vh] min-h-[12rem] items-center justify-center overflow-auto rounded-md bg-secondary/40">
                <img
                  src={previewSrc}
                  alt={file.filename}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              </div>
            ) : (
              // PDF (the only other whitelisted preview type) — the iframe owns its
              // own scroll, so no competing outer overflow wrapper.
              <iframe
                src={previewSrc}
                title={file.filename}
                className="h-[80vh] w-full rounded-md border-0 bg-secondary/40 sm:h-[70vh]"
              />
            )}
            <div className="flex justify-end">
              <a
                href={downloadUrl}
                download={file.filename}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Download className="h-4 w-4" aria-hidden />
                下载
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
