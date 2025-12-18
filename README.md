# Document Monitoring System (local demo)

This is a simple client-side Document Monitoring System demo with:

- Login form (demo credentials: `admin` / `password`)
- Add documents with a control number, title, owner and status
- Search documents by control number
- Update status and delete documents
- Data persisted in browser `localStorage`

Files:

- `index.html` — main UI
- `styles.css` — styling
- `app.js` — application logic (localStorage)

How to run:

1. Open `index.html` in your browser (double-click or use your editor's Live Server).
3. Sign in with username `admin` and password `password`.
4. Add documents using "New Document".
5. Use the search box to find by control number, title, or owner.

WINS Status:

- Each document includes a `WINS Status` field with values: `Approved`, `Pending for Approve`, `Rejected`.
- The `New Document` form and CSV import/export include the `winsStatus` column.

CSV import/export:

-- Use the `Import CSV` file input to select a CSV file with header row. Expected headers: `controlNumber,title,owner,status,winsStatus,createdAt,updatedAt`.
- Use the `Export CSV` button to download current documents as `documents_export.csv`.
- When importing, existing documents with the same `controlNumber` are updated; new ones are added.
- Timestamps (`createdAt`/`updatedAt`) are Unix ms numbers; if missing the importer will set timestamps to the import time.

Template and duplicate behavior:

- Click the `Download Template` button to download `documents_template.csv` with example row and headers.
- When importing, if the CSV contains `controlNumber` values that already exist, you'll be prompted to either overwrite duplicates or skip them. The importer will report how many were added, updated, and skipped.

Notes:
- This is a front-end demo for local use only. No server or authentication back-end is included.
- To reset stored documents, clear the browser's Local Storage for this page.
