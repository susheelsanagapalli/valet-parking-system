# Sheets integration

Google Sheets and Excel data layer for the Valet Parking System, built to [SRS v1.6](../docs/SRS.md). It replaces the Supabase tables with spreadsheets in the operator's own Google account (SRS 2.5, 6.4) and adds an Excel template, export and import.

## What's in it

| Part | File | SRS |
| --- | --- | --- |
| Tab and column definitions for every spreadsheet | `src/schema.ts` | 6.1, 6.4 |
| Business rules: check-in, parking spot capture, arrival-time requests, dispatch, QR/cash payments, handover confirmation, in-and-out, incidents, audit log | `src/ValetSheetsRepository.ts` | 3.2–3.9 |
| Settings catalogue and service profile defaults | `src/settings.ts` | 2.7 |
| Google Sheets storage with retries, header checks, dropdowns and protected tabs | `src/store/GoogleSheetStore.ts` | FR-DATA-02 |
| Batched write queue that survives restarts | `src/WriteQueue.ts` | NFR-AVL-03 |
| Per-key locks for task acceptance, slots and ticket numbers | `src/KeyedMutex.ts` | FR-TASK-02, FR-PARK-04 |
| Excel template, export and import | `src/excel.ts`, `templates/Valet-Data-Template.xlsx` | FR-ADM-04 |
| Google auth (operator OAuth or service account) and spreadsheet creation | `src/google.ts` | FR-DATA-01, NFR-SEC-05 |

All reads come from an in-memory cache that is loaded at start-up; writes update the cache at once and are sent to Google Sheets in batches.

## Corrections to the Supabase schema

| Supabase schema | Changed to | Reason |
| --- | --- | --- |
| `handover_pin` stored as plain digits | `handover_pin_hash` (HMAC with a backend-only key) | NFR-SEC-01: PINs never stored or shown |
| `guest_mobile`, `guest_name`, plate and vehicle details on `tickets` | `Customers` and `Vehicles` tabs in the monthly Guest data book; tickets hold ids only | NFR-PRIV-02: personal data deleted whole at end of retention |
| `payment_status`, `payment_method` on `tickets` | `Payments` tab with method, transaction reference and pending/verified/rejected status | FR-PAY-15, FR-PAY-16: QR payments verified manually |
| `handover_confirmation`, `handover_method` columns | `HandoverConfirmations` tab | FR-OUT-13 |
| In-and-out flag only | `TicketMovements` tab for each exit and return | FR-OUT-16, FR-OUT-17 |
| `settings` JSON on `locations` | Versioned `LocationSettings` tab; tickets keep `settings_version` | FR-CFG-06 |
| No arrival-time support | `scheduled_for` on tickets, `release_at` on tasks | FR-OUT-15 |
| No photos or audit log | `Photos` and `AuditLog` tabs | FR-DATA-08, FR-ADM-05 |
| Row-level security open to `anon` | No direct client access; the backend checks permissions | 2.5, NFR-SEC-06 |

## Spreadsheet layout

| Book (spreadsheet) | Tabs |
| --- | --- |
| Config | Locations, LocationSettings |
| Transactions | Tickets, Tasks, Payments, HandoverConfirmations, TicketMovements, Photos, Incidents |
| Guest data | Customers, Vehicles |
| Audit log | AuditLog |

Row 1 of every tab holds the column keys. The `Columns` tab of the Excel template lists every column with its type, allowed values and description.

## Commands

```bash
npm install
npm run build          # compile to dist/
npm test               # 31 tests
npm run typecheck
npm run template       # regenerate templates/Valet-Data-Template.xlsx
```

### Connect Google Sheets

1. Copy `.env.example` to `.env` and fill in either the OAuth client and refresh token for the operator's Google account (scope `drive.file`) or a service account key file. With a service account, set `DRIVE_FOLDER_ID` to a folder in a shared drive.
2. Set `PIN_HMAC_SECRET` to a long random value.
3. Run `npm run setup:google -- "Your App Name"`. It creates the four spreadsheets with all tabs, headers and dropdowns, and prints the `SHEET_*_ID` lines to add to `.env`.

### Excel

```bash
npm run export:excel -- exports/backup.xlsx          # all Google Sheets data to one workbook
npm run import:excel -- data.xlsx --dry-run          # validate a filled-in template
npm run import:excel -- data.xlsx                    # add its rows to Google Sheets
```

Import checks every row against the schema and imports nothing if any row is invalid. Rows whose id starts with `example-` are skipped, and rows whose id already exists are left unchanged.

## Using it from the app

```ts
import { GoogleSheetStore, ValetSheetsRepository, booksFromEnv, createGoogleAuth, sheetsClient } from '@valet/sheets-integration';

const store = new GoogleSheetStore({ sheets: sheetsClient(createGoogleAuth()), books: booksFromEnv() });
const repo = new ValetSheetsRepository({ store, pinSecret: process.env.PIN_HMAC_SECRET!, persistPath: 'valet.queue.json' });
await repo.load();

const { ticket, handoverPin } = await repo.checkIn({ locationId, attendantId, plateNumber: 'KA01AB1234', keyTag: 'K-17' });
// send handoverPin to the guest by SMS; it is not stored
await repo.recordParkingSpot(ticket.id, { attendantId, text: 'Opposite gate 3', gps: { lat, lng, accuracyM } });
repo.requestRetrieval(ticket.id, { requestedBy: 'guest', arriveInMinutes: 10 });
```

Run it in the backend only: it holds the Google credentials and the PIN secret, which must never reach the browser.

## Not covered yet

- **Monthly rollover** (FR-DATA-03): the package works with one spreadsheet per book. Starting new Transactions, Guest data and Audit log books each month is not automated yet.
- **One backend instance**: the locks and cache live in one process. Running several instances needs a shared lock and cache service.
- **Not tested against a live Google account**: the Sheets store is tested against a fake of the Sheets API. Run `setup:google` with real credentials to check it end to end.
- **Out of scope for this package**: roles and permissions, photo file uploads and deletion jobs, SMS sending, capacity alert emails, and the abandoned vehicle process. These belong in the backend that uses this package.
