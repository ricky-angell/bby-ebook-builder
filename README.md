# BBY E-Book Builder

A free tool from **Built By You Academy**. Write an e-book chapter by chapter and export it in one of two ways:

- **Option A: Printable PDF e-book**, in US Letter or A4, with a cover page, title and copyright pages, a clickable table of contents, page numbers, headers and footers, images and clickable links. It's for digital downloads you sell from Stan, Beacons or Etsy.
- **Option B: Amazon Kindle e-book**, a reflowable EPUB 3 with a clickable table of contents, chapter breaks, images with captions, links and metadata. It also makes a 1600 × 2560 Kindle cover JPG. Upload both to Kindle Direct Publishing.

The AI prompts are built in. Students copy them into their own ChatGPT or Claude account, so the tool needs no API keys and no subscription.

**Use it:** https://ricky-angell.github.io/bby-ebook-builder/

Everything runs in the browser. Projects are saved on the student's device (IndexedDB). Students can back up and import projects as `.bbybook.json` files. Nothing is uploaded.

Neither export is a KDP paperback interior. Paperbacks need a print PDF sized to a trim size and a separate wraparound cover.

## Files
- `index.html`: the page and styles
- `app.js`: the editor, the AI prompts, the PDF builder (pdf-lib), the EPUB builder (built-in zip writer) and storage
- `pdf-lib.min.js`, `fontkit.umd.min.js`: the PDF engine, reused from the BBY KDP Book Builder (MIT License)
- font files (`Poppins-*.ttf`, `Lora-*.ttf`): Poppins and Lora (SIL Open Font License 1.1, see `OFL-Lora.txt` and https://openfontlicense.org)

## Hosting
GitHub Pages serves the `main` branch root. It's free and needs no build step. To update the tool, edit the files and commit to `main`, and Pages republishes within a minute or two.
