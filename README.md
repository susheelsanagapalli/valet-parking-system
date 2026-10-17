# Valet Parking System

A cloud-hosted valet parking platform that replaces paper valet tickets with a digital ticket. It tracks every vehicle from drop-off to return and lets guests request their car from their phone.

This repository currently holds the project's requirements. Source code will be added as development starts.

## Documents

| Document | Description |
| --- | --- |
| [Software Requirements Specification](docs/SRS.md) | Functional and non-functional requirements for v1.0 (IEEE 830 / ISO/IEC/IEEE 29148 structure) |

## System at a glance

| Component | Purpose |
| --- | --- |
| Customer app (web/PWA) | Receive a digital ticket, request the car, pay, rate the service |
| Valet attendant app | Check vehicles in and out, record damage photos, park and retrieve |
| Admin web portal | Manage locations, staff, tariffs, reports and incidents |
| Backend services | REST API + WebSocket, database, notifications, payment integration |

## Key features (v1.0)

- Digital ticket with QR code, sent by SMS/WhatsApp at drop-off
- Vehicle check-in with photos, damage notes, key tag and parking slot
- One-tap car retrieval with live status and ETA
- Task queue and dispatch for attendants
- Online and on-site payment, merchant validation, digital receipts
- Live occupancy dashboard, reports and audit trail
- Incident and damage management

## Status

Requirements baseline: **SRS v1.0** (October 2026). Open questions are listed in [section 8 of the SRS](docs/SRS.md#8-open-questions).
