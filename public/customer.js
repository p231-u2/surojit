const statusPill = document.getElementById('statusPill');
const businessPhone = document.getElementById('businessPhone');
const hours = document.getElementById('hours');
const dateInput = document.getElementById('date');
const timeSelect = document.getElementById('time');
const bookingForm = document.getElementById('bookingForm');
const bookingMsg = document.getElementById('bookingMsg');
const confirmedList = document.getElementById('confirmedList');

const today = new Date().toISOString().split('T')[0];
dateInput.min = today;
dateInput.value = today;

function setStatus(status) {
  statusPill.innerHTML = `<span class="dot ${status}"></span><span>${status}</span>`;
}

function renderConfirmed(appointments) {
  if (!appointments.length) {
    confirmedList.innerHTML = '<p class="helper">No confirmed appointments yet.</p>';
    return;
  }

  confirmedList.innerHTML = appointments
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((a) => `
      <div class="appt">
        <strong>${a.date}</strong> · ${a.time}
        <span class="badge Confirmed">Confirmed</span>
      </div>
    `)
    .join('');
}

async function fetchPublicInfo() {
  const res = await fetch('/api/customer/public-info');
  const info = await res.json();
  setStatus(info.status);
  businessPhone.textContent = `Business contact: ${info.businessPhone}`;
  hours.textContent = `Working hours: ${to12(info.workingHours.start)} - ${to12(info.workingHours.end)}`;
}

function to12(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

async function loadSlots() {
  bookingMsg.textContent = '';
  const date = dateInput.value;
  const res = await fetch(`/api/customer/availability?date=${date}`);
  const data = await res.json();

  if (!res.ok) {
    timeSelect.innerHTML = '';
    bookingMsg.textContent = data.message;
    return;
  }

  timeSelect.innerHTML = data.availableSlots.length
    ? data.availableSlots.map((s) => `<option value="${s.slot24}">${s.display}</option>`).join('')
    : '<option value="">No slots available</option>';
}

bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    customerName: document.getElementById('customerName').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    date: dateInput.value,
    time: timeSelect.value
  };

  const res = await fetch('/api/customer/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  bookingMsg.textContent = data.message;
  if (res.ok) {
    bookingForm.reset();
    dateInput.value = today;
    await loadSlots();
  }
});

dateInput.addEventListener('change', loadSlots);

const events = new EventSource('/events');
events.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  setStatus(payload.status);
  businessPhone.textContent = `Business contact: ${payload.businessPhone}`;
  hours.textContent = `Working hours: ${to12(payload.workingHours.start)} - ${to12(payload.workingHours.end)}`;
  renderConfirmed(payload.confirmed || []);
  loadSlots();
};

(async function init() {
  await fetchPublicInfo();
  await loadSlots();
})();
