const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
const controlMsg = document.getElementById('controlMsg');
const barberMeta = document.getElementById('barberMeta');
const pendingList = document.getElementById('pendingList');
const calendarList = document.getElementById('calendarList');
const calendarDate = document.getElementById('calendarDate');

let token = localStorage.getItem('barber_token') || null;
let appointments = [];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function to12(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

function renderPending() {
  const pending = appointments.filter((a) => a.status === 'Pending');
  if (!pending.length) {
    pendingList.innerHTML = '<p class="helper">No pending requests.</p>';
    return;
  }

  pendingList.innerHTML = pending
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((a) => `
      <div class="appt">
        <strong>${a.customerName}</strong> (${a.phone})<br/>
        ${a.date} · ${a.displayTime}
        <div class="row" style="margin-top:8px;">
          <button class="accept" onclick="updateAppointment('${a.id}','Confirmed')">Accept</button>
          <button class="reject" onclick="updateAppointment('${a.id}','Rejected')">Reject</button>
        </div>
      </div>
    `)
    .join('');
}

function renderCalendar() {
  const date = calendarDate.value;
  const filtered = date ? appointments.filter((a) => a.date === date) : appointments;

  if (!filtered.length) {
    calendarList.innerHTML = '<p class="helper">No appointments for selected date.</p>';
    return;
  }

  calendarList.innerHTML = filtered
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((a) => `
      <div class="appt">
        <strong>${a.date}</strong> · ${a.displayTime}
        <span class="badge ${a.status}">${a.status}</span><br/>
        ${a.customerName} (${a.phone})
      </div>
    `)
    .join('');
}

async function fetchMe() {
  const res = await fetch('/api/barber/me', { headers: authHeaders() });
  if (!res.ok) throw new Error('Unauthorized');
  const me = await res.json();
  barberMeta.innerHTML = `
    <p><strong>${me.fullName}</strong></p>
    <p class="helper">Business phone: ${me.businessPhone}</p>
    <p class="helper">Current status: ${me.status}</p>
  `;
  document.getElementById('statusSelect').value = me.status;
  document.getElementById('startHour').value = me.workingHours.start;
  document.getElementById('endHour').value = me.workingHours.end;
}

async function fetchAppointments() {
  const res = await fetch('/api/barber/appointments', { headers: authHeaders() });
  const data = await res.json();
  appointments = data.appointments || [];
  renderPending();
  renderCalendar();
}

window.updateAppointment = async (id, status) => {
  const res = await fetch(`/api/barber/appointments/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status })
  });
  const data = await res.json();
  controlMsg.textContent = data.message;
  await fetchAppointments();
};

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const res = await fetch('/api/barber/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (!res.ok) {
    loginMsg.textContent = data.message;
    return;
  }

  token = data.token;
  localStorage.setItem('barber_token', token);
  loginCard.classList.add('hidden');
  dashboard.classList.remove('hidden');
  await fetchMe();
  await fetchAppointments();
});

document.getElementById('saveStatus').addEventListener('click', async () => {
  const status = document.getElementById('statusSelect').value;
  const res = await fetch('/api/barber/status', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status })
  });
  const data = await res.json();
  controlMsg.textContent = data.message;
  await fetchMe();
});

document.getElementById('saveHours').addEventListener('click', async () => {
  const start = document.getElementById('startHour').value;
  const end = document.getElementById('endHour').value;
  const res = await fetch('/api/barber/working-hours', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ start, end })
  });
  const data = await res.json();
  controlMsg.textContent = data.message;
  await fetchMe();
  await fetchAppointments();
});

calendarDate.addEventListener('change', renderCalendar);

const events = new EventSource('/events');
events.onmessage = () => {
  if (token) {
    fetchAppointments();
    fetchMe();
  }
};

(async function init() {
  if (!token) return;
  try {
    loginCard.classList.add('hidden');
    dashboard.classList.remove('hidden');
    await fetchMe();
    await fetchAppointments();
  } catch (err) {
    localStorage.removeItem('barber_token');
    token = null;
    loginCard.classList.remove('hidden');
    dashboard.classList.add('hidden');
  }
})();
