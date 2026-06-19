const categories = [
  "House Rent",
  "Meal Costs",
  "WiFi Bill",
  "Electricity Bill",
  "Gas Bill",
  "Water Bill",
  "Cleaning Expenses",
  "Other Custom Expenses"
];

let state = null;
let session = null;
let currentRole = "";
let currentView = "";
let currentUserId = "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function money(value) {
  return `${Number(value || 0).toLocaleString("en-BD")} BDT`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || "Request failed");
  return payload;
}

async function boot() {
  try {
    session = await api("/api/session");
    await loadState();
    showApp();
  } catch {
    showLogin();
  }
}

async function loadState() {
  state = await api("/api/state");
  currentRole = session.role;
  currentUserId = session.userId || state.users[0]?.id || "";
  if (!currentView) currentView = currentRole === "admin" ? "admin-dashboard" : "user-dashboard";
}

function showLogin(message = "") {
  session = null;
  state = null;
  $("#loginScreen").classList.remove("is-hidden");
  $(".app-shell").classList.add("is-hidden");
  $("#loginMessage").textContent = message;
}

function showApp() {
  $("#loginScreen").classList.add("is-hidden");
  $(".app-shell").classList.remove("is-hidden");
  $("#adminNav").classList.toggle("is-hidden", currentRole !== "admin");
  $("#userNav").classList.toggle("is-hidden", currentRole !== "user");
  $(".role-switch").classList.add("is-hidden");
  render();
}

function render() {
  renderSelectors();
  renderActiveView();
}

function renderSelectors() {
  $("#paymentUser").innerHTML = state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)
    .join("");
  $("#expenseCategory").innerHTML = categories
    .map((category) => `<option>${escapeHtml(category)}</option>`)
    .join("");
}

function renderActiveView() {
  const titles = {
    "admin-dashboard": "Dashboard",
    people: "People",
    expenses: "Expenses",
    payments: "Payments",
    requests: "Payment Requests",
    reports: "Reports",
    settings: "Settings",
    audit: "Audit Logs",
    developer: "Developer Details",
    "user-dashboard": "Dashboard",
    "user-expenses": "Expense Details",
    "user-payments": "Payment History",
    "user-request": "Request Payment"
  };
  $("#pageTitle").textContent = titles[currentView] || "Dashboard";
  $("#panelLabel").textContent = currentRole === "admin" ? "Admin Panel" : "User Panel";
  $("#activeAccount").textContent = session.name || session.username;
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === currentView));
  $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === currentView));

  const renderers = {
    "admin-dashboard": renderAdminDashboard,
    people: renderPeople,
    expenses: renderExpenses,
    payments: renderPayments,
    requests: renderRequests,
    reports: renderReports,
    settings: renderSettings,
    audit: renderAudit,
    developer: renderDeveloper,
    "user-dashboard": renderUserDashboard,
    "user-expenses": renderUserExpenses,
    "user-payments": renderUserPayments,
    "user-request": renderUserRequest
  };
  renderers[currentView]();
}

function openMobileMenu() {
  document.body.classList.add("menu-open");
}

function closeMobileMenu() {
  document.body.classList.remove("menu-open");
}

function renderAdminDashboard() {
  const month = currentMonth();
  const totals = allTotals(month);
  const pending = state.requests.filter((request) => request.status === "Pending").length;
  const currentExpenses = state.expenses
    .filter((expense) => expense.month === month)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  $("#admin-dashboard").innerHTML = `
    ${metrics([
      ["Total Members", state.users.length],
      ["Total Expenses", money(totals.due)],
      ["Total Paid", money(totals.paid)],
      ["Total Due", money(totals.balance)],
      ["Pending Payments", pending],
      ["Current Month Expenses", money(currentExpenses)]
    ])}
    <div class="chart-row">
      <div class="panel">
        <div class="section-head"><h2>Member Balances</h2></div>
        ${barList(state.users.map((user) => ({ label: user.name, value: statementForUser(user.id, month).remaining })))}
      </div>
      <div class="panel">
        <div class="section-head"><h2>Recent Activity</h2></div>
        ${renderLogList(state.auditLogs.slice(0, 7))}
      </div>
    </div>
  `;
}

