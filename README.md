# Valet Parking System

A cloud-hosted valet parking platform that replaces paper valet tickets with a digital ticket. It tracks every vehicle from drop-off to return and lets guests request their car from their phone.

The same product can be configured for paid parking operators, restaurants, hotels and event venues. Each client's data is stored in their own Google Drive and Google Sheets.

This repository currently holds the project's requirements. Source code will be added as development starts.

## Documents

| Document | Description |
| --- | --- |
| [Software Requirements Specification](docs/SRS.md) | Functional and non-functional requirements for v1.0, document version 1.3 (IEEE 830 / ISO/IEC/IEEE 29148 structure) |

## System at a glance

| Component | Purpose |
| --- | --- |
| Customer app (web/PWA) | Receive a digital ticket, request the car, pay, rate the service |
| Valet attendant app | Check vehicles in and out, record damage photos, park and retrieve |
| Admin web portal | Manage locations, service profiles and settings, staff, tariffs, merchants, reports and incidents |
| Backend services | REST API + WebSocket, business rules, notifications, payment integration |
| Google Sheets and Drive | Data store in each client's own Google account: records in Sheets, reports and backups in Drive |
| Photo storage (optional) | Vehicle photos when a client enables them: Google Drive by default or object storage; deleted after handover |

## Key features (v1.0)

- Service profiles (Paid parking, Restaurant, Hotel, Event venue, Custom) with per-location rules set from the admin panel
- Digital ticket with QR code, sent by SMS/WhatsApp at drop-off, or a printed ticket
- Vehicle check-in with key tag, parking spot (typed in, or zone/slot), custom fields and optional photos
- Guest no-damage confirmation at handover
- One-tap car retrieval with live status and ETA
- Task queue and dispatch for attendants
- Online and on-site payment, merchant validation (including free valet above a minimum bill), digital receipts
- Live occupancy dashboard, reports and audit trail
- Incident and damage management

## Status

Requirements baseline: **SRS v1.3** (October 2026). Open questions are listed in [section 8 of the SRS](docs/SRS.md#8-open-questions).
