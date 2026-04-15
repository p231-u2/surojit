const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'replace-this-in-production';
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const clients = new Set();

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const encoded = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  if (expected !== sig) return null;
  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (Date.now() > parsed.exp) return null;
  return parsed;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function comparePassword(password, stored) {
  const [salt] = stored.split(':');
  return hashPassword(password, salt) === stored;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function initDataFile() {
  if (fs.existsSync(DATA_FILE)) {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!existing?.barber?.passwordHash) {
      existing.barber.passwordHash = hashPassword(process.env.BARBER_PASSWORD || 'barber123');
      fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
    }
    return;
  }
  const initial = {
    barber: {
      username: process.env.BARBER_USERNAME || 'barber',
      passwordHash: hashPassword(process.env.BARBER_PASSWORD || 'barber123'),
      fullName: process.env.BARBER_NAME || 'Alex Fade',
      personalEmail: process.env.BARBER_EMAIL || 'alex.private@example.com',
      businessPhone: process.env.BARBER_BUSINESS_PHONE || '+1-555-123-4567',
      status: 'Available',
      workingHours: { start: '09:00', end: '20:00' }
    },
    appointments: []
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
}

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function parseDateTime(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function to12Hour(time24) {
  const [h, m] = time24.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(`${dateStr}T00:00:00Z`).getTime());
}

function buildSlots(start, end) {
  const slots = [];
  let t = parseDateTime(start);
  const finish = parseDateTime(end);
  while (t < finish) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
    t += 30;
  }
  return slots;
}

function customerAppointmentView(appointment) {
  return {
    id: appointment.id,
    date: appointment.date,
    time: to12Hour(appointment.time),
    customerName: appointment.customerName,
    status: appointment.status
  };
}

function broadcast() {
  const data = loadData();
  const payload = JSON.stringify({
    status: data.barber.status,
    workingHours: data.barber.workingHours,
    businessPhone: data.barber.businessPhone,
    confirmed: data.appointments.filter((a) => a.status === 'Confirmed').map(customerAppointmentView)
  });

  for (const client of clients) {
    client.write(`data: ${payload}\n\n`);
  }
}

function requireBarberAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = verifyToken(token);
  return payload && payload.role === 'barber';
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/customer.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { message: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { message: 'Not found' });
    return;
  }

  const ext = path.extname(filePath);
  const map = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
  };
  res.writeHead(200, { 'Content-Type': map[ext] || 'text/plain' });
  res.end(fs.readFileSync(filePath));
}

