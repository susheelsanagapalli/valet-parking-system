# Valet Parking System

A cloud-hosted valet parking platform that replaces paper valet tickets with a digital ticket. It tracks every vehicle from drop-off to return and lets guests request their car from their phone.

The same product can be configured for paid parking operators, restaurants, hotels and event venues. Each client runs it under their own app name and branding, sets their own rules and roles, and keeps their data in their own Google Drive and Google Sheets.

This repository currently holds the project's requirements. Source code will be added as development starts.

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
