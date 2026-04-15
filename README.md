# Barber Appointment Booking System

A modern, secure barber booking platform with separate **Customer** and **Barber Dashboard** interfaces, real-time updates, and role-based access control.

## Features

### Customer Interface
- Live barber status: **Available / Busy / On Break / Offline**.
- Interactive date picker and available time slots in **12-hour AM/PM** format.
- Appointment requests for **today or future dates** only.
- Phone number required for booking and confirmation follow-up.
- View only public information and available slots (no private barber details).

### Barber Dashboard
- Secure login-protected dashboard (signed token auth).
- View and manage pending appointments.
- Accept or reject appointment requests.
- Manage live status and working hours.
- Calendar-style appointment listing with all statuses.
- Automatic double-booking prevention for confirmed slots.

### Appointment Workflow
- New requests are saved as **Pending**.
- If barber approves:
  - status changes to **Confirmed**,
  - slot is blocked from future bookings,
  - appointment appears in confirmed calendar feed.
- If rejected, request marked **Rejected**.

## Security & Data Handling
- Private barber fields (e.g., personal email/password hash) are never returned to customer endpoints.
- Authentication required for all dashboard management APIs.
- Password stored as PBKDF2 hash.
- Public API only exposes status, business phone, and working hours.

## Tech Stack
- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js (native `http` server)
- **Realtime:** Server-Sent Events (SSE)
- **Storage:** JSON file datastore (`data/store.json`)

## Setup & Run

```bash
npm start
```

Open:
- Customer UI: `http://localhost:3000/customer.html`
- Barber UI: `http://localhost:3000/barber.html`

Default barber credentials:
- Username: `barber`
- Password: `barber123`

> Set `BARBER_PASSWORD` as an environment variable in production.

## API Snapshot

### Public (Customer)
- `GET /api/customer/public-info`
- `GET /api/customer/availability?date=YYYY-MM-DD`
- `POST /api/customer/appointments`

### Protected (Barber)
- `POST /api/barber/login`
- `GET /api/barber/me`
- `PATCH /api/barber/status`
- `PATCH /api/barber/working-hours`
- `GET /api/barber/appointments`
- `PATCH /api/barber/appointments/:id`
