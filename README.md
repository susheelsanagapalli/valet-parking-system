# Valet Parking System

A cloud-hosted valet parking platform that replaces paper valet tickets with a digital ticket. It tracks every vehicle from drop-off to return and lets guests request their car from their phone.

The same product can be configured for paid parking operators, restaurants, hotels and event venues. Each client runs it under their own app name and branding, sets their own rules and roles, and keeps their data in their own Google Drive and Google Sheets.

## Repository layout

| Folder | What it is |
| --- | --- |
| [`docs/`](docs/SRS.md) | Software Requirements Specification |
| [`sheets-integration/`](sheets-integration/README.md) | Google Sheets and Excel data layer: schema, business rules, write queue, Excel template |
| `server/` | Express API: staff sign-in and roles, guest ticket endpoints, photo uploads |
| `web/` | React web app: attendant app, admin settings, payment verification and the guest ticket page |

## Run it locally

Requires Node.js 20 or later.

```bash
npm install
npm run build        # data layer, server and web app
npm start            # http://localhost:8080 with demo data in memory
```

Open `http://localhost:8080/login`. Until go-live, the sign-in page shows a **Test credentials** panel with every demo staff login (password `valet123` for all), a **Use** button to fill in the form, and the guest page link and handover PIN of each open ticket. The demo has three locations (a restaurant, a paid car park and a hotel) and starts with two parked cars.

The panel and demo data only exist in demo mode. With `NODE_ENV=production` they are switched off, and the server refuses to start if `SEED_DEMO=true`.

To work on the web app with live reload, run `npm run dev:server` and `npm run dev:web` in two terminals, then open `http://localhost:5173`.

To store data in Google Sheets instead of memory, copy `server/.env.example` to `server/.env`, set `STORE=google` and fill in the Google settings described in [sheets-integration/README.md](sheets-integration/README.md).

```bash
npm test             # data layer and API tests
```

## What works in this build

- Check-in with plate, key tag, optional guest details and vehicle photos; ticket number, QR code and a handover PIN shown once
- Parking spot capture by location settings: text, GPS with accuracy check and fallback, spot photo, zone/slot
- Guest ticket page: status and ETA, "I'll arrive in…" requests, cancel, pay by the location's payment QR with a transaction reference, "Car received, no damage" or damage report, rating
- Attendant queue with one task per attendant, VIP priority, ready at pickup, guest verification by QR scan or PIN, cash/card payment, signature on the attendant's phone, handover, re-park after a no-show
- Hotel in-and-out: hand over without closing, guest returned, end stay
- Supervisor verification of QR payments; platform admin approval of each location's payment QR
- Location settings editor and new locations from service profiles
- Staff sign-in with lockout after 5 failed attempts, built-in roles and permission checks on every API call

Not yet built: SMS/WhatsApp sending, user and custom role management screens (users come from a JSON file or the demo seed), photo and personal data deletion jobs, capacity alert emails, monthly spreadsheet rollover, and the abandoned vehicle process.

## Documents

| Document | Description |
| --- | --- |
| [Software Requirements Specification](docs/SRS.md) | Functional and non-functional requirements for v1.0, document version 1.6 (IEEE 830 / ISO/IEC/IEEE 29148 structure) |

## System at a glance

| Component | Purpose |
| --- | --- |
| Customer app (web/PWA, nothing to install) | Receive a digital ticket, request the car, pay, confirm handover, rate the service |
| Valet attendant app | Check vehicles in and out, record the parking spot (text, GPS, photo or slot), park and retrieve |
| Admin web portal | For each client: locations, settings, branding and app name, roles and users, merchants, tariffs, Google Drive integration, reports and incidents |
| Master admin panel | For the platform team: clients, platform roles, default settings and profiles, integration health |
| Backend services | REST API + WebSocket, business rules, permission checks, notifications, capacity alerts |
| Google Sheets and Drive | Data store in each client's chosen Google account: records in Sheets, reports and backups in Drive |
| Photo storage (optional) | Photos when a client enables them: Google Drive by default or object storage; deleted after handover |

## Key features (v1.0)

- White-label branding: each client sets its own app name, logo, colours and message sender name
- Service profiles (Paid parking, Restaurant, Hotel, Event venue, Custom) with settings at platform, client and location level
- Parking spot capture chosen per location: text field, GPS location and spot photo each off, optional or required, plus an optional zone/slot list
- Master admin panel and permission-based roles, with custom roles assigned per location
- Digital ticket with QR code, sent by SMS/WhatsApp at drop-off, or a printed ticket
- Vehicle check-in with key tag, custom fields and optional photos
- One-tap car retrieval with live status and ETA, or "I'll arrive in…" so the car is ready on arrival; parked car shown on a map for attendants
- Hotel in-and-out privileges on one ticket
- Guest no-damage confirmation at handover
- Payment by the client's own payment QR (verified manually) or cash, merchant validation (including free valet above a minimum bill), digital receipts
- Google Drive integration configurable per client: account, folder, naming, report export, backups, sharing
- Live dashboard, reports and audit trail
- Incident and damage management

## Status

Requirements baseline: **SRS v1.6** (October 2026). All open questions for v1.0 are resolved; decisions are listed in [section 8 of the SRS](docs/SRS.md#8-open-questions).