function renderPeople() {
  const users = filtered(state.users, [(user) => user.name, (user) => user.phone, (user) => user.username]);
  $("#people").innerHTML = `
    <div class="section-head">
      <h2>Profiles</h2>
      <button class="primary-btn" data-action="open-person">Add Person</button>
    </div>
    <div class="people-grid">
      ${users.map(renderPersonCard).join("") || empty("No profiles found.")}
    </div>
  `;
}

function renderPersonCard(user) {
  const totals = totalsForUser(user.id);
  const reminderButton = currentRole === "admin"
    ? `<button class="ghost-btn" data-action="whatsapp-reminder" data-id="${user.id}">WhatsApp Reminder</button>`
    : "";
  const avatar = user.image
    ? `<img class="avatar" src="${escapeAttr(user.image)}" alt="${escapeAttr(user.name)}">`
    : `<div class="avatar">${escapeHtml(initials(user.name))}</div>`;
  return `
    <article class="person-card">
      <div class="person-top">
        ${avatar}
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <p>${escapeHtml(user.phone || "No phone added")}</p>
          <span class="pill">Username: ${escapeHtml(user.username || "not set")}</span>
        </div>
      </div>
      <div class="mini-stats">
        <div><span>Total Due</span><strong>${money(totals.due)}</strong></div>
        <div><span>Balance</span><strong>${money(totals.balance)}</strong></div>
      </div>
      <div class="actions">
        ${reminderButton}
        <button class="ghost-btn" data-action="edit-person" data-id="${user.id}">Edit</button>
        <button class="danger-btn" data-action="delete-person" data-id="${user.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderExpenses() {
  const expenses = filtered(state.expenses, [
    (expense) => expense.category,
    (expense) => expense.description,
    (expense) => expense.month
  ]);
  const addButton = currentRole === "admin" ? `<button class="primary-btn" data-action="open-expense">Add Cost</button>` : "";
  const headers = currentRole === "admin"
    ? ["Date", "Month", "Category", "Amount", "Split", "Assigned To", "Actions"]
    : ["Date", "Month", "Category", "Amount", "Split", "Assigned To"];
  $("#expenses").innerHTML = `
    <div class="section-head">
      <h2>Expense Management</h2>
      ${addButton}
    </div>
    ${table(headers,
      expenses.map((expense) => {
        const row = [
        expense.date,
        expense.month,
        raw(`${escapeHtml(expense.category)}<br><span class="pill">${escapeHtml(expense.description || "No description")}</span>`),
        money(expense.amount),
        labelSplit(expense.splitMode),
        raw(expense.shares.map((share) => `${escapeHtml(userName(share.userId))}: ${money(share.amount)}`).join("<br>"))
        ];
        if (currentRole === "admin") {
          row.push(raw(`<button class="danger-btn" data-action="delete-expense" data-id="${expense.id}">Delete</button>`));
        }
        return row;
      }))}
  `;
}

function renderPayments() {
  const payments = filtered(state.payments, [
    (payment) => userName(payment.userId),
    (payment) => payment.method,
    (payment) => payment.transactionId,
    (payment) => payment.receiver
  ]);
  $("#payments").innerHTML = `
    <div class="section-head">
      <h2>Payment Management</h2>
      <button class="primary-btn" data-action="open-payment">Record Payment</button>
    </div>
    ${paymentTable(payments, true)}
  `;
}

function renderRequests() {
  const requests = filtered(state.requests, [
    (request) => userName(request.userId),
    (request) => request.method,
    (request) => request.transactionId,
    (request) => request.status
  ]);
  $("#requests").innerHTML = `
    <div class="section-head"><h2>Requests Awaiting Admin Action</h2></div>
    ${table(["Member", "Amount", "Date", "Method", "Details", "Status", "Actions"],
      requests.map((request) => [
        userName(request.userId),
        money(request.amount),
        request.date,
        request.method,
        paymentDetails(request),
        raw(`<span class="status ${request.status.toLowerCase()}">${request.status}</span>`),
        request.status === "Pending"
          ? raw(`<button class="ghost-btn" data-action="review-request" data-id="${request.id}">Review</button>`)
          : request.adminNote || ""
      ]))}
  `;
}

function renderReports() {
  const month = $("#reportMonth")?.value || currentMonth();
  const expenses = state.expenses.filter((expense) => expense.month === month);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const payments = state.payments.filter((payment) => (payment.month || payment.date.slice(0, 7)) === month);
  const paid = activePayments()
    .filter((payment) => (payment.month || payment.date.slice(0, 7)) === month)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const totals = allTotals(month);
  const status = monthStatus(month);
  $("#reports").innerHTML = `
    <div class="section-head no-print">
      <h2>Monthly PDF Report</h2>
      <div class="actions">
        <select id="reportMonth">${monthsAvailable().map((item) => `<option value="${item}" ${item === month ? "selected" : ""}>${escapeHtml(monthLabel(item))}</option>`).join("")}</select>
        <button class="ghost-btn" data-action="${status === "Closed" ? "reopen-month" : "close-month"}" data-month="${month}">
          ${status === "Closed" ? "Reopen Month" : "Close Month"}
        </button>
        <button class="primary-btn" data-action="print-report">Download PDF</button>
      </div>
    </div>
    <div class="print-report report-sheet">
      <header class="report-header">
        <div class="report-title">
          <p class="eyebrow">Official Monthly Financial Statement</p>
          <h2>brotel.ms Household Expense Management System</h2>
          <strong>Report Month: ${escapeHtml(monthLabel(month))}</strong>
        </div>
        <div class="report-meta">
          Generated: ${new Date().toLocaleString()}<br>
          Generated by: ${escapeHtml(session.name || session.username)}<br>
          Status: <span class="status ${status.toLowerCase()}">${escapeHtml(status)}</span>
        </div>
      </header>
      <section>
        <h3>House Summary</h3>
        ${metrics([
          ["Total Members", state.users.length],
          ["Total Expenses", money(expenseTotal)],
          ["Payments Received", money(paid)],
          ["Outstanding Due", money(totals.balance)]
        ])}
      </section>
      <section class="panel">
        <h3>Expense Breakdown</h3>
        ${table(["Expense Category", "Amount", "Distribution Method", "Date", "Notes"],
          expenses.map((expense) => [expense.category, money(expense.amount), labelSplit(expense.splitMode), expense.date, expense.description || "-"]))}
      </section>
      <section class="panel">
        <h3>Individual Member Summary</h3>
        ${table(["Member Name", "Total Expenses", "Total Paid", "Remaining Due", "Payment Status"],
          state.users.map((user) => {
            const totals = statementForUser(user.id, month);
            return [user.name, money(totals.due), money(totals.paid), totals.credit ? `${money(totals.credit)} credit` : money(totals.remaining), totals.status];
          }))}
      </section>
      <section class="panel">
        <h3>Payment History</h3>
        ${table(["Date", "Member", "Amount", "Method", "Transaction ID", "Receiver Name", "Status", "Notes"],
          payments.map((payment) => [
            payment.date,
            userName(payment.userId),
            money(payment.amount),
            payment.method,
            payment.transactionId || "-",
            payment.receiver || "-",
            payment.status || "Active",
            payment.status === "Cancelled" ? payment.cancelReason || "Cancelled" : payment.note || "-"
          ]))}
      </section>
      <section class="panel">
        <h3>Additional Information</h3>
        ${table(["Due Date", "Notes", "Report Generated By"], [[state.settings.dueDate || "Not set", `Historical data for ${monthLabel(month)} remains stored month-wise.`, session.name || session.username]])}
      </section>
      <section class="panel">
        <h3>Analytics Summary</h3>
        <div class="chart-row">
          <div>
            <h3>Expense Category Distribution</h3>
            ${barList(categoryTotals(expenses))}
          </div>
          <div>
            <h3>Outstanding Dues Overview</h3>
            ${barList(state.users.map((user) => ({ label: user.name, value: statementForUser(user.id, month).remaining })))}
          </div>
        </div>
      </section>
    </div>
  `;
}

function categoryTotals(expenses) {
  const totals = new Map();
  expenses.forEach((expense) => totals.set(expense.category, (totals.get(expense.category) || 0) + Number(expense.amount || 0)));
  return Array.from(totals, ([label, value]) => ({ label, value }));
}

function renderSettings() {
  $("#settings").innerHTML = `
    <div class="panel">
      <div class="section-head"><h2>Admin Settings</h2></div>
      <form id="settingsForm" class="form-grid">
        <label>Payment due date <input id="settingDueDate" type="date" value="${state.settings.dueDate || ""}"></label>
        <label>Reminder days before due <input id="settingReminderDays" type="number" min="0" max="30" value="${state.settings.reminderDays || 0}"></label>
        <div class="actions"><button class="primary-btn">Save Settings</button></div>
      </form>
      <div class="summary-box">
        Default admin login is <strong>admin</strong> with password <strong>admin123</strong>.
        Change it on Render by setting <strong>ADMIN_PASSWORD</strong>.
      </div>
    </div>
    <div class="panel">
      <div class="section-head"><h2>System Settings</h2></div>
      <div class="actions">
        <button class="ghost-btn" data-action="load-demo">Load Demo Data</button>
        <button class="ghost-btn" data-action="logout">Logout</button>
        <button class="danger-btn" data-action="reset-server">Reset Server</button>
      </div>
      <div class="summary-box">
        Reset Server permanently deletes all system data. The admin password is required before the reset can continue.
      </div>
    </div>
  `;
}

function renderAudit() {
  $("#audit").innerHTML = `
    <div class="panel">
      <div class="section-head"><h2>Payment and Expense Audit Logs</h2></div>
      ${renderLogList(state.auditLogs)}
    </div>
  `;
}

function renderDeveloper() {
  $("#developer").innerHTML = `
    <div class="developer-panel">
      <div class="developer-card">
        <div class="developer-avatar">TM</div>
        <div>
          <p class="eyebrow">Developer Details</p>
          <h2>Tamim Al Mahi</h2>
          <p class="developer-title">brotel.ms</p>
        </div>
      </div>
      <div class="developer-details">
        <div><span>University</span><strong>Daffodil International University</strong></div>
        <div><span>Department</span><strong>Software Engineering</strong></div>
        <div><span>Batch</span><strong>45</strong></div>
        <div><span>Mail</span><strong><a href="mailto:tamimalmahiinfo@gmail.com">tamimalmahiinfo@gmail.com</a></strong></div>
      </div>
    </div>
  `;
}

function renderUserDashboard() {
  const user = state.users.find((item) => item.id === currentUserId) || state.users[0];
  if (!user) {
    $("#user-dashboard").innerHTML = empty("No user profile exists yet.");
    return;
  }
  const totals = statementForUser(user.id, currentMonth());
  const lastPayment = lastPaymentForUser(user.id);
  const monthExpenses = state.expenses
    .filter((expense) => expense.month === currentMonth() && expense.shares.some((share) => share.userId === user.id));
  $("#user-dashboard").innerHTML = `
    ${metrics([
      ["My Due", money(totals.due)],
      ["My Paid", money(totals.paid)],
      ["My Remaining Balance", totals.credit ? `${money(totals.credit)} credit` : money(totals.remaining)],
      ["Last Payment", lastPayment ? `${money(lastPayment.amount)} on ${lastPayment.date}` : "No payment"],
      ["Due Date", state.settings.dueDate || "Not set"]
    ])}
    <div class="chart-row">
      <div class="panel">
        <div class="section-head"><h2>Monthly Expenses</h2></div>
        ${userExpenseTable(user.id, monthExpenses)}
      </div>
      <div class="panel">
        <div class="section-head">
          <h2>Payment Request</h2>
          <button class="primary-btn" data-action="open-user-request">Submit</button>
        </div>
        ${table(["Amount", "Method", "Status"],
          state.requests.filter((request) => request.userId === user.id).slice(0, 5).map((request) => [
            money(request.amount),
            request.method,
            raw(`<span class="status ${request.status.toLowerCase()}">${request.status}</span>`)
          ]))}
      </div>
    </div>
  `;
}

function renderUserExpenses() {
  $("#user-expenses").innerHTML = `
    <div class="panel">
      <div class="section-head"><h2>Date-wise Expense History</h2></div>
      ${userExpenseTable(currentUserId, state.expenses)}
    </div>
  `;
}

function renderUserPayments() {
  const payments = state.payments.filter((payment) => payment.userId === currentUserId);
  $("#user-payments").innerHTML = `
    <div class="panel">
      <div class="section-head"><h2>Payment History</h2></div>
      ${paymentTable(payments)}
    </div>
  `;
}

function renderUserRequest() {
  const requests = state.requests.filter((request) => request.userId === currentUserId);
  $("#user-request").innerHTML = `
    <div class="section-head">
      <h2>Request Payment to Admin</h2>
      <button class="primary-btn" data-action="open-user-request">Submit Request</button>
    </div>
    ${table(["Amount", "Date", "Method", "Details", "Status", "Admin Comment"],
      requests.map((request) => [
        money(request.amount),
        request.date,
        request.method,
        paymentDetails(request),
        raw(`<span class="status ${request.status.toLowerCase()}">${request.status}</span>`),
        request.adminNote || "-"
      ]))}
  `;
}

function activePayments() {
  return state.payments.filter((payment) => (payment.status || "Active") === "Active");
}

function monthStatus(month) {
  return state.months?.[month]?.status || "Open";
}

function monthLabel(month) {
  if (!month) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-BD", { month: "long", year: "numeric" });
}

function monthsAvailable() {
  const months = new Set([currentMonth()]);
  state.expenses.forEach((expense) => months.add(expense.month));
  state.payments.forEach((payment) => months.add(payment.month || payment.date?.slice(0, 7)));
  Object.keys(state.months || {}).forEach((month) => months.add(month));
  return Array.from(months).filter(Boolean).sort().reverse();
}

function totalsForUser(userId, month = "") {
  const due = state.expenses.reduce((sum, expense) => {
    if (month && expense.month !== month) return sum;
    const share = expense.shares.find((item) => item.userId === userId);
    return sum + Number(share?.amount || 0);
  }, 0);
  const paid = activePayments()
    .filter((payment) => payment.userId === userId && (!month || (payment.month || payment.date.slice(0, 7)) === month))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { due, paid, balance: due - paid, credit: Math.max(0, paid - due), remaining: Math.max(0, due - paid) };
}

function statementForUser(userId, month) {
  const priorDue = state.expenses.reduce((sum, expense) => {
    if (expense.month >= month) return sum;
    const share = expense.shares.find((item) => item.userId === userId);
    return sum + Number(share?.amount || 0);
  }, 0);
  const priorPaid = activePayments()
    .filter((payment) => payment.userId === userId && (payment.month || payment.date.slice(0, 7)) < month)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const monthTotals = totalsForUser(userId, month);
  const openingBalance = priorDue - priorPaid;
  const balance = openingBalance + monthTotals.due - monthTotals.paid;
  return {
    ...monthTotals,
    openingBalance,
    balance,
    remaining: Math.max(0, balance),
    credit: Math.max(0, -balance),
    status: balance <= 0 ? "Paid" : monthTotals.paid > 0 ? "Partial" : "Due"
  };
}

function allTotals(month = "") {
  return state.users.reduce(
    (acc, user) => {
      const totals = month ? statementForUser(user.id, month) : totalsForUser(user.id);
      acc.due += totals.due;
      acc.paid += totals.paid;
      acc.balance += totals.remaining ?? Math.max(0, totals.balance);
      acc.credit += totals.credit || 0;
      return acc;
    },
    { due: 0, paid: 0, balance: 0, credit: 0 }
  );
}

function lastPaymentForUser(userId) {
  return activePayments()
    .filter((payment) => payment.userId === userId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
}

function formatWhatsAppNumber(phone) {
  const rawPhone = String(phone || "").trim();
  if (!rawPhone) return "";
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) return digits.length >= 11 && digits.length <= 15 ? digits : "";
  if (digits.startsWith("0") && digits.length === 11) return `88${digits}`;
  if (digits.startsWith("1") && digits.length === 10) return `880${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function buildWhatsAppReminder(user) {
  const phone = formatWhatsAppNumber(user.phone);
  if (!phone) throw new Error(`${user.name} does not have a valid WhatsApp number.`);
  const dueAmount = totalsForUser(user.id).remaining;
  const message = [
    `Hello ${user.name},`,
    "",
    `Your due amount: *${money(dueAmount)}*`,
    "",
    "Please clear your due amount.",
    "",
    "Thank You!",
    "",
    "Brotel Management Team",
    "brotel-ms.onrender.com"
  ].join("\n");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function userName(userId) {
  return state.users.find((user) => user.id === userId)?.name || "Unknown member";
}

function filtered(items, fields) {
  const query = $("#globalSearch").value.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) =>
    fields.some((field) => String(field(item) || "").toLowerCase().includes(query))
  );
}

function metrics(items) {
  return `<div class="metric-grid">${items.map(([label, value]) => `
    <div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>
  `).join("")}</div>`;
}

function table(headers, rows) {
  if (!rows.length) return empty("No records found.");
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeAttr(headers[index] || "")}">${cellHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function paymentTable(payments, withActions = false) {
  const headers = ["Member", "Amount", "Date", "Method", "Details", "Status", "Note"];
  if (withActions) headers.push("Actions");
  return table(headers, payments.map((payment) => {
    const status = payment.status || "Active";
    const row = [
      userName(payment.userId),
      money(payment.amount),
      payment.date,
      payment.method,
      paymentDetails(payment),
      raw(`<span class="status ${status.toLowerCase()}">${escapeHtml(status)}</span>`),
      status === "Cancelled"
        ? raw(`${escapeHtml(payment.note || "-")}<br><span class="pill">Cancelled by ${escapeHtml(payment.cancelledBy || "-")}</span>`)
        : payment.note || "-"
    ];
    if (withActions) {
      row.push(status === "Active"
        ? raw(`<button class="danger-btn" data-action="cancel-payment" data-id="${payment.id}">Cancel</button>`)
        : escapeHtml(payment.cancelReason || "Reversed"));
    }
    return row;
  }));
}