initDataFile();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    clients.add(res);
    broadcast();
    req.on('close', () => clients.delete(res));
    return;
  }

  try {
    if (pathname === '/api/barber/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const data = loadData();
      if (body.username !== data.barber.username || !comparePassword(body.password || '', data.barber.passwordHash)) {
        return sendJson(res, 401, { message: 'Invalid credentials' });
      }
      const token = signToken({ role: 'barber', username: body.username, exp: Date.now() + 8 * 60 * 60 * 1000 });
      return sendJson(res, 200, { token, barberName: data.barber.fullName });
    }

    if (pathname === '/api/customer/public-info' && req.method === 'GET') {
      const data = loadData();
      return sendJson(res, 200, {
        status: data.barber.status,
        businessPhone: data.barber.businessPhone,
        workingHours: data.barber.workingHours
      });
    }

    if (pathname === '/api/customer/availability' && req.method === 'GET') {
      const data = loadData();
      const date = url.searchParams.get('date');
      if (!date || !isValidDate(date)) {
        return sendJson(res, 400, { message: 'date query is required (YYYY-MM-DD).' });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const requested = new Date(`${date}T00:00:00Z`);
      if (requested < today) {
        return sendJson(res, 400, { message: 'Please choose today or a future date.' });
      }

      const allSlots = buildSlots(data.barber.workingHours.start, data.barber.workingHours.end);
      const blocked = data.appointments
        .filter((a) => a.date === date && ['Pending', 'Confirmed'].includes(a.status))
        .map((a) => a.time);

      return sendJson(res, 200, {
        date,
        availableSlots: allSlots.filter((s) => !blocked.includes(s)).map((slot24) => ({ slot24, display: to12Hour(slot24) }))
      });
    }

    if (pathname === '/api/customer/appointments' && req.method === 'POST') {
      const body = await parseBody(req);
      const { customerName, phone, date, time } = body;
      if (!customerName || !phone || !date || !time) {
        return sendJson(res, 400, { message: 'customerName, phone, date, and time are required.' });
      }
      if (!isValidDate(date)) {
        return sendJson(res, 400, { message: 'Invalid date format.' });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const requested = new Date(`${date}T00:00:00Z`);
      if (requested < today) {
        return sendJson(res, 400, { message: 'Appointments can only be requested for today or future dates.' });
      }

      const data = loadData();
      const validSlot = buildSlots(data.barber.workingHours.start, data.barber.workingHours.end).includes(time);
      if (!validSlot) {
        return sendJson(res, 400, { message: 'Selected time is outside working hours.' });
      }

      const conflict = data.appointments.find((a) => a.date === date && a.time === time && ['Pending', 'Confirmed'].includes(a.status));
      if (conflict) return sendJson(res, 409, { message: 'This slot is no longer available.' });

      const appointment = {
        id: `apt_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
        customerName,
        phone,
        date,
        time,
        status: 'Pending',
        createdAt: new Date().toISOString()
      };

      data.appointments.push(appointment);
      saveData(data);
      broadcast();

      return sendJson(res, 201, {
        message: 'Appointment request submitted. Waiting for barber approval.',
        appointment: customerAppointmentView(appointment)
      });
    }

    if (pathname === '/api/barber/me' && req.method === 'GET') {
      if (!requireBarberAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const data = loadData();
      return sendJson(res, 200, {
        fullName: data.barber.fullName,
        username: data.barber.username,
        businessPhone: data.barber.businessPhone,
        status: data.barber.status,
        workingHours: data.barber.workingHours
      });
    }

    if (pathname === '/api/barber/status' && req.method === 'PATCH') {
      if (!requireBarberAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const { status } = await parseBody(req);
      const allowed = ['Available', 'Busy', 'On Break', 'Offline'];
      if (!allowed.includes(status)) {
        return sendJson(res, 400, { message: `Status must be one of: ${allowed.join(', ')}` });
      }
      const data = loadData();
      data.barber.status = status;
      saveData(data);
      broadcast();
      return sendJson(res, 200, { message: 'Status updated.', status });
    }

    if (pathname === '/api/barber/working-hours' && req.method === 'PATCH') {
      if (!requireBarberAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const { start, end } = await parseBody(req);
      if (!start || !end) return sendJson(res, 400, { message: 'start and end are required in HH:mm format.' });
      if (parseDateTime(start) >= parseDateTime(end)) return sendJson(res, 400, { message: 'start must be earlier than end.' });

      const data = loadData();
      data.barber.workingHours = { start, end };
      saveData(data);
      broadcast();
      return sendJson(res, 200, { message: 'Working hours updated.', workingHours: data.barber.workingHours });
    }

    if (pathname === '/api/barber/appointments' && req.method === 'GET') {
      if (!requireBarberAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const data = loadData();
      return sendJson(res, 200, {
        appointments: data.appointments.map((a) => ({ ...a, displayTime: to12Hour(a.time) }))
      });
    }

    if (pathname.startsWith('/api/barber/appointments/') && req.method === 'PATCH') {
      if (!requireBarberAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const id = pathname.split('/').pop();
      const { status } = await parseBody(req);
      if (!['Confirmed', 'Rejected'].includes(status)) {
        return sendJson(res, 400, { message: 'Status must be Confirmed or Rejected.' });
      }

      const data = loadData();
      const target = data.appointments.find((a) => a.id === id);
      if (!target) return sendJson(res, 404, { message: 'Appointment not found.' });
      if (target.status !== 'Pending') return sendJson(res, 409, { message: 'Only pending appointments can be updated.' });

      if (status === 'Confirmed') {
        const conflict = data.appointments.find(
          (a) => a.id !== id && a.date === target.date && a.time === target.time && a.status === 'Confirmed'
        );
        if (conflict) {
          return sendJson(res, 409, { message: 'Double-booking prevented. Slot already confirmed.' });
        }
      }

      target.status = status;
      target.updatedAt = new Date().toISOString();
      saveData(data);
      broadcast();

      return sendJson(res, 200, { message: `Appointment ${status.toLowerCase()}.`, appointment: target });
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { message: 'Route not found.' });
    return serveStatic(req, res, pathname);
  } catch (error) {
    return sendJson(res, 500, { message: error.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Barber booking app running at http://localhost:${PORT}`);
});
