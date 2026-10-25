# Valet Parking System

A cloud-hosted valet parking platform that replaces paper valet tickets with a digital ticket. It tracks every vehicle from drop-off to return and lets guests request their car from their phone.

The same product can be configured for paid parking operators, restaurants, hotels and event venues. Each client runs it under their own app name, sets their own rules and roles, and keeps their data in their own Google Drive and Google Sheets. See [Customising for each client](#customising-for-each-client) and the [go-live checklist](#go-live-checklist).

## Repository layout

| Folder | What it is |
| --- | --- |
| [`docs/`](docs/SRS.md) | Software Requirements Specification, and [all test credentials](docs/TEST-CREDENTIALS.md) |
| [`sheets-integration/`](sheets-integration/README.md) | Google Sheets and Excel data layer: schema, business rules, write queue, Excel template |
| `server/` | Express API: staff sign-in and roles, guest ticket endpoints, photo uploads |
| `web/` | React web app: attendant app, admin settings, payment verification and the guest ticket page |

## Run it locally

Requires Node.js 20.19 or later (22 recommended).

```bash
npm install
npm run build        # data layer, server and web app
npm start            # http://localhost:8080 with demo data in memory
```

Open `http://localhost:8080/login`. Until go-live, the sign-in page shows a **Test credentials** panel with every demo staff login (password `valet123` for all), a **Use** button to fill in the form, and the guest page link and handover PIN of each open ticket. The demo has three locations (a restaurant, a paid car park and a hotel) and starts with two parked cars. All test logins are listed in [docs/TEST-CREDENTIALS.md](docs/TEST-CREDENTIALS.md).

The panel and demo data only exist in demo mode. With `NODE_ENV=production` they are switched off, and the server refuses to start if `SEED_DEMO=true`.

To work on the web app with live reload, run `npm run dev:server` and `npm run dev:web` in two terminals, then open `http://localhost:5173`.

### Google Sheets as the database

Without Google, demo data lives in memory and is lost on restart. To make Google Sheets the database, sign in as `admin`, open **Data**, and follow the steps on screen: create a Google OAuth client (Drive and Sheets APIs, redirect URI `http://localhost:8080/api/google/callback`), paste its client ID and secret, and click **Connect Google account** on the computer running the server.

The app then creates a "Valet data" folder in that Google account with four spreadsheets (Config, Transactions, Guest data, Audit log) plus Photos and Backups folders, copies the current data in, and from then on saves every change there and loads everything from there when the server starts. It can only see the files it created (`drive.file` permission).

On the Data page admins can:

- **Share** the data folder by email as **Can view** or **Can edit**, so managers and accountants can open it in Google Drive or Sheets on any device, and change or remove that access
- **Open** the Drive folder and each spreadsheet, and see how close each is to Google's 10 million cell limit
- **Back up now** (copies of all spreadsheets in the Backups folder), **Check & repair tabs**, **Save now**
- **Download Excel** of all data
- **Disconnect** (data stays in Drive)

The Google client secret, sign-in token and sharing list are kept on the server in `google-settings.json` (not in git) and never sent to the browser. Alternatively, `STORE=google` in `server/.env` uses spreadsheets set up with `sheets-integration` scripts (see its README).

### GPS and camera on phones

Phones only allow GPS and the live camera on secure (https) pages. Besides `http://<PC-IP>:8080`, the test server listens on **`https://<PC-IP>:8443`** with its own certificate. Trust it once on each phone: open `http://<PC-IP>:8080/dev-cert.crt`, then on iPhone install it (Settings → General → VPN & Device Management) and switch on full trust (Settings → General → About → Certificate Trust Settings); on Android install it as a CA certificate. The steps are also under **GPS and camera on phones** on the sign-in page. The live site will use a normal certificate instead.

```bash
npm test             # data layer and API tests
```

## Branches and releases

The repository has two branches. The app code is the same in both; the branch decides where it is deployed:

| Branch | What it is | Deploys to |
| --- | --- | --- |
| `demo` (default) | All work lands here through pull requests. Demo mode with test logins ([docs/TEST-CREDENTIALS.md](docs/TEST-CREDENTIALS.md)) | https://valetpay-demo.netlify.app and GitHub Pages |
| `production` | The live site: production mode, no test credentials | https://valetpay.onrender.com (Render) |

Work on a short-lived branch, open a pull request into `demo`, and delete the branch once it is merged. Check the change on the demo site, then go live by fast-forwarding `production` to `demo`:

```bash
git checkout production && git pull && git merge --ff-only origin/demo && git push
git checkout demo
```

Never commit straight to `production`; fix things through `demo` and release again, so the two branches never drift apart.

## Live demo on GitHub Pages

The demo is published on every push to the `demo` branch, after the tests pass (see [Branches and releases](#branches-and-releases)):

- **https://valetpay-demo.netlify.app**: the main demo address, published by `.github/workflows/netlify.yml`. It needs the repository secrets `NETLIFY_AUTH_TOKEN` (a Netlify personal access token) and `NETLIFY_SITE_ID`; without them the workflow skips publishing. New Netlify sites may have "team login" visitor protection on, so switch visitor access to public in the site settings, or only your team can open it.
- **https://susheelsanagapalli.github.io/valet-parking-system/**: the same demo on GitHub Pages (`.github/workflows/pages.yml`).

GitHub Pages cannot run a server, so the Pages build runs the Valet server's own route code (`server/src/api.ts`) and data layer inside the browser. Everything works there: test logins on the sign-in page, check-in, parking spot with GPS, the queue, guest page, QR payments, handover, settings and tap-to-send SMS. The data is kept in that browser only (so open guest links in another tab of the same browser), and **Reset demo data** starts again. Google Sheets is not available in the Pages demo.

To use the Pages site with a real server and shared data instead, set the repository variable `VALET_API_URL` to the server's https address and `CORS_ORIGINS=https://susheelsanagapalli.github.io` on the server.

## Deploy to Render with GitHub Actions

Every push to the `production` branch runs the tests and build (`.github/workflows/ci.yml`); once they pass, Render deploys that commit by itself (`autoDeployTrigger: checksPass` in `render.yaml`). Pull requests only run the tests.

One-time setup:

1. Sign up at https://render.com with GitHub and allow access to this repository.
2. **New → Blueprint**, choose this repository and click **Apply**. Render reads `render.yaml` and creates the `valetpay` web service (Singapore, free plan, random `AUTH_SECRET` and `PIN_HMAC_SECRET`). It runs in production mode at **https://valetpay.onrender.com** (no test credentials; the demo with test logins is https://valetpay-demo.netlify.app).
3. In the service, open **Settings → Deploy Hook** and copy the URL.
4. In GitHub, add it as a secret and the service address as a variable:
   ```bash
   gh secret set RENDER_DEPLOY_HOOK_URL      # paste the Deploy Hook URL
   gh variable set RENDER_SERVICE_URL --body "https://valetpay.onrender.com"   # your service URL
   ```
5. Push to the `production` branch (see [Branches and releases](#branches-and-releases)).

The deployed site has a real https address, so GPS, the live QR camera and Google sign-in work on phones with nothing to install. For Google Sheets, add `https://<your-service>.onrender.com/api/google/callback` as an authorised redirect URI on the Google OAuth client, then connect on the site's **Data** page.

The free plan sleeps after 15 minutes without visits (the first visit then takes about a minute) and forgets saved settings on every deploy, including the Google connection. To keep them, switch to the Starter plan, add a disk mounted at `/var/data`, and set `DATA_DIR=/var/data`.

Until go-live the site runs in demo mode, so the sign-in page shows the test logins to anyone with the link. Don't connect real guest data while demo mode is on. To go live, follow the [go-live checklist](#go-live-checklist).

## Guest SMS from your own number (free)

Guests get an SMS with their ticket link and handover PIN at check-in, then "car ready", "parked again" (no-show), a receipt when the ticket closes, and a notice if a QR payment can't be found. Messages are sent from **your own mobile number** by an Android phone with that SIM, using a free gateway app. No paid SMS provider is needed.

Set it up in the app: sign in as `admin`, open **Settings → Guest SMS**, enter the sender mobile number, and choose where that SIM is:

- **iPhone:** nothing to download. iPhones don't let apps send SMS by themselves, so after check-in, "car ready" and handover the app shows a **Send SMS** button that opens Messages with the guest's number and text filled in; one tap on Send delivers it from the iPhone's number. Open the staff app on that iPhone (the screen shows a QR code) and add it to the home screen.
- **Android:** fully automatic. The screen gives a QR code and button to download the free **SMS Gateway for Android** app ([direct APK](https://github.com/capcom6/android-sms-gateway/releases/latest/download/app-release.apk), official GitHub release; not on Google Play). Install it on the phone with the SIM, allow SMS, switch on **Cloud server**, and copy the username and password it shows into the screen.

Then use **Send a test SMS** on the same screen. The settings are saved on the server in `sms-settings.json` (not in git); the gateway password is never shown again.

Without saved settings, the server falls back to `SMS_PROVIDER` in `server/.env` (default `manual`, tap-to-send). `log` only prints messages, and `httpsms` uses the httpSMS app (https://httpsms.com) with `HTTPSMS_API_KEY` and `SMS_FROM`.

Failed messages are retried 3 times; the status of each message is shown under Recent SMS. Mobile numbers without a country code are treated as Indian (+91).

Limits to know before go-live: messages cost whatever your SIM plan charges and are subject to its daily SMS limit (often 100 per day on prepaid plans), and Indian operators may block a personal number that sends a lot of business SMS. For larger volumes, move to a DLT-registered SMS provider (SRS FR-NOT-05).

## Customising for each client

### One deployment per client

Every client (operator) gets **their own deployment**: their own Render service, their own staff accounts, and their own Google account holding their data. Nothing is shared between clients, so one client can never see another's cars, guests or payments. Inside one deployment, a client can run as many locations as they like (for example three restaurants and a hotel).

To add a client: create a new Render service from this repository (**New → Blueprint**, give it a different name such as `valet-<client>`), then follow the [go-live checklist](#go-live-checklist) for that service. Every service runs the same code, so one push to the `production` branch updates all clients.

### What each client can change in the app (no code)

Sign in as an `operator_admin`:

| What | Where |
| --- | --- |
| Locations: name, address, service profile (restaurant, paid parking, hotel, event venue, custom) | **Settings → New location** (on a new installation this form appears on the first screen) |
| App name shown to guests and in SMS (e.g. "MallValet") | **Settings → New location → App name**, set per location when it is created |
| Ticket number prefix (e.g. `PM` gives PM0001) | **Settings → New location → Ticket prefix** |
| Parking spot capture: text, GPS, photo (off, optional, required), zone/slot list, GPS accuracy needed | **Settings → Parking spot** |
| Vehicle makes, models of each make, and colours that attendants pick from at check-in; whether "Other…" may be typed | **Settings → Vehicle list** (**Save for all locations** copies it everywhere) |
| Vehicle photos, guest damage confirmation, "I'll arrive in…" options, pickup points, average retrieval time | **Settings** |
| Tariff (complimentary, flat, hourly with free minutes and daily cap) and payment methods | **Settings → Charges and payment** |
| The client's own UPI payment QR (approved by a platform admin before guests see it) | **Settings → Payment QR** |
| SMS sender number | **Settings → Guest SMS** |
| Staff accounts, roles (built-in or custom) and which locations each person can use | **Staff** (see [Staff accounts and roles](#staff-accounts-and-roles)) |

Attendants only see the fields a location switches on: a field set to **Off** never appears, **Optional** fields are marked "(optional)" and **Required** ones have a `*`. This applies to the parking spot text, GPS, spot photo and zone/slot, vehicle photos, and the stay end date (hotels with in-and-out). One deliberate exception: when GPS is on but gives no usable reading, the spot description appears even if it is switched off, so a car is never parked without a usable location (SRS FR-PARK-08).

Each new location starts with a list of common makes and models in India and 11 colours, with "Other…" allowed. Switch "Other…" off to make attendants pick only from the list; the server then refuses anything else too.

Settings changes apply to new tickets; cars already checked in keep the rules they arrived with. The app name and ticket prefix can't be changed after a location is created yet; create a new location instead.

### What needs a code change today

Logo, brand colours and the browser tab title are the same for every client in this build (the SRS lists white-label branding for v1.0, but it is not built yet). Until it is, change them per deployment here:

| What | File |
| --- | --- |
| Brand colours (top bar, buttons, guest page header) | `web/src/styles.css`: `--brand`, `--accent`, `--hero-from`, `--hero-to` under `:root` (and the dark-mode block below it) |
| Browser tab title and phone status-bar colour | `web/index.html`: `<title>` and `theme-color` |
| Logo (currently a car icon) | `web/src/pages/StaffLayout.tsx` and `web/src/pages/GuestTicket.tsx` (`brand-mark`) |

A code change applies to every deployment built from that branch, so per-client colours mean a branch per client. Building branding as a per-location setting would remove that.

### Customising the demo site

The GitHub Pages demo is one shared site for showing the product; never put real client data on it.

- **For one sales meeting:** open the demo, sign in as `admin`, and create a location with the client's name, app name and ticket prefix under **Settings → New location**, then pick their service profile and tariff. This stays in that browser only, so do it on the device you present from. **Reset demo data** removes it.
- **For everyone who opens the demo:** edit the demo locations and parked cars in `server/src/seedData.ts` (names, app name, ticket prefix, service profile, sample cars), then release it to the `demo` branch. Visitors who opened the demo before keep their saved data until they press **Reset demo data**.

## Staff accounts and roles

### Demo and production

| | Demo (GitHub Pages, or a server with `SEED_DEMO=true`) | Production (`NODE_ENV=production`) |
| --- | --- | --- |
| Sign-in page | Shows a **Test credentials** panel with every demo login (password `valet123`) | No credentials shown; demo logins don't exist |
| Accounts | Demo users, plus any you add on the **Staff** page | The first admin from `STAFF_USERS_FILE`, then everyone added on the **Staff** page |
| Where changes are saved | Pages demo: that browser only. Server in demo mode: memory, unless `DATA_DIR` is set | `staff.json` in `DATA_DIR` (keep it on a persistent disk) |

### Who can manage staff

The **Staff** tab appears for anyone with the permission "Manage staff accounts and roles": **platform admins** and **operator admins** by default, or a custom role that includes it.

- An admin can only manage people whose role has **no more permissions than their own**, and only give access to **locations they work at themselves**. So an operator admin can't create, change or reset a platform admin, and can't hand out the "Approve payment QRs" permission.
- Nobody can switch off, delete or change the role or locations of **their own** account, so an admin can't lock themselves out by accident.

### Adding a user

1. **Staff → Users → Add user**: full name, username (can't be changed later), role, and locations ("All locations" or tick specific ones).
2. A starting password is generated (you can type your own, at least 10 characters). Click **Create user**.
3. The sign-in details are shown **once**, with a **Copy** button. Give them to the person privately.
4. At first sign-in they must choose their own password before they can use anything. Until then the list shows **Must set password**.

### Roles

- **Built-in roles** (platform admin, operator admin, location manager, supervisor, attendant, merchant validator) can't be changed.
- **Staff → Roles → New role** creates a custom role: give it a name (e.g. "Night supervisor") and tick exactly what it can do. Permissions you don't have yourself are greyed out.
- Changing a custom role's permissions applies to its users immediately. A role can only be deleted when nobody has it.

### Passwords

- **Users change their own password** by clicking their name in the top bar → **Change password**. They need the current one. Their other devices are signed out; the device they're using stays signed in.
- **Forgotten password:** an admin opens **Staff → Password** next to the person, and gives them the new starting password. Their open sessions end, and they must choose a new one at next sign-in.
- **Someone leaves:** **Switch off** ends their sessions immediately and blocks sign-in; **Switch on** restores the account. **Delete** removes it for good.
- Only scrypt hashes are stored, never passwords. Five wrong passwords lock the account for 15 minutes.

## GPS: accuracy and poor signal

### How capture works

When an attendant taps **Capture location**, the phone is watched for up to **30 seconds** and the most accurate reading is kept. It stops by itself as soon as a reading is within the location's **GPS accuracy needed** (default 20 m, set under **Settings → Parking spot**). While it is still improving, **Use this reading (±N m)** stops early and keeps the best reading so far. Old positions cached by the phone are never used, because the attendant has just driven the car and an older reading would point to the road, not the spot.

If the reading is worse than the accuracy needed, or there is no reading at all, the spot description (landmark) becomes required, so a spot is never saved with only a bad position. The guest never sees GPS; attendants get a **Map** link with walking directions to the car.

### Why readings are poor, and what the app tells the attendant

| Situation | What happens | What to do |
| --- | --- | --- |
| Underground or indoor parking | Satellites can't be seen; after 30 s: "No GPS fix within 30 seconds" | Describe the spot (level, pillar, bay). For basements, switch GPS to **Optional** and turn on the **zone/slot list** or make the text field **Required**. |
| Near tall buildings or under a roof | Readings of 20–60 m; landmark becomes required | Take the reading in the open next to the car, or add a landmark. |
| iPhone with **Precise Location** off, or Android with **Google Location Accuracy** off | Readings of 500 m or more; the app explains how to switch it on | iPhone: Settings → Privacy & Security → Location Services → Safari Websites → Precise Location on. Android: Settings → Location → Location services → Google Location Accuracy on. |
| Location permission refused | "Location permission is off" with the steps for iPhone and Android | Allow location for the site, then reload. |
| No mobile data | GPS still works (satellites don't need internet), but the first fix can take up to 30 s. A banner says the phone is offline | Wait for the fix; save once there is signal. |
| Signal lost while saving | "No internet connection. Nothing you entered is lost" and the form keeps everything | Walk to where there is signal and tap **Save parking spot** again. |
| Site opened over plain `http` on a phone | Phones refuse GPS on insecure pages; the app says so | Use the https address (the live site is always https). |

### Checks before go-live for each location

1. Stand where cars are parked (every level, if there are several) and capture a test location on each attendant phone. Note the accuracy shown.
2. Open **Settings → Parking spot** and set **GPS accuracy needed** just above what you saw in the open areas (20–30 m suits most open car parks).
3. If any area gives no fix or more than 50 m (basements, covered decks), make the text field **Required** or use the zone/slot list there.
4. On each phone, switch on Precise Location (iPhone) or Google Location Accuracy (Android), and allow location for the site.

## Go-live checklist

Do this once per client deployment. Steps 1–7 are set-up, step 8 is the test before real cars, step 9 is the switch.

### 1. Choose a plan that keeps data

The Render **free** plan sleeps after 15 minutes (the first attendant of the day waits about a minute) and forgets everything stored on its disk at every deploy. For a live client:

- [ ] Switch the service to the **Starter** plan (or higher).
- [ ] Add a **disk** mounted at `/var/data` (Service → Disks).
- [ ] Set the environment variable `DATA_DIR=/var/data`. Staff accounts and roles (`staff.json`), the Google connection, SMS settings, uploaded photos and the pending-writes queue are kept there. Without a disk, accounts added in the app are lost at the next deploy.

### 2. Create the first admin account

Only the first account is made outside the app; everyone else is added on the **Staff** page (step 7). On your computer, in this repository:

```bash
npm install && npm run build
npm run staff-user -- --file staff-users.json --username owner --name "Owner Name" --role operator_admin
```

It asks for the password without showing it (at least 10 characters) and stores only a scrypt hash. Use `--role platform_admin` instead for your own team's account (platform admins can also approve payment QRs and manage operator admins).

- [ ] In Render: **Environment → Secret Files → Add**, file name `staff-users.json`, paste the file's contents.
- [ ] Set `STAFF_USERS_FILE=/etc/secrets/staff-users.json`.
- [ ] Don't commit `staff-users.json` to git.

On the first start the server copies these accounts to `staff.json` in `DATA_DIR`, and from then on saves every change made in the app there (new users, roles, password changes). `STAFF_USERS_FILE` is only read again if `staff.json` is missing, so after go-live manage accounts in the app, not in the file. Include `staff.json` in your backups of the disk.

### 3. Switch off demo mode

- [ ] Set `NODE_ENV=production`.
- [ ] Set `SEED_DEMO=false`.
- [ ] Keep the `AUTH_SECRET` and `PIN_HMAC_SECRET` that Render generated. **Never change them after go-live**: a new `AUTH_SECRET` signs everyone out, and a new `PIN_HMAC_SECRET` makes the handover PIN of every car on site stop working.
- [ ] Using a custom domain (e.g. `valet.client.com`)? Add it in Render and set `PUBLIC_BASE_URL=https://valet.client.com`. Guest ticket links in SMS are built from it. Without a custom domain, Render's address is used automatically.

The server refuses to start in production without staff accounts (`STAFF_USERS_FILE` or a saved `staff.json`), without a public address, with `SEED_DEMO=true`, or with missing secrets, and names the setting in the log. In production the sign-in page never shows test credentials and the demo logins don't exist.

### 4. Connect the client's Google account (where the data lives)

Until this is done, production keeps data **in memory only and loses it on every restart and deploy**; the server log warns about it at start-up.

- [ ] In the client's Google account, open https://console.cloud.google.com, create a project, enable the **Google Drive API** and **Google Sheets API**.
- [ ] Create an **OAuth client** (Web application) with the redirect URI `https://<your-service-address>/api/google/callback`.
- [ ] On the **OAuth consent screen**, set the publishing status to **In production**. In "Testing", Google stops the connection after 7 days. The app only asks for `drive.file` (files it creates), so Google's review is not needed.
- [ ] Sign in to the app as the operator admin, open **Data**, paste the client ID and secret, and click **Connect Google account** while signed in to the client's Google account.
- [ ] Check that a "Valet data" folder with four spreadsheets appeared in their Google Drive, then click **Back up now** once.
- [ ] Share the folder with the client's manager or accountant from the **Data** page if they need it.

Alternative without a disk: set up the spreadsheets with the `sheets-integration` scripts and set `STORE=google` plus the Google variables in the environment (see [its README](sheets-integration/README.md)), and set `PHOTO_STORAGE=google_drive` so photos aren't kept on the server.

### 5. Set up the locations

Sign in as the operator admin. A new installation opens on **New location**.

- [ ] Create each location with the client's name, address, service profile, **app name** and **ticket prefix**. These two can't be changed later.
- [ ] Go through **Settings** for each location: parking spot capture (see [GPS checks](#checks-before-go-live-for-each-location)), vehicle photos, pickup points, arrival options, average retrieval time, tariff and payment methods.
- [ ] Upload the client's **UPI payment QR** with the payee name exactly as UPI apps show it. A `platform_admin` checks the payee and approves it under **QR approvals**; guests only see it after that.

### 6. Set up guest SMS

- [ ] **Settings → Guest SMS**: enter the sender number and choose iPhone (tap-to-send) or Android (gateway app), as described in [Guest SMS](#guest-sms-from-your-own-number-free).
- [ ] **Send a test SMS** to your own phone and open the link in it: it must open the guest page on the live address.
- [ ] Check the SIM plan's daily SMS limit against the expected number of cars.

### 7. Add the staff and prepare their phones

- [ ] If the client needs roles beyond the built-in ones, create them under **Staff → Roles** first.
- [ ] Add every person under **Staff → Users → Add user** with their role and locations, and give each their sign-in details privately ([details](#adding-a-user)). Never share accounts: the audit log records who did what.
- [ ] Open the live address on each phone and **Add to Home Screen**.
- [ ] Allow location and camera for the site; switch on Precise Location (iPhone) or Google Location Accuracy (Android).
- [ ] Each person signs in once and chooses their own password.

### 8. Test with one real car before opening

- [ ] `https://<your-service-address>/api/health` shows `"ok":true` and the commit you expect.
- [ ] The sign-in page has **no Test credentials** panel, and `attendant` / `valet123` is refused.
- [ ] A new user you added can sign in, is asked to choose a password, and only sees the tabs their role allows.
- [ ] Check in a test car with your own mobile number; the SMS arrives with the link and PIN.
- [ ] Record the spot at the real parking area (GPS accuracy as expected, or a landmark).
- [ ] From the guest link: request the car; in **Queue** accept it, mark it at the pickup point, verify the PIN, take payment (QR verified under **Payments**, or cash), get the "no damage" confirmation and hand over.
- [ ] The receipt SMS arrives, and the ticket appears in the Transactions spreadsheet in Google Drive.
- [ ] Restart the service in Render; sign in again and check the test ticket, settings and staff accounts are still there.

### 9. Go live

- [ ] Remove the test ticket's data if the client wants a clean start (Data → Download Excel first, then clean the rows in the spreadsheets), or keep it as a record.
- [ ] Tell the attendants the date and give them their usernames.
- [ ] After the first day: check **Dashboard**, **Payments** and **Data → Back up now**.

Not yet built, so plan around them: WhatsApp messages and overdue reminders, password reset by email (an admin resets it on the **Staff** page), automatic deletion of photos and personal data, capacity alert emails, monthly spreadsheet rollover, and the abandoned vehicle process.

## What works in this build

- Check-in with plate, key tag, optional guest details and vehicle photos; ticket number, QR code and a handover PIN shown once
- Parking spot capture by location settings: text, GPS with accuracy check and fallback, spot photo, zone/slot
- Guest ticket page: status and ETA, "I'll arrive in…" requests, cancel, pay by the location's payment QR with a transaction reference, "Car received, no damage" or damage report, rating
- Attendant queue with one task per attendant, VIP priority, ready at pickup, guest verification by QR scan or PIN, cash/card payment, signature on the attendant's phone, handover, re-park after a no-show
- Hotel in-and-out: hand over without closing, guest returned, end stay
- Supervisor verification of QR payments; platform admin approval of each location's payment QR
- Location settings editor and new locations from service profiles
- Staff sign-in with lockout after 5 failed attempts, built-in roles and permission checks on every API call
- Staff page for admins: add users with a role and locations and a starting password, custom roles with chosen permissions, password reset, switch off and delete; users choose their own password at first sign-in and can change it under their account

Not yet built: WhatsApp messages and overdue reminders, password reset by email, photo and personal data deletion jobs, capacity alert emails, monthly spreadsheet rollover, and the abandoned vehicle process.

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