function userExpenseTable(userId, expenses) {
  const rows = expenses
    .map((expense) => {
      const share = expense.shares.find((item) => item.userId === userId);
      if (!share) return null;
      return [expense.date, expense.category, expense.description || "-", money(share.amount), labelSplit(expense.splitMode)];
    })
    .filter(Boolean);
  return table(["Date", "Category", "Description", "My Share", "Split"], rows);
}

function barList(items) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return `<div class="bar-list">${items.map((item) => `
    <div class="bar-item">
      <div class="bar-label"><strong>${escapeHtml(item.label)}</strong><span>${money(item.value)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.abs(item.value) / max * 100)}%"></div></div>
    </div>
  `).join("")}</div>`;
}

function renderLogList(logs) {
  if (!logs.length) return empty("No audit entries yet.");
  return table(["Time", "Actor", "Action"], logs.map((log) => [
    new Date(log.at).toLocaleString(),
    log.actor,
    log.action
  ]));
}

function empty(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

function paymentDetails(item) {
  if (item.method === "Hand Cash") return `Received by: ${item.receiver || "-"}`;
  return `Transaction ID: ${item.transactionId || "-"}`;
}

function labelSplit(mode) {
  return {
    equal: "Split equally",
    "all-fixed": "Added to selected profiles",
    manual: "Manual shares"
  }[mode] || mode;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function raw(value) {
  return { html: String(value) };
}

function cellHtml(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "html")) return value.html;
  return escapeHtml(value);
}

