import { BOOK_ENV, createBooks, createGoogleAuth } from '../src/google.js';
import type { BookKind } from '../src/schema.js';

// Usage: npm run setup:google -- "<App name>"
const appName = process.argv[2] ?? 'ValetPay';
const books = await createBooks({ auth: createGoogleAuth(), folderId: process.env.DRIVE_FOLDER_ID, appName });

console.log('Spreadsheets created. Add these lines to .env:');
for (const [book, id] of Object.entries(books) as Array<[BookKind, string]>) console.log(`${BOOK_ENV[book]}=${id}`);
