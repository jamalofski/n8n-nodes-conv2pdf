# Changelog

## 1.0.0 (2026-09-26)

First release.

- One operation per conv2pdf tool: Office documents, images and HEIC photos to PDF, HEIC to JPG, and for PDFs merge, extract pages, compress, protect, unlock, rotate, add a watermark or page numbers, convert to Word or to images.
- Each conversion reads the input file from a binary field, returns the result in a binary field and deletes the job from the conv2pdf server, unless told to keep it. Merge takes one file per input item or several binary fields of the same item.
- **Account > Get Quota** returns the plan, usage and limits of the API key. The credential test uses the same endpoint, which uses no conversion.
- Waits for `Retry-After` when the API rate-limits the key or its queue is full.