function openPersonDialog(userId) {
  const user = state.users.find((item) => item.id === userId);
  $("#personDialogTitle").textContent = user ? "Edit Person" : "Add Person";
  $("#personId").value = user?.id || "";
  $("#personName").value = user?.name || "";
  $("#personPhone").value = user?.phone || "";
  $("#personImage").value = user?.image || "";
  $("#personUsername").value = user?.username || "";
  $("#personPassword").value = "";
  $("#personPassword").placeholder = user ? "Leave blank to keep current password" : "Required for new user";
  $("#personDialog").showModal();
}

function openExpenseDialog() {
  $("#expenseForm").reset();
  $("#expenseDate").value = today();
  $("#expenseMonth").value = currentMonth();
  $("#expenseRecurring").checked = false;
  renderShareInputs();
  $("#expenseDialog").showModal();
}

function renderShareInputs() {
  const mode = $("#splitMode").value;
  const amount = Number($("#expenseAmount").value || 0);
  const checkedCount = state.users.length || 1;
  $("#expenseShareGrid").innerHTML = state.users.map((user) => {
    const defaultAmount = mode === "equal" ? Math.round(amount / checkedCount) : mode === "all-fixed" ? amount : 0;
    return `
      <label class="share-row">
        <input type="checkbox" class="share-check" value="${user.id}" checked>
        <span>${escapeHtml(user.name)}</span>
        <input type="number" min="0" step="1" class="share-amount" data-id="${user.id}" value="${defaultAmount}" ${mode === "equal" ? "readonly" : ""}>
      </label>
    `;
  }).join("");
  recalcShares();
}

