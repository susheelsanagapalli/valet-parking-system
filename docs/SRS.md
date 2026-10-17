# Software Requirements Specification: Valet Parking System

Version 1.3 · Oct 17, 2026 · Manikanta

## Table of contents

1. [Introduction](#1-introduction)
2. [Overall description](#2-overall-description)
3. [Functional requirements](#3-functional-requirements)
4. [External interface requirements](#4-external-interface-requirements)
5. [Non-functional requirements](#5-non-functional-requirements)
6. [Data requirements](#6-data-requirements)
7. [Use cases](#7-use-cases)
8. [Open questions](#8-open-questions)

### Revision history

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | Oct 17, 2026 | Initial baseline |
| 1.1 | Oct 17, 2026 | Resolved review questions: handover PIN verification, printed ticket fallback made Must, optional guest mobile, offline ticket number blocks, no-show and abandoned vehicle handling, fee clock rules, zero-fee settlement, merchant accounts, tip allocation, ETA method, shifts, platform admin role, per-operator data isolation, anonymisation, supervisor override, 7-day guest link window, revised check-in time target. 11 new functional requirements (71 total). |
| 1.2 | Oct 17, 2026 | Configurable service profiles (paid parking, restaurant, hotel, event venue, custom) with a settings catalogue managed from the admin panel. Data stored in each operator's own Google Drive and Google Sheets instead of a separate database; scale, performance, availability and recovery targets revised to fit. 18 new functional requirements (89 total). |
| 1.3 | Oct 17, 2026 | Vehicle photos made optional and configurable per vendor. Parking spot entered as free text by default, with zone/slot list as an option. Photo storage made a separate, selectable integration (Google Drive by default); records stay in Google Sheets. Photos deleted automatically when the guest link expires after handover. Guest no-damage confirmation required at handover. 4 new functional requirements (93 total). |

## 1. Introduction

The Valet Parking System (VPS) replaces paper valet tickets with a digital ticket that tracks every vehicle from drop-off to return, and lets guests request their car from their phone. The same product serves paid parking operators, restaurants, hotels and event venues: each location picks a service profile and adjusts its rules from the admin panel.

### 1.1 Purpose

This SRS defines the functional and non-functional requirements for VPS version 1.0. It is the agreed baseline for design, development, testing and acceptance, and follows the structure of IEEE 830 / ISO/IEC/IEEE 29148.

### 1.2 Scope

VPS consists of four components:

- **Customer web/mobile app** — receive a digital ticket, request the car, pay, confirm handover, rate the service.
- **Valet attendant app** — check vehicles in and out, record the parking spot and optional photos, park and retrieve.
- **Admin web portal** — manage operators, locations, service profiles and settings, staff, merchants, pricing, reports and incidents; merchant validation page.
- **Backend services** — API, business rules, notifications, payment integration, the data layer that stores all records in the operator's Google Sheets, and the photo storage integration.

In scope: paid parking operators, restaurants, hotels, hospitals, malls and event venues running one or many valet locations, each configured through service profiles (section 2.7). Out of scope for v1.0: automated (robotic) parking, licence-plate recognition cameras, self-park garage gate control, billing operators for use of the platform, and a separate database server.

### 1.3 Definitions and acronyms

| Term | Meaning |
| --- | --- |
| Valet ticket | Unique digital record (with QR code and short number) for one vehicle visit |
| Handover PIN | 4-digit code issued to the guest with the ticket, used to verify the guest at handover when the QR cannot be scanned; never shown to staff |
| Handover confirmation | The guest's confirmation, at handover, that the car was received with no new damage, or their report that it was not |
| Attendant | Staff member who parks and retrieves vehicles |
| Supervisor | Staff member who runs a shift at a location |
| Shift | Period between an attendant's clock-in and clock-out |
| Operator / vendor | A business (tenant) running valet service at one or more locations |
| Platform admin | Staff of the VPS provider who onboard and manage operators |
| Merchant | A business at a location (e.g. hotel front desk, restaurant) that validates guest tickets |
| Location | A site offering valet service |
| Service profile | A named preset of location settings for a type of business (e.g. Paid parking, Restaurant) |
| Setting | A configurable business rule of a location, listed in the settings catalogue (section 2.7) |
| Custom field | An extra check-in field defined by an admin (e.g. room number, reservation name) |
| Parking spot | Where the car is parked: free text typed by the attendant (e.g. "Basement 2, near lift"), or a zone and slot chosen from a list |
| Zone / Slot | An area and a numbered space within a location, used when the location uses zone/slot mode |
| Pickup point | A place at a location where cars are dropped off and handed back |
| Photo storage | The integration that holds vehicle photos (Google Drive by default); separate from the Google Sheets records |
| Key tag | Physical tag or hook number where the vehicle key is stored |
| ETA | Estimated time for the car to reach the pickup point |
| OTP | One-time password sent by SMS |
| OAuth | Open standard used to let VPS access an operator's Google account with their consent |
| PCI DSS | Payment Card Industry Data Security Standard |

### 1.4 References

- IEEE Std 830-1998, Recommended Practice for Software Requirements Specifications
- ISO/IEC/IEEE 29148:2018, Requirements engineering
- PCI DSS v4.0
- WCAG 2.1, Web Content Accessibility Guidelines
- Google Sheets API and Google Drive API documentation, including usage limits

### 1.5 Document overview

Section 2 describes the product context, users and configurability. Section 3 lists functional requirements by module. Sections 4 and 5 cover interfaces and quality attributes. Section 6 defines the data model, ticket lifecycle and Google Drive storage layout. Section 7 gives key use cases, and section 8 lists open questions.

## 2. Overall description

VPS is a new, cloud-hosted, multi-tenant product: one deployment serves many operators, each with many locations, and every client talks to a single backend API. There is no separate database server: each operator's records live in Google Sheets inside that operator's own Google account. Vehicle photos, where a vendor enables them, go to a separate photo storage integration.

### 2.1 Product perspective

The customer app, attendant app and admin portal are thin clients over a REST API. The backend owns all business rules and integrates with an SMS/WhatsApp gateway, a push-notification service, a payment gateway, a map service, the operator's Google Sheets and Drive, and the operator's chosen photo storage. Because Google Sheets has no transactions or row locks and limits API calls per minute, the backend keeps a rebuildable in-memory cache with locks for live operations, and a durable write queue that batches writes to Sheets. The architecture diagram below shows the parts and what calls what.

```mermaid
flowchart LR
    subgraph Clients
        C["Customer app<br/><small>Ticket page, request, pay, confirm</small>"]
        A["Attendant app<br/><small>Check-in, tasks, photos</small>"]
        P["Admin portal<br/><small>Setup, settings, reports, validation</small>"]
    end
    subgraph Backend["VPS backend"]
        API["REST API + WebSocket<br/>Ticket and dispatch rules<br/>Settings and profiles<br/>Tariffs and billing<br/>Notifications and audit log"]
        CACHE["Cache + locks<br/><small>rebuildable from Sheets</small>"]
        QUEUE["Durable write queue<br/><small>batched Sheets writes</small>"]
        API --- CACHE
        API --> QUEUE
    end
    subgraph Google["Operator's Google account"]
        SHEETS[("Google Sheets<br/>all records")]
        DRIVE[("Google Drive<br/>reports, backups")]
    end
    PHOTO[("Photo storage<br/><small>Google Drive (default)<br/>or object storage</small>")]
    subgraph External["External services"]
        PG[Payment gateway]
        SMS[SMS / WhatsApp]
        PUSH["Push (FCM / APNs)"]
        MAP[Maps service]
        MAIL[Email service]
    end
    C <-->|HTTPS + WSS| API
    A <-->|HTTPS + WSS| API
    P <-->|HTTPS + WSS| API
    QUEUE --> SHEETS
    API --> DRIVE
    API -->|only if photos enabled| PHOTO
    API --> PG
    API --> SMS
    API --> PUSH
    API --> MAP
    API --> MAIL
```

The backend is the only component holding business rules and credentials for external services; clients never call those services, the operator's Google account or the photo storage directly.

### 2.2 Product functions (summary)

- Digital ticket issue at drop-off (QR code + SMS link, or printed ticket)
- Vehicle check-in with key tag, parking spot (free text or zone/slot), custom fields and optional photos
- Car retrieval request by the guest, merchant or staff, with live status and ETA
- Task queue and assignment for attendants
- Guest no-damage confirmation at handover
- Payment (prepaid at flat-tariff locations, pay-on-exit, validated/complimentary)
- Service profiles and per-location rule settings managed from the admin panel
- Live dashboard per location
- Reports, audit trail and incident (damage) management
- All records kept in the operator's own Google Sheets; photos in a separate, selectable photo storage and deleted after handover

### 2.3 User classes

| User class | Main goals | Frequency | Technical skill |
| --- | --- | --- | --- |
| Customer (guest) | Get a ticket, request car, pay, confirm handover | 1–2 times per visit | Low; no app install required |
| Valet attendant | Check in, park, retrieve cars fast | Continuous during shift | Low–medium; uses phone with gloves, outdoors |
| Shift supervisor | Assign tasks, watch queue, handle issues, approve handover overrides | Continuous during shift | Medium |
| Location manager | Configure location, staff, pricing; view reports; handle overdue vehicles | Daily | Medium |
| Operator admin | Connect the Google account and photo storage; manage locations, service profiles, settings, merchants | Weekly | High |
| Merchant / validator | Validate or comp a guest's ticket; request a guest's car (e.g. restaurant host) | Occasional | Low |
| Platform admin | Create, configure and suspend operators | Occasional | High |

### 2.4 Operating environment

- Customer app: responsive web (PWA) on current Chrome, Safari, Edge, Firefox; optional native Android 10+ / iOS 15+.
- Attendant app: Android 10+ and iOS 15+ phones; must work on rugged Android devices.
- Admin portal: desktop browsers at 1280×720 or larger.
- Backend: containerised cloud hosting (e.g. AWS, Azure or GCP) with an in-memory cache and a durable queue; Google Sheets in each operator's Google account as the data store; photo storage in Google Drive or an S3-compatible object store.

### 2.5 Design and implementation constraints

- Card data must never be stored by VPS; payments go through a PCI DSS compliant gateway (tokenised).
- Personal data handling must comply with applicable privacy law (e.g. India DPDP Act 2023, GDPR where guests are in the EU).
- All operator records shall be stored in Google Sheets in the operator's own Google account; no separate database server is used. Photos, where enabled, are stored only in the operator's chosen photo storage and referenced from Sheets. The platform keeps only a registry of operators and their connection status, plus encrypted credentials in a secret manager. The cache and write queue hold data only transiently.
- Customer and vehicle data must be isolated per operator and never shared across operators.
- Google Sheets and Drive API usage limits shall be respected: writes are batched through the write queue and reads are served from the cache.
- Business rules shall be driven by location settings (section 2.7) so a new client type can be supported by configuration, without code changes.
- The attendant app must keep working through short network loss (offline queue, sync on reconnect).
- All timestamps stored in UTC and shown in the location's time zone.

### 2.6 Assumptions and dependencies

- Each location has mobile data or Wi-Fi coverage at the drop-off and pickup points.
- Most guests provide a mobile number to receive the ticket link; guests who do not receive a printed ticket.
- Each location has at least one working Bluetooth ticket printer.
- Each operator has a Google account (Google Workspace recommended). Where photos are enabled, photos are compressed to 300 KB or less and kept only until the guest link expires, so photo storage needs stay small.
- Google Sheets, Google Drive, the photo storage and third-party SMS, payment and push services are available at 99.9% or better.
- Physical key storage (key box/hooks) exists and is numbered.

### 2.7 Configurability and service profiles

Every location chooses a service profile when it is created. The profile fills in default values for the settings below; the operator admin can then change any setting for that location from the admin panel. New tickets follow the settings in force at check-in.

#### 2.7.1 Settings catalogue

| Setting | Options | Default | Related FRs |
| --- | --- | --- | --- |
| Parking spot entry | Free text, zone/slot list | Free text | FR-PARK-02 |
| Vehicle photos | Off, optional, required; number of photos (1–8) | Optional; 4 | FR-IN-03, FR-OUT-07 |
| Photo storage | Google Drive, S3-compatible object storage | Google Drive | FR-DATA-07 |
| Handover confirmation | On, off | On | FR-OUT-13, FR-OUT-14 |
| Charging model | Tariff (hourly/daily/overnight), flat fee, complimentary | Tariff | FR-PAY-01, FR-PAY-12 |
| Payment timing | Prepaid at check-in (flat fee only), pay on exit, none | Pay on exit | FR-PAY-03, FR-PAY-10 |
| Payment required before handover | Yes, no | Yes | FR-PAY-14 |
| Online payment | On, off | On | FR-PAY-03 |
| Merchant validation | Off, on; allowed rule types (free, amount off, percentage off, free above minimum bill) | Off | FR-PAY-05, FR-PAY-13 |
| Merchants can request cars | Yes, no | No | FR-OUT-12 |
| Tips | Off, to retrieving attendant, to shift pool | Off | FR-PAY-06 |
| Custom check-in fields | List of fields (text, number, list), each required or optional | None | FR-CFG-03 |
| Damage diagram | On, off | Off | FR-IN-04 |
| Scheduled pickup | On, off; maximum hours ahead | Off; 24 h | FR-OUT-02 |
| Auto-dispatch | On, off | Off | FR-TASK-04 |
| Task not accepted alert | Minutes | 2 | FR-TASK-05 |
| Occupancy alert (zone/slot mode only) | Percentage | 90% | FR-PARK-06 |
| Overdue limit | Hours, or "at closing time" | 24 h | FR-ADM-08 |
| Closing-time alert | Off, or minutes before closing | Off | FR-ADM-11 |
| Ratings | On, off | On | FR-ADM-07 |
| Guest link expiry after closure (also when photos are deleted) | Days | 7 | NFR-SEC-02, FR-DATA-08 |
| Personal data retention | Days | 90 | NFR-PRIV-02 |
| Languages | English plus selected regional languages | English | FR-ADM-09 |
| Branding and terms | Logo, colours, ticket header/footer text, terms and conditions | Operator name, standard terms | FR-CFG-05 |
| Message templates | Per message type and language | Standard templates | FR-NOT-03 |

#### 2.7.2 Service profiles

The table shows where each profile's defaults differ from the catalogue defaults. **Custom** starts from the catalogue defaults.

| Setting | Paid parking | Restaurant | Hotel | Event venue |
| --- | --- | --- | --- | --- |
| Parking spot entry | Zone/slot list | Free text | Free text | Free text |
| Vehicle photos | Required (4) | Optional | Optional | Off |
| Charging model | Tariff | Complimentary or flat fee | Tariff (hourly, overnight) | Flat fee |
| Payment timing | Pay on exit | None, or pay on exit | Pay on exit | Prepaid at check-in |
| Payment required before handover | Yes | No | No | Yes |
| Merchant validation | Off | On: free above minimum bill | On: front desk | Off |
| Merchants can request cars | No | Yes (host requests car when the bill is asked for) | Yes (front desk) | No |
| Tips | Off | To retrieving attendant | To shift pool | Off |
| Custom check-in fields | — | Reservation name, table number | Room number | — |
| Scheduled pickup | Off | Off | On | Off |
| Overdue limit | 24 h | At closing time | 7 days | 6 h after event end |
| Closing-time alert | Off | 30 min before closing | Off | 30 min before event end |

## 3. Functional requirements

VPS has 93 functional requirements across eleven modules; priorities use MoSCoW (Must, Should, Could), and every Must item is required for v1.0 acceptance. Where a requirement depends on a setting, it applies only when that setting is on for the location.

### 3.1 Authentication and user management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-AUTH-01 | Staff and merchant validators shall log in with mobile number/email and password; customers shall access tickets via OTP or a signed ticket link without creating an account. | Must |
| FR-AUTH-02 | The system shall enforce role-based access control for the roles in section 2.3. | Must |
| FR-AUTH-03 | Admins shall create, edit, deactivate staff and assign them to one or more locations. | Must |
| FR-AUTH-04 | Staff sessions on the attendant app shall expire at clock-out or 12 hours after clock-in, whichever comes first. | Should |
| FR-AUTH-05 | Admin users shall be able to enable two-factor authentication. | Should |
| FR-AUTH-06 | Attendants shall clock in and clock out of a shift from the app; a shift runs from clock-in to clock-out. | Should |
| FR-AUTH-07 | Platform admins shall create, configure and suspend operators and create each operator's first admin account. | Must |

### 3.2 Vehicle check-in (drop-off)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-IN-01 | The attendant shall create a ticket by entering the plate number; guest mobile number, vehicle make, model and colour shall be optional, with quick-pick lists for make and colour. | Must |
| FR-IN-02 | The system shall generate a unique ticket number, QR code and 4-digit handover PIN and, when a mobile number is given, send the guest a ticket link and PIN by SMS/WhatsApp within 10 seconds (or on sync if issued offline). | Must |
| FR-IN-03 | Where vehicle photos are on, the attendant shall be able to capture the configured number of photos (default 4: front, rear, left, right) with timestamp; where photos are required, the ticket cannot be saved without them. | Must |
| FR-IN-04 | The attendant shall mark existing damage on a vehicle diagram with notes. | Should |
| FR-IN-05 | The attendant shall record the key tag number. | Must |
| FR-IN-06 | The system shall print a ticket (ticket number, QR code, handover PIN) via Bluetooth printer when the guest gives no mobile number, the device is offline, or the guest asks for one. | Must |
| FR-IN-07 | The system shall recognise returning vehicles by plate number within the same operator and pre-fill details. | Could |
| FR-IN-08 | The guest shall see and accept the terms and any recorded condition photos or damage notes in the ticket page. | Should |
| FR-IN-09 | The attendant shall be able to record fuel level and odometer reading (optional fields). | Could |
| FR-IN-10 | While online, each attendant device shall reserve a block of ticket numbers and signed QR tokens so it can issue tickets offline; offline tickets shall sync automatically on reconnect. | Must |

### 3.3 Parking and slot management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PARK-01 | In zone/slot mode, admins shall define zones and numbered slots per location, with capacity. | Must |
| FR-PARK-02 | The attendant shall record where the vehicle is parked: in a free-text field (default, e.g. "Basement 2, near lift"), or by choosing a zone and slot in zone/slot mode. | Must |
| FR-PARK-03 | In zone/slot mode, the system shall suggest the nearest free slot based on current occupancy. | Should |
| FR-PARK-04 | In zone/slot mode, the system shall prevent assigning a slot that is already occupied; conflicts from slots assigned offline shall be detected on sync and flagged to the supervisor. | Must |
| FR-PARK-05 | Attendants shall move a vehicle and update its parking spot; the move shall be logged. | Must |
| FR-PARK-06 | In zone/slot mode, the system shall alert the supervisor when a location reaches its occupancy alert level (default 90%). | Should |
| FR-PARK-07 | At check-in the system shall create a park task assigned to the checking-in attendant and close it when the parking spot is recorded. | Must |

### 3.4 Vehicle retrieval (pickup request)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-OUT-01 | The guest shall request the car from the ticket page with one tap, choosing a pickup point (default: the drop-off point). | Must |
| FR-OUT-02 | The guest shall be able to schedule a pickup for a future time (up to the configured maximum, default 24 hours ahead). | Should |
| FR-OUT-03 | Staff shall create a retrieval request on behalf of a guest by ticket number, plate or QR scan (e.g. guests with a printed ticket). | Must |
| FR-OUT-04 | The system shall show the guest live status (Requested, Assigned, On the way, Ready) and an ETA calculated as the estimated queue wait plus the configured average retrieval time to the chosen pickup point (per zone in zone/slot mode, per location otherwise). | Must |
| FR-OUT-05 | The guest shall receive a notification when the car is ready at the pickup point. | Must |
| FR-OUT-06 | Before handover, the attendant shall verify the guest by scanning the ticket QR or, if the QR is unavailable, entering the guest's 4-digit handover PIN. | Must |
| FR-OUT-07 | Where vehicle photos are on, the attendant shall be able to capture return photos; the attendant closes the ticket on handover. | Should |
| FR-OUT-08 | The guest shall be able to cancel a retrieval request until an attendant accepts it. | Should |
| FR-OUT-09 | A supervisor shall be able to send a car waiting at the pickup point back to a slot (guest no-show); the guest is notified and must request the car again. | Should |
| FR-OUT-10 | When verification fails, a supervisor shall approve the handover by recording the ID document type and its last 4 characters and taking a photo of the ID or the guest with the car; overrides shall be logged and shown in reports. | Must |
| FR-OUT-11 | The system shall refine average retrieval times from actual retrieval history. | Could |
| FR-OUT-12 | Where merchants can request cars, a merchant validator shall create a retrieval request for a guest's ticket (e.g. a restaurant host when the guest asks for the bill). | Should |
| FR-OUT-13 | Where handover confirmation is on, the guest shall confirm before the ticket closes that the car was received with no new damage: by tapping "Car received, no damage" on the ticket page, or, for guests without the ticket page, by signing on the attendant's device. The confirmation, method and time shall be recorded on the ticket. | Must |
| FR-OUT-14 | If the guest reports damage instead of confirming, the system shall open an incident linked to the ticket, keep the ticket's photos until the incident is resolved, and let the attendant complete the handover. | Must |

### 3.5 Task dispatch and attendant workflow

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TASK-01 | The system shall place every retrieval request in a location queue ordered by request time (scheduled requests at their due time). | Must |
| FR-TASK-02 | Attendants shall accept a task from the queue; one task shall be held by only one attendant. | Must |
| FR-TASK-03 | Supervisors shall assign, re-assign and re-prioritise tasks (e.g. VIP). | Must |
| FR-TASK-04 | The system shall auto-assign tasks to the available attendant with the fewest active tasks when auto-dispatch is on. | Could |
| FR-TASK-05 | The system shall alert the supervisor when a task is not accepted within a configurable time (default 2 minutes). | Should |
| FR-TASK-06 | The attendant app shall show the parking spot, key tag, vehicle details, custom field values and any photos for each task. | Must |

### 3.6 Payment and billing

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PAY-01 | Admins shall configure tariffs per location: flat fee, hourly, daily cap, overnight, and free minutes. | Must |
| FR-PAY-02 | The system shall calculate the fee from check-in to the time of the latest non-cancelled retrieval request (for a scheduled pickup, the scheduled time) using the location tariff; a cancelled request does not stop the fee clock. | Must |
| FR-PAY-03 | Where online payment is on, the guest shall pay by card, UPI or wallet via the payment gateway before or at pickup. | Must |
| FR-PAY-04 | The attendant shall record cash or card-terminal payment at handover. | Must |
| FR-PAY-05 | Merchant validators shall validate a ticket for free or discounted parking within their merchant's allowed discounts and monthly cap. | Should |
| FR-PAY-06 | The guest shall be able to add a tip; each location shall configure whether tips go to the retrieving attendant or to a shift pool. | Could |
| FR-PAY-07 | The system shall issue a digital receipt with tax breakdown by SMS/email. | Must |
| FR-PAY-08 | Managers shall issue full or partial refunds, with a reason, logged in the audit trail. | Should |
| FR-PAY-09 | The system shall support monthly pass holders who are not charged per visit. | Could |
| FR-PAY-10 | At locations with a flat tariff, the guest shall be able to prepay at check-in. | Should |
| FR-PAY-11 | Admins shall create merchants (name, locations, allowed discount types and values, monthly cap) and their validator accounts. | Should |
| FR-PAY-12 | A ticket with nothing due (complimentary, full validation or monthly pass) shall be settled with a payment record of amount 0 stating the reason. | Must |
| FR-PAY-13 | Validations shall support the rule types free, fixed amount off, percentage off, and free when the bill amount entered by the validator meets a configured minimum. | Should |
| FR-PAY-14 | Where payment is required before handover, the attendant app shall not close a ticket with a balance due unless a supervisor approves; approvals shall be logged. | Must |

### 3.7 Notifications

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-NOT-01 | The system shall send the guest SMS/WhatsApp messages on ticket issue, car ready, car returned to slot, overdue reminder and payment receipt. | Must |
| FR-NOT-02 | The attendant app shall receive push notifications for new and assigned tasks. | Must |
| FR-NOT-03 | Admins shall edit message templates per location and language. | Should |
| FR-NOT-04 | The system shall retry failed messages up to 3 times and log the delivery status. | Should |

### 3.8 Incident and damage management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-INC-01 | Staff and guests shall report an incident (damage, lost item, delay) linked to a ticket, with photos where available; guests can report through the ticket link until it expires (NFR-SEC-02). | Must |
| FR-INC-02 | Each incident shall have a status (Open, Under review, Resolved, Rejected) and an owner. | Must |
| FR-INC-03 | The incident view shall show the guest's handover confirmation and, where taken, check-in and return photos side by side for comparison. | Should |
| FR-INC-04 | Managers shall export an incident report as PDF for insurance claims; the PDF is also saved to the location's Reports folder in Drive. | Should |

### 3.9 Admin, dashboard and reporting

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-ADM-01 | Admins shall create and configure locations: address, operating hours, tariffs, pickup points, average retrieval time to each pickup point, and (in zone/slot mode) zones and per-zone retrieval times. | Must |
| FR-ADM-02 | The dashboard shall show live per-location counts: cars parked, open requests, average wait time, and (in zone/slot mode) free slots. | Must |
| FR-ADM-03 | The system shall provide daily, weekly and monthly reports: tickets, revenue, payment mix, tips, validations by merchant, average retrieval time, attendant performance, handover overrides, handover confirmations and damage reports. | Must |
| FR-ADM-04 | Reports shall be exportable to CSV and PDF and saved to the location's Reports folder in Drive. | Must |
| FR-ADM-05 | The system shall keep an audit log of all create, update, delete, payment and settings actions with user and timestamp. | Must |
| FR-ADM-06 | Supervisors shall search tickets by number, plate, mobile number or date range. | Must |
| FR-ADM-07 | The system shall collect a 1–5 star rating and comment from the guest after handover, while the ticket link is valid. | Should |
| FR-ADM-08 | Tickets older than the location's overdue limit (default 24 hours) shall be listed as overdue; the system shall alert the location manager and send the guest a reminder. | Should |
| FR-ADM-09 | The system shall support multiple languages for the customer app (English plus at least one regional language). | Should |
| FR-ADM-10 | Managers shall mark an overdue vehicle as Abandoned with a reason; this ends the ticket, frees the parking spot and is logged in the audit trail. | Should |
| FR-ADM-11 | Where a closing-time alert is set, the system shall send the supervisor the list of cars still parked at the configured time before closing. | Should |

### 3.10 Configuration and customisation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-CFG-01 | When creating a location, admins shall choose a service profile (Paid parking, Restaurant, Hotel, Event venue, Custom), which fills in the default settings in section 2.7.2. | Must |
| FR-CFG-02 | Operator admins shall change any setting in the settings catalogue (section 2.7.1) per location from the admin panel, taking effect without a code change or redeployment. | Must |
| FR-CFG-03 | Operator admins shall define custom check-in fields per location (label, type text/number/list, required or optional, shown on ticket and reports). | Should |
| FR-CFG-04 | Operator admins shall turn optional features on or off per location: vehicle photos, handover confirmation, online payment, tips, ratings, scheduled pickup, merchant validation, merchant car requests, damage diagram, auto-dispatch. | Must |
| FR-CFG-05 | Operator admins shall set branding per location: logo, colours, ticket header and footer text, and terms and conditions. | Should |
| FR-CFG-06 | Settings changes shall be versioned and logged in the audit trail; each ticket records the settings version in force at check-in and keeps those rules until it ends. | Must |
| FR-CFG-07 | Operator admins shall save a location's settings as a named custom profile and apply it to other locations. | Could |
| FR-CFG-08 | The admin panel shall preview the guest ticket page and printed ticket with the current settings and branding. | Could |

### 3.11 Data store and photo storage

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-DATA-01 | During onboarding, the operator admin shall connect the operator's Google account through OAuth; the system shall then create the folder structure and spreadsheets described in section 6.4. | Must |
| FR-DATA-02 | The system shall store all records in the operator's Google Sheets, and reports and backups in the operator's Google Drive. System tabs shall be protected so only VPS edits them; operator users may view them and build their own reports (e.g. pivot tables, Looker Studio). | Must |
| FR-DATA-03 | The system shall start a new transactions spreadsheet for each location every month and keep earlier months read-only, so no spreadsheet nears the Google Sheets cell limit. | Must |
| FR-DATA-04 | The system shall monitor the Google and photo storage connections and alert the operator admin and platform admin when access is revoked, storage is full or API limits are reached, while continuing to operate from the cache and write queue (NFR-AVL-03). | Must |
| FR-DATA-05 | The system shall warn the operator admin when the operator's Drive or photo storage passes 80% of its quota. | Should |
| FR-DATA-06 | Operator admins shall be able to disconnect VPS from their Google account; all data created so far stays in their Drive. | Should |
| FR-DATA-07 | Where photos are on, operator admins shall choose the photo storage integration (Google Drive by default, or S3-compatible object storage) separately from the Sheets records; Sheets stores only a reference to each photo. | Should |
| FR-DATA-08 | The system shall delete a ticket's vehicle photos automatically when the guest link expires after handover (default 7 days after closure), unless an incident on the ticket is open; photos linked to an open incident are deleted when it is resolved or rejected. Each deletion shall be logged. | Must |

## 4. External interface requirements

All clients use one versioned HTTPS REST API (JSON), plus a WebSocket channel for live status; external services, including the operator's Google account and photo storage, are reached only from the backend.

### 4.1 User interfaces

- **Customer ticket page:** opens from the SMS link without login; shows ticket number, QR code, handover PIN, any vehicle photos, status, ETA, fee, pickup point choice and a large "Request my car" button, with the location's branding. At handover it shows "Car received, no damage" and "Report damage" buttons.
- **Attendant app:** large touch targets (at least 48×48 dp), high-contrast theme for outdoor use, QR scanner, free-text parking spot field (or zone/slot picker), optional camera capture, ticket printing, task list with one-tap accept, the location's custom check-in fields, and a signature screen for handover confirmation. Handover PINs are never displayed.
- **Admin portal:** dashboard, operator setup (platform admins), Google account and photo storage connection, location setup, service profiles and settings, custom fields, branding, staff, merchants, tariffs, tickets, incidents, reports; tables with search, filter and export.
- **Merchant validation page:** scan or enter a ticket number, enter the bill amount where required, apply an allowed discount and, where enabled, request the guest's car.
- All interfaces shall meet WCAG 2.1 level AA.

### 4.2 Hardware interfaces

| Device | Use | Requirement |
| --- | --- | --- |
| Smartphone camera | QR scan; vehicle and ID photos where enabled | Min. 8 MP, autofocus |
| Smartphone touch screen | Guest signature for handover confirmation | Standard capacitive screen |
| Bluetooth thermal printer | Printed tickets (no mobile number, offline, on request) | At least one per location; ESC/POS compatible, 58 or 80 mm |
| Card payment terminal | Card payment at handover | Standalone; amount entered manually in v1.0 |
| Display screen at pickup | Queue / "car ready" board | Any browser-capable screen (optional) |

### 4.3 Software interfaces

| System | Purpose | Interface |
| --- | --- | --- |
| Google Sheets API | All records (system of record) | REST API, batched updates |
| Google Drive API | Folders, reports, backups, signatures; photos when Drive is the photo storage | REST API; files shown to users through short-lived backend links |
| Google OAuth 2.0 | Operator consent to access their Google account | OAuth 2.0, `drive.file` scope (files created by VPS only) |
| S3-compatible object storage (optional) | Photo storage when chosen instead of Drive | S3 API; signed, short-lived URLs |
| Payment gateway (e.g. Razorpay, Stripe) | Online payments, refunds | REST API + webhooks, tokenised cards |
| SMS / WhatsApp gateway (e.g. Twilio, MSG91) | Ticket links, PINs, OTP, alerts | REST API, delivery-status callbacks |
| Push service (FCM / APNs) | Attendant task alerts | Provider SDK |
| Maps service (e.g. Google Maps) | Location address, directions to pickup point | JavaScript / REST API |
| Email service (e.g. SES, SendGrid) | Receipts, reports | SMTP / REST API |

### 4.4 Communication interfaces

- All traffic shall use TLS 1.2 or higher.
- The API shall use JSON over HTTPS, versioned in the path (e.g. /api/v1).
- Live status updates shall use WebSocket, with fallback to polling every 10 seconds.
- Webhooks from external services shall be verified by signature.

## 5. Non-functional requirements

The targets below are measurable acceptance criteria. They are sized for Google Sheets as the data store; the headline ones are 99.5% monthly uptime, API responses under 1 s at the 95th percentile, and zero stored card data.

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-PERF-01 | Performance | 95% of API requests shall complete in under 1 s; 99% under 3 s. Reads are served from the cache. |
| NFR-PERF-02 | Performance | A retrieval request shall appear in the attendant queue within 3 s of the guest tapping "Request". |
| NFR-PERF-03 | Performance | The customer ticket page shall load in under 3 s on a 4G connection. |
| NFR-PERF-04 | Performance | Accepted changes shall be written to Google Sheets within 60 s under normal conditions. |
| NFR-SCAL-01 | Scalability | The system shall support, across the platform, 20 locations, 200 concurrent staff users and 2,000 tickets per day within default Google API quotas. Growth beyond this requires a Google quota increase or the migration in NFR-SCAL-03. |
| NFR-SCAL-02 | Scalability | A single location shall handle peaks of 100 check-ins per hour. |
| NFR-SCAL-03 | Scalability | All data access shall go through a storage layer so that a relational database can replace Google Sheets later without changes to the clients or business rules. |
| NFR-AVL-01 | Availability | Monthly uptime shall be at least 99.5%, excluding announced maintenance (max 4 hours/month, off-peak). |
| NFR-AVL-02 | Availability | The attendant app shall issue tickets from its reserved number block and queue check-ins and status changes offline for up to 30 minutes, then sync automatically (FR-IN-10). |
| NFR-AVL-03 | Availability | If Google Sheets, Drive or the photo storage is unreachable or rate-limited, the backend shall keep operating from the cache and hold writes and photo uploads in the durable queue for up to 4 hours; no accepted write shall be lost. |
| NFR-REC-01 | Recoverability | Each spreadsheet shall be copied daily to the operator's Backups folder (copies kept 30 days), with Google Sheets version history for finer recovery; RPO 24 hours for a deleted or corrupted spreadsheet, RTO 8 hours. The cache shall be rebuildable from Sheets within 15 minutes. Photos are short-lived and are not backed up. |
| NFR-SEC-01 | Security | Passwords shall be hashed with bcrypt or Argon2, and handover PINs with a keyed hash (HMAC) whose key is held only by the backend, so viewers of the spreadsheet cannot recover them. Data encrypted in transit (TLS 1.2+); data at rest encrypted by Google or the photo storage provider (AES-256). OAuth refresh tokens and storage credentials encrypted in a cloud secret manager. |
| NFR-SEC-02 | Security | Ticket links shall use unguessable signed tokens. After ticket closure a link shall allow only viewing the receipt, rating and reporting an incident, and shall expire after a configurable period per location (default 7 days). |
| NFR-SEC-03 | Security | Accounts shall lock for 15 minutes after 5 failed logins. |
| NFR-SEC-04 | Security | The system shall be tested against the OWASP Top 10 before each major release. |
| NFR-SEC-05 | Security | VPS shall request only the Google `drive.file` scope, so it can access only the files it created, never the operator's other Drive content. |
| NFR-PRIV-01 | Privacy | Guest mobile numbers shall be masked to staff (last 4 digits) except supervisors and above. Handover PINs shall never be shown to any staff role. |
| NFR-PRIV-02 | Privacy | Vehicle and ID photos shall be deleted per FR-DATA-08. After a configurable retention period (default 90 days), the guest's name, mobile number, plate number and handover signature shall be removed by deleting the whole monthly Guest data spreadsheet and signature files (section 6.4), since Sheets version history would keep values that were only overwritten. Financial and audit fields are kept per section 6.3; records linked to an open incident are kept until it closes. |
| NFR-PRIV-03 | Privacy | Customer and vehicle records shall belong to a single operator, be stored only in that operator's Google account and photo storage, and never be visible to or matched across other operators. |
| NFR-USE-01 | Usability | An attendant shall complete a check-in with the required fields (plate number, key tag, parking spot) in under 30 seconds, or under 60 seconds where 4 photos are required; optional fields, custom fields and the damage diagram are excluded from these targets. |
| NFR-USE-02 | Usability | A new attendant shall be productive after 30 minutes of training. |
| NFR-USE-03 | Usability | An operator admin shall set up a new location from a service profile, including tariffs and branding, in under 30 minutes without vendor help. |
| NFR-USE-04 | Usability | A guest shall complete the handover confirmation in under 10 seconds. |
| NFR-MNT-01 | Maintainability | Backend code shall have at least 70% automated test coverage, including every service profile; deployments via CI/CD with rollback. |
| NFR-MNT-02 | Maintainability | The system shall provide centralised logs, metrics and alerting for errors, latency, write queue length and Google API quota use. |
| NFR-PORT-01 | Portability | Services shall run in containers and avoid lock-in to one cloud provider's proprietary services where practical. |
| NFR-LEG-01 | Compliance | Payment flows shall comply with PCI DSS (SAQ A scope); invoices shall meet local tax (e.g. GST) rules. |

## 6. Data requirements

The Ticket is the central record: every vehicle, photo, task, payment and incident hangs off one ticket, and its status moves through a fixed lifecycle. Each entity below is a tab in one of the operator's spreadsheets (section 6.4); each tab has an id column and a header row of attribute names. Photo files live in the photo storage; Sheets holds only their references.

### 6.1 Core entities

| Entity | Key attributes | Relationships |
| --- | --- | --- |
| Operator (tenant) | id, name, tax id, status (active/suspended), Google connection status, root folder id, photo storage type and status | has many Locations, Users, Merchants, Customers, Vehicles |
| Location | id, name, address, time zone, hours, service profile, current settings version, parking spot mode (free text / zone-slot), capacity (optional) | has many Zones, Tariffs, Pickup points, Settings, Custom fields, Tickets |
| Location settings | id, location, version, setting key, value, changed by, valid from | belongs to Location |
| Custom profile | id, name, settings values | belongs to Operator |
| Custom field | id, label, type (text/number/list), options, required, show on ticket | belongs to Location |
| Zone / Slot | id, code, slot number, status (free/occupied/blocked) | belongs to Location (zone/slot mode only); holds 0–1 Vehicle |
| Pickup point | id, name, average retrieval time (per location, or per zone in zone/slot mode) | belongs to Location |
| User | id, name, mobile, email, role, status, password hash | assigned to Locations; performs Tasks; works Shifts |
| Shift | id, user, location, clock-in time, clock-out time | belongs to User |
| Customer | id, mobile (optional), name (optional), language | belongs to Operator; has many Tickets, Vehicles |
| Vehicle | id, plate number, make, model, colour | belongs to Operator; has many Tickets |
| Ticket | id, ticket number, QR token, handover PIN (keyed hash), status, check-in time, request time, scheduled time, close time, key tag, parking spot text, slot (zone/slot mode), pickup point, settings version, custom field values, abandoned reason | links Customer, Vehicle, Location; has Photos, Tasks, Payments, Incidents, Overrides, Handover confirmation |
| Photo | id, type (check-in/return/incident/override), storage (Drive / object storage), file reference, timestamp, taken by, deleted at | belongs to Ticket, Incident or Override |
| Handover confirmation | id, result (no damage / damage reported), method (ticket page tap / signature on attendant device), signature file reference, timestamp | belongs to Ticket (one per ticket) |
| Task | id, type (park/retrieve/move), status, assigned to, timestamps | belongs to Ticket |
| Tariff | id, type, rates, free minutes, daily cap, valid from/to | belongs to Location |
| Payment | id, amount (may be 0), zero-fee reason, tax, tip, tip recipient (attendant or pool), method, gateway ref, status | belongs to Ticket |
| Merchant | id, name, locations, allowed discount types and values, minimum bill, monthly cap, can request cars | belongs to Operator; has validator Users and Validations |
| Validation | id, merchant, validated by, rule type, bill amount, discount value | applied to Ticket |
| Handover override | id, supervisor, ID document type, ID last 4 characters, timestamp | belongs to Ticket; has Photo |
| Incident | id, type, description, status, owner | belongs to Ticket |
| Audit log | id, user, action, entity, before/after, timestamp | references any entity |

### 6.2 Ticket lifecycle

A ticket normally moves through the states below in order. Cancelled is reachable only before Parked, and Abandoned only from Parked.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> CheckedIn
    CheckedIn --> Parked
    CheckedIn --> Cancelled: abandoned before parking
    Parked --> RetrievalRequested
    Parked --> Abandoned: manager marks overdue car
    RetrievalRequested --> Parked: guest cancels before acceptance
    RetrievalRequested --> AssignedInTransit
    AssignedInTransit --> ReadyForPickup: car at pickup point
    ReadyForPickup --> Parked: supervisor re-parks (no-show)
    ReadyForPickup --> Closed: settled, confirmed, handed over
    Closed --> [*]
    Cancelled --> [*]
    Abandoned --> [*]

    CheckedIn: Checked in
    RetrievalRequested: Retrieval requested
    AssignedInTransit: Assigned / in transit
    ReadyForPickup: Ready for pickup
```

1. **Checked in** — ticket created at drop-off; details (and photos, if enabled) captured.
2. **Parked** — parking spot recorded; in zone/slot mode the slot is marked occupied; park task closed.
3. **Retrieval requested** — guest, merchant or staff requests the car (or a scheduled time arrives).
4. **Assigned / In transit** — an attendant accepted the task and is bringing the car.
5. **Ready for pickup** — car at the pickup point; guest notified.
6. **Closed** — balance settled (paid, nothing due per FR-PAY-12, or supervisor-approved per FR-PAY-14), handover confirmed or damage reported (FR-OUT-13, FR-OUT-14), and car handed over; slot freed. Photos are deleted when the guest link expires (FR-DATA-08).

Other transitions:

- A retrieval request cancelled by the guest before an attendant accepts it returns the ticket to Parked (FR-OUT-08).
- A car not collected at the pickup point can be returned to a parking spot by a supervisor (FR-OUT-09); the ticket returns to Parked.
- An overdue vehicle can be marked **Abandoned** by a manager (FR-ADM-10); the ticket ends and the parking spot is freed.

### 6.3 Data retention

- Tickets, payments, handover confirmation results and audit logs: retained 8 years for tax/accounting (configurable per jurisdiction), with guest personal data removed per NFR-PRIV-02.
- Vehicle and ID photos: deleted when the guest link expires after handover (default 7 days), or when the linked incident is resolved (FR-DATA-08).
- Guest contact data and handover signatures: per NFR-PRIV-02 (default 90 days).
- Because the records live in the operator's Google account, the operator keeps them if they stop using VPS (FR-DATA-06).

### 6.4 Google Drive storage layout

On connection (FR-DATA-01), VPS creates one folder per operator in the operator's Drive:

```text
VPS – <Operator name>/
├── Config                          spreadsheet: Locations, Location settings, Custom profiles,
│                                   Custom fields, Zones, Slots, Pickup points, Tariffs,
│                                   Merchants, Users, Templates
├── Guest data <yyyy-mm>            spreadsheet: Customers, Vehicles
│                                   (one per month; deleted whole at end of retention)
├── Audit log <yyyy-mm>             spreadsheet: Audit log
├── <Location name>/
│   ├── Transactions <yyyy-mm>      spreadsheet: Tickets, Tasks, Payments, Validations,
│   │                               Incidents, Handover overrides, Handover confirmations, Shifts
│   ├── Photos/<ticket>/            only when Drive is the photo storage; deleted per FR-DATA-08
│   ├── Signatures/<yyyy-mm>/       handover signatures; deleted at end of retention
│   └── Reports/                    CSV and PDF reports, incident PDFs
└── Backups/                        daily spreadsheet copies, kept 30 days
```

- When S3-compatible object storage is chosen for photos (FR-DATA-07), the Photos folders are not created; photos go to the operator's bucket under `<location>/<ticket>/`, and the same deletion rule applies.
- Tickets reference guests by customer and vehicle id only; names, mobile numbers and plate numbers are kept only in the Guest data spreadsheets. A returning guest or vehicle is copied into the current month's Guest data spreadsheet.
- Each spreadsheet holds a schema version so VPS can upgrade tab layouts safely.
- Search by plate or mobile number (FR-ADM-06) uses an index in the cache, rebuilt from Sheets on start-up.

## 7. Use cases

Five use cases cover the core guest journey and location setup; each lists actor, preconditions, main flow and the main exceptions.

### UC-01 Drop off vehicle

- **Actor:** Valet attendant (primary), Customer
- **Precondition:** Attendant logged in and clocked in at the location.
- **Main flow:**
  1. Guest arrives at the drop-off point and hands over the key.
  2. Attendant enters the plate number and, if given, the guest mobile number, vehicle details and the location's custom fields (FR-IN-01, FR-CFG-03).
  3. Where photos are on, attendant captures the vehicle photos; where the damage diagram is on, notes damage (FR-IN-03, FR-IN-04).
  4. Attendant records key tag; system issues ticket and sends the link and handover PIN (FR-IN-05, FR-IN-02).
  5. Attendant parks the car and types the parking spot (or picks zone and slot); the park task closes (FR-PARK-02, FR-PARK-07).
- **Exceptions:** No network → ticket issued from the device's reserved number block, printed, and synced on reconnect; the SMS is sent after sync (FR-IN-10, FR-IN-06, NFR-AVL-02). Guest declines to give a number → printed ticket only; the guest later requests the car at the valet desk (FR-OUT-03). Slot conflict found on sync (zone/slot mode) → supervisor alerted (FR-PARK-04). Prepaid location → guest pays at check-in (FR-PAY-10).
- **Postcondition:** Ticket in state Parked; parking spot recorded.

### UC-02 Request vehicle

- **Actor:** Customer (or merchant validator)
- **Precondition:** Ticket in state Parked.
- **Main flow:**
  1. Guest opens the ticket link, chooses a pickup point and taps "Request my car" (FR-OUT-01).
  2. System shows the fee and, where online payment is on, offers payment (FR-PAY-02, FR-PAY-03).
  3. System adds the task to the queue and notifies attendants (FR-TASK-01, FR-NOT-02).
  4. Guest sees live status and ETA (FR-OUT-04).
- **Exceptions:** Payment fails → guest can pay at handover. Guest cancels before an attendant accepts → ticket returns to Parked and the fee clock keeps running (FR-OUT-08, FR-PAY-02). Guest has a printed ticket → staff create the request (FR-OUT-03). Restaurant guest asks for the bill → the host validates the ticket and requests the car (FR-PAY-13, FR-OUT-12).

### UC-03 Retrieve and hand over vehicle

- **Actor:** Valet attendant (primary), Customer
- **Precondition:** Retrieval task in queue.
- **Main flow:**
  1. Attendant accepts the task and sees the parking spot, key tag and any photos (FR-TASK-02, FR-TASK-06).
  2. Attendant drives the car to the pickup point and marks it Ready; guest notified (FR-OUT-05).
  3. Attendant verifies the guest by QR scan or handover PIN (FR-OUT-06).
  4. Attendant collects payment if a balance is due and, where photos are on, captures return photos (FR-PAY-04, FR-PAY-12, FR-OUT-07).
  5. Guest checks the car and taps "Car received, no damage" on the ticket page, or signs on the attendant's device (FR-OUT-13).
  6. Attendant hands over the key and the ticket closes.
- **Exceptions:** Task not accepted in time → supervisor alerted (FR-TASK-05). Verification fails → supervisor override with ID record and photo (FR-OUT-10). Guest does not arrive → supervisor may return the car to a parking spot (FR-OUT-09). Balance due and payment required before handover → supervisor approval needed to close (FR-PAY-14). Guest reports damage instead of confirming → incident opened, photos kept, handover completed (FR-OUT-14).
- **Postcondition:** Ticket Closed with handover confirmation recorded; parking spot free; receipt sent (FR-PAY-07); photos deleted when the guest link expires (FR-DATA-08).

### UC-04 Report damage

- **Actor:** Customer or staff; Location manager
- **Main flow:**
  1. Reporter opens the ticket and submits an incident, with photos where available; a guest can do this at handover (FR-OUT-14) or until the ticket link expires, by default 7 days after closure (FR-INC-01, NFR-SEC-02).
  2. Manager reviews the handover confirmation and any check-in and return photos (FR-INC-03).
  3. Manager sets the outcome and exports the report if needed (FR-INC-02, FR-INC-04). Photos are deleted once the incident is resolved or rejected (FR-DATA-08).

### UC-05 Set up a new client location

- **Actor:** Operator admin (primary), Platform admin
- **Precondition:** Platform admin has created the operator and its first admin account (FR-AUTH-07).
- **Main flow:**
  1. Operator admin logs in and connects the operator's Google account; VPS creates the Drive folders and spreadsheets (FR-DATA-01).
  2. Operator admin creates a location and chooses a service profile, e.g. Restaurant (FR-CFG-01).
  3. Operator admin reviews the default settings and changes any that differ, e.g. parking spot entry, vehicle photos, minimum bill for free valet, closing time (FR-CFG-02, FR-CFG-04).
  4. If photos are on, operator admin keeps Google Drive as the photo storage or connects an object storage bucket (FR-DATA-07).
  5. Operator admin adds custom fields, branding, pickup points, tariffs, merchants and staff, and zones if using zone/slot mode (FR-CFG-03, FR-CFG-05, FR-ADM-01, FR-PAY-11, FR-AUTH-03).
  6. Operator admin previews the guest ticket and printed ticket and activates the location (FR-CFG-08).
- **Exceptions:** Google consent declined or revoked → location cannot be activated; admin is shown how to reconnect (FR-DATA-04). Storage nearly full → warning shown (FR-DATA-05).
- **Postcondition:** Location active with its settings version 1 recorded (FR-CFG-06).

## 8. Open questions

- [ ] Which payment gateway and SMS provider will be used in the first market?
- [ ] Is a native app required for customers in v1.0, or is the web ticket page enough?
- [ ] Should licence-plate recognition be planned for v2.0?
- [ ] What is the legally required retention period for vehicle photos in the target jurisdictions, and is 7 days after handover long enough for insurers?
- [ ] Is integration with hotel property-management systems (room charge) required?
- [ ] What legal process (notice period, towing, release to owner) applies to abandoned vehicles in the target jurisdictions?
- [ ] Do hotel guests need in-and-out privileges (taking the car out and back on one ticket) in v1.0?
- [ ] At what client volume should the move from Google Sheets to a relational database (NFR-SCAL-03) be planned?