function recalcShares() {
  const mode = $("#splitMode").value;
  const amount = Number($("#expenseAmount").value || 0);
  const checked = $$(".share-check").filter((input) => input.checked);
  $$(".share-amount").forEach((input) => {
    const selected = checked.some((check) => check.value === input.dataset.id);
    input.disabled = !selected;
    input.readOnly = mode === "equal";
    if (mode === "equal") input.value = selected && checked.length ? (amount / checked.length).toFixed(2) : 0;
    if (mode === "all-fixed") input.value = selected ? amount : 0;
  });
}

function openPaymentDialog() {
  $("#paymentForm").reset();
  $("#paymentDate").value = today();
  togglePaymentFields("#paymentMethod", ".digital-field", ".cash-field");
  $("#paymentDialog").showModal();
}

function openRequestDialog() {
  $("#requestForm").reset();
  $("#requestUser").value = currentUserId;
  $("#requestDate").value = today();
  togglePaymentFields("#requestMethod", ".request-digital-field", ".request-cash-field");
  $("#requestDialog").showModal();
}

function togglePaymentFields(methodSelector, digitalSelector, cashSelector) {
  const isCash = $(methodSelector).value === "Hand Cash";
  $$(digitalSelector).forEach((item) => item.classList.toggle("is-hidden", isCash));
  $$(cashSelector).forEach((item) => item.classList.toggle("is-hidden", !isCash));
}

function reviewRequest(requestId) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request) return;
  $("#reviewRequestId").value = request.id;
  $("#reviewNote").value = request.adminNote || "";
  $("#reviewRequestSummary").innerHTML = `
    <strong>${escapeHtml(userName(request.userId))}</strong><br>
    Amount: ${money(request.amount)}<br>
    Date: ${escapeHtml(request.date)}<br>
    Method: ${escapeHtml(request.method)}<br>
    ${escapeHtml(paymentDetails(request))}
  `;
  $("#reviewRequestDialog").showModal();
}

async function refreshAfterMutation() {
  await loadState();
  showApp();
}

function showError(error) {
  alert(error.message || "Something went wrong.");
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action], .nav-item");
  if (!target) return;

  if (target.classList.contains("nav-item")) {
    currentView = target.dataset.view;
    closeMobileMenu();
    render();
    return;
  }

  const action = target.dataset.action;
  if (action === "open-menu") {
    openMobileMenu();
    return;
  }
  if (action === "close-menu") {
    closeMobileMenu();
    return;
  }
  if (action === "close-dialog") {
    target.closest("dialog")?.close();
    return;
  }
  if (action === "open-person") openPersonDialog();
  if (action === "edit-person") openPersonDialog(target.dataset.id);
  if (action === "whatsapp-reminder") {
    const user = state.users.find((item) => item.id === target.dataset.id);
    if (!user) {
      alert("Member profile was not found.");
      return;
    }
    try {
      const reminderUrl = buildWhatsAppReminder(user);
      const opened = window.open(reminderUrl, "_blank", "noopener");
      if (!opened) window.location.href = reminderUrl;
    } catch (error) {
      showError(error);
    }
  }
  if (action === "delete-person") {
    if (!confirm("Delete this profile and all related expenses, payments, and requests?")) return;
    try {
      await api(`/api/users/${target.dataset.id}`, { method: "DELETE" });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "open-expense") openExpenseDialog();
  if (action === "delete-expense") {
    if (!confirm("Delete this expense?")) return;
    try {
      await api(`/api/expenses/${target.dataset.id}`, { method: "DELETE" });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "open-payment") openPaymentDialog();
  if (action === "cancel-payment") {
    const reason = prompt("Reason for cancelling this payment (optional):") || "";
    if (!confirm("Cancel this payment and recalculate the member due amount?")) return;
    try {
      await api(`/api/payments/${target.dataset.id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason })
      });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "open-user-request") openRequestDialog();
  if (action === "review-request") reviewRequest(target.dataset.id);
  if (action === "print-report") window.print();
  if (action === "close-month") {
    if (!confirm(`Close ${monthLabel(target.dataset.month)}? Closed months become read-only.`)) return;
    try {
      await api(`/api/months/${target.dataset.month}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "close" })
      });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "reopen-month") {
    if (!confirm(`Reopen ${monthLabel(target.dataset.month)} for editing?`)) return;
    try {
      await api(`/api/months/${target.dataset.month}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reopen" })
      });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "load-demo") {
    if (!confirm("Load demo data and replace current records?")) return;
    try {
      await api("/api/demo", { method: "POST" });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
  if (action === "logout") {
    await logout();
  }
  if (action === "reset-server") {
    if (!confirm("Warning: This action will permanently delete all system data.")) return;
    const adminPassword = prompt("Enter Admin Password to reset the server:");
    if (!adminPassword) return;
    try {
      await api("/api/reset", {
        method: "POST",
        body: JSON.stringify({ adminPassword })
      });
      await refreshAfterMutation();
    } catch (error) {
      showError(error);
    }
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginMessage").textContent = "";
  try {
    session = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value
      })
    });
    currentView = session.role === "admin" ? "admin-dashboard" : "user-dashboard";
    await loadState();
    showApp();
  } catch (error) {
    showLogin(error.message);
  }
});

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => null);
  showLogin("You have been signed out.");
}

$("#personForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#personId").value;
  const payload = {
    name: $("#personName").value.trim(),
    phone: $("#personPhone").value.trim(),
    image: $("#personImage").value.trim(),
    username: $("#personUsername").value.trim(),
    password: $("#personPassword").value
  };
  try {
    await api(id ? `/api/users/${id}` : "/api/users", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    $("#personDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#expenseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const shares = $$(".share-check")
    .filter((input) => input.checked)
    .map((input) => ({
      userId: input.value,
      amount: Number($(`.share-amount[data-id="${input.value}"]`).value || 0)
    }))
    .filter((share) => share.amount > 0);
  if (!shares.length) {
    alert("Select at least one member and assign an amount.");
    return;
  }
  try {
    await api("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        category: $("#expenseCategory").value,
        description: $("#expenseDescription").value.trim(),
        amount: Number($("#expenseAmount").value),
        date: $("#expenseDate").value,
        month: $("#expenseMonth").value,
        splitMode: $("#splitMode").value,
        recurring: $("#expenseRecurring").checked,
        shares
      })
    });
    $("#expenseDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        userId: $("#paymentUser").value,
        amount: Number($("#paymentAmount").value),
        date: $("#paymentDate").value,
        method: $("#paymentMethod").value,
        transactionId: $("#paymentTxn").value.trim(),
        receiver: $("#paymentReceiver").value.trim(),
        note: $("#paymentNote").value.trim()
      })
    });
    $("#paymentDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#requestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        amount: Number($("#requestAmount").value),
        date: $("#requestDate").value,
        method: $("#requestMethod").value,
        transactionId: $("#requestTxn").value.trim(),
        receiver: $("#requestReceiver").value.trim(),
        note: $("#requestNote").value.trim()
      })
    });
    $("#requestDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#approveRequestBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/requests/${$("#reviewRequestId").value}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Approved", adminNote: $("#reviewNote").value.trim() })
    });
    $("#reviewRequestDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#rejectRequestBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/requests/${$("#reviewRequestId").value}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Rejected", adminNote: $("#reviewNote").value.trim() })
    });
    $("#reviewRequestDialog").close();
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

$("#globalSearch").addEventListener("input", renderActiveView);
window.addEventListener("resize", () => {
  if (window.innerWidth > 960) closeMobileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenu();
});
$("#splitMode").addEventListener("change", recalcShares);
$("#expenseAmount").addEventListener("input", recalcShares);
$("#expenseShareGrid").addEventListener("input", recalcShares);
$("#expenseShareGrid").addEventListener("change", recalcShares);
$("#paymentMethod").addEventListener("change", () => togglePaymentFields("#paymentMethod", ".digital-field", ".cash-field"));
$("#requestMethod").addEventListener("change", () => togglePaymentFields("#requestMethod", ".request-digital-field", ".request-cash-field"));
$("#selectAllMembersBtn").addEventListener("click", () => {
  $$(".share-check").forEach((input) => { input.checked = true; });
  recalcShares();
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "settingsForm") return;
  event.preventDefault();
  try {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        dueDate: $("#settingDueDate").value,
        reminderDays: Number($("#settingReminderDays").value || 0)
      })
    });
    await refreshAfterMutation();
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "reportMonth") renderReports();
});

boot();
