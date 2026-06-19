try {
  require("dotenv").config();
} catch {
  // dotenv is optional for local file-mode runs.
}
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
let MongoClient = null;
try {
  ({ MongoClient } = require("mongodb"));
} catch {
  MongoClient = null;
}

const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const COOKIE_NAME = "brotel_session";
const sessions = new Map();

let mongoClient = null;
let db = null;
let collection = null;

async function getMongoCollection() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) return null;
  if (!MongoClient) throw new Error("MongoDB package is required when MONGODB_URI or MONGO_URL is set.");
  if (!collection) {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db();
    collection = db.collection("state");
  }
  return collection;
}

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

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthFromDate(date) {
  return String(date || "").slice(0, 7) || currentMonth();
}

function normalizeMonth(month) {
  const value = String(month || currentMonth()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Invalid month.");
  return value;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, auth) {
  if (!auth?.salt || !auth?.hash) return false;
  const candidate = hashPassword(password, auth.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(auth.hash, "hex"));
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeStateSync(state) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

async function readState() {
  const col = await getMongoCollection();
  if (col) {
    const doc = await col.findOne({ _id: "globalState" });
    if (!doc) {
      const seeded = createSeedState();
      await col.insertOne({ _id: "globalState", ...seeded });
      return seeded;
    }
    const { _id, ...state } = doc;
    ensureAdmin(state);
    await col.replaceOne({ _id: "globalState" }, { ...state });
    return state;
  }
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = createSeedState();
    writeStateSync(seeded);
    return seeded;
  }
  const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  ensureAdmin(state);
  writeStateSync(state);
  return state;
}

async function writeState(state) {
  const col = await getMongoCollection();
  if (col) {
    await col.replaceOne({ _id: "globalState" }, { ...state }, { upsert: true });
  } else {
    writeStateSync(state);
  }
}

function createSeedState() {
  const users = [
    userRecord("Rahim Uddin", "01700000001", "rahim", "user123"),
    userRecord("Karim Hasan", "01700000002", "karim", "user123"),
    userRecord("Nadia Akter", "01700000003", "nadia", "user123"),
    userRecord("Sadia Islam", "", "sadia", "user123")
  ];
  const month = currentMonth();
  const state = {
    admin: {
      username: ADMIN_USERNAME,
      password: hashPassword(ADMIN_PASSWORD)
    },
    users,
    expenses: [
      {
        id: uid("exp"),
        category: "House Rent",
        description: "Monthly rent",
        amount: 48000,
        date: `${month}-01`,
        month,
        splitMode: "equal",
        shares: users.map((user) => ({ userId: user.id, amount: 12000 }))
      },
      {
        id: uid("exp"),
        category: "WiFi Bill",
        description: "Broadband",
        amount: 1200,
        date: `${month}-05`,
        month,
        splitMode: "equal",
        shares: users.map((user) => ({ userId: user.id, amount: 300 }))
      }
    ],
    payments: [],
    requests: [],
    settings: { dueDate: `${month}-25`, reminderDays: 3 },
    months: {
      [month]: {
        month,
        status: "Open",
        closedAt: "",
        closedBy: "",
        reopenedAt: "",
        reopenedBy: ""
      }
    },
    recurringExpenses: [],
    auditLogs: [
      { id: uid("log"), at: new Date().toISOString(), actor: "System", action: "Application data initialized" }
    ]
  };
  ensureAdmin(state);
  return state;
}

function userRecord(name, phone, username, password, image = "") {
  return {
    id: uid("usr"),
    name,
    phone,
    image,
    username,
    password: hashPassword(password)
  };
}

function ensureAdmin(state) {
  state.admin ||= {};
  state.admin.username = ADMIN_USERNAME;
  if (!state.admin.password || process.env.ADMIN_PASSWORD) {
    state.admin.password = hashPassword(ADMIN_PASSWORD);
  }
  ensureStateShape(state);
}

function ensureStateShape(state) {
  state.expenses ||= [];
  state.payments ||= [];
  state.requests ||= [];
  state.settings ||= { dueDate: `${currentMonth()}-25`, reminderDays: 3 };
  state.auditLogs ||= [];
  state.months ||= {};
  state.recurringExpenses ||= [];
  state.expenses.forEach((expense) => {
    expense.month = normalizeMonth(expense.month || monthFromDate(expense.date));
    expense.splitMode ||= "manual";
    expense.shares ||= [];
  });
  state.payments.forEach((payment) => {
    payment.month = normalizeMonth(payment.month || monthFromDate(payment.date));
    payment.status ||= "Active";
    payment.cancelledBy ||= "";
    payment.cancelledAt ||= "";
    payment.cancelReason ||= "";
  });
  state.requests.forEach((request) => {
    request.month = normalizeMonth(request.month || monthFromDate(request.date));
  });
}

function monthRecord(state, month) {
  const normalized = normalizeMonth(month);
  state.months ||= {};
  state.months[normalized] ||= {
    month: normalized,
    status: "Open",
    closedAt: "",
    closedBy: "",
    reopenedAt: "",
    reopenedBy: ""
  };
  return state.months[normalized];
}

function isMonthClosed(state, month) {
  return monthRecord(state, month).status === "Closed";
}

function assertMonthOpen(state, month) {
  if (isMonthClosed(state, month)) throw new Error("This month is closed. Reopen it before making changes.");
}

function applyRecurringExpenses(state, month = currentMonth()) {
  const normalized = normalizeMonth(month);
  state.recurringExpenses ||= [];
  for (const recurring of state.recurringExpenses.filter((item) => item.active !== false)) {
    if (isMonthClosed(state, normalized)) continue;
    const exists = state.expenses.some((expense) => expense.month === normalized && expense.recurringId === recurring.id);
    if (exists) continue;
    state.expenses.unshift({
      id: uid("exp"),
      category: recurring.category,
      description: recurring.description || "Recurring monthly expense",
      amount: recurring.amount,
      date: `${normalized}-01`,
      month: normalized,
      splitMode: recurring.splitMode,
      shares: recurring.shares.map((share) => ({ ...share })),
      recurringId: recurring.id
    });
    addAudit(state, `Created recurring ${recurring.category} expense for ${normalized}`, "System");
  }
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function stateForSession(state, session) {
  if (session.role === "admin") {
    return { ...state, admin: undefined, users: state.users.map(sanitizeUser) };
  }
  const userId = session.userId;
  return {
    users: state.users.filter((user) => user.id === userId).map(sanitizeUser),
    expenses: state.expenses
      .map((expense) => ({
        ...expense,
        shares: expense.shares.filter((share) => share.userId === userId)
      }))
      .filter((expense) => expense.shares.length),
    payments: state.payments.filter((payment) => payment.userId === userId),
    requests: state.requests.filter((request) => request.userId === userId),
    settings: state.settings,
    auditLogs: []
  };
}

function addAudit(state, action, actor = "Admin") {
  state.auditLogs.unshift({ id: uid("log"), at: new Date().toISOString(), actor, action });
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  return token ? sessions.get(token) : null;
}

function setSession(res, session) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, session);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: "Please login first." });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== "admin") {
    json(res, 403, { error: "Admin access required." });
    return null;
  }
  return session;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateUserPayload(body, existing, state) {
  const name = String(body.name || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!name) throw new Error("Name is required.");
  if (!username) throw new Error("Username is required.");
  if (!existing && password.length < 4) throw new Error("Password must be at least 4 characters.");
  const duplicate = state.users.find((user) => user.username === username && user.id !== existing?.id);
  if (duplicate || username === state.admin.username) throw new Error("Username is already used.");
  return {
    name,
    username,
    phone: String(body.phone || "").trim(),
    image: String(body.image || "").trim(),
    password
  };
}

async function handleLogin(req, res, body) {
  const state = await readState();
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (username === state.admin.username && verifyPassword(password, state.admin.password)) {
    const session = { role: "admin", username: state.admin.username, name: "Admin" };
    setSession(res, session);
    json(res, 200, session);
    return;
  }
  const user = state.users.find((item) => item.username === username);
  if (user && verifyPassword(password, user.password)) {
    const session = { role: "user", username: user.username, userId: user.id, name: user.name };
    setSession(res, session);
    json(res, 200, session);
    return;
  }
  json(res, 401, { error: "Invalid username or password." });
}

async function handleApi(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    if (method === "POST" && url.pathname === "/api/login") {
      return await handleLogin(req, res, await readBody(req));
    }
    if (method === "POST" && url.pathname === "/api/logout") {
      clearSession(req, res);
      return json(res, 200, { ok: true });
    }
    if (method === "GET" && url.pathname === "/api/session") {
      const session = requireAuth(req, res);
      if (!session) return;
      return json(res, 200, session);
    }

    const session = requireAuth(req, res);
    if (!session) return;
    const state = await readState();
    applyRecurringExpenses(state, currentMonth());

    if (method === "GET" && url.pathname === "/api/state") {
      await writeState(state);
      return json(res, 200, stateForSession(state, session));
    }

    if (method === "POST" && url.pathname === "/api/requests") {
      if (session.role !== "user") return json(res, 403, { error: "User access required." });
      const body = await readBody(req);
      const request = {
        id: uid("req"),
        userId: session.userId,
        amount: Number(body.amount),
        date: String(body.date || ""),
        month: normalizeMonth(body.month || monthFromDate(body.date)),
        method: String(body.method || ""),
        transactionId: String(body.transactionId || "").trim(),
        receiver: String(body.receiver || "").trim(),
        note: String(body.note || "").trim(),
        adminNote: "",
        status: "Pending"
      };
      if (!request.amount || request.amount < 1) throw new Error("Amount is required.");
      state.requests.unshift(request);
      addAudit(state, `${session.name} submitted a payment request`, session.name);
      await writeState(state);
      return json(res, 201, request);
    }

    if (!requireAdmin(req, res)) return;

    if (method === "POST" && url.pathname === "/api/users") {
      const body = validateUserPayload(await readBody(req), null, state);
      const user = userRecord(body.name, body.phone, body.username, body.password, body.image);
      state.users.push(user);
      addAudit(state, `Created profile for ${user.name}`);
      await writeState(state);
      return json(res, 201, sanitizeUser(user));
    }

    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === "PUT") {
      const user = state.users.find((item) => item.id === userMatch[1]);
      if (!user) return notFound(res);
      const body = validateUserPayload(await readBody(req), user, state);
      Object.assign(user, { name: body.name, phone: body.phone, image: body.image, username: body.username });
      if (body.password) user.password = hashPassword(body.password);
      addAudit(state, `Updated profile for ${user.name}`);
      await writeState(state);
      return json(res, 200, sanitizeUser(user));
    }

    if (userMatch && method === "DELETE") {
      const user = state.users.find((item) => item.id === userMatch[1]);
      if (!user) return notFound(res);
      state.users = state.users.filter((item) => item.id !== user.id);
      state.expenses.forEach((expense) => {
        expense.shares = expense.shares.filter((share) => share.userId !== user.id);
      });
      state.payments = state.payments.filter((payment) => payment.userId !== user.id);
      state.requests = state.requests.filter((request) => request.userId !== user.id);
      addAudit(state, `Deleted profile for ${user.name}`);
      await writeState(state);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/expenses") {
      const body = await readBody(req);
      const expense = {
        id: uid("exp"),
        category: categories.includes(body.category) ? body.category : "Other Custom Expenses",
        description: String(body.description || "").trim(),
        amount: Number(body.amount),
        date: String(body.date || ""),
        month: String(body.month || ""),
        splitMode: String(body.splitMode || "manual"),
        shares: Array.isArray(body.shares) ? body.shares.map((share) => ({
          userId: String(share.userId),
          amount: Number(share.amount)
        })).filter((share) => share.amount > 0 && state.users.some((user) => user.id === share.userId)) : []
      };
      expense.month = normalizeMonth(expense.month || monthFromDate(expense.date));
      assertMonthOpen(state, expense.month);
      if (!expense.amount || expense.amount < 1 || !expense.shares.length) throw new Error("Expense amount and shares are required.");
      state.expenses.unshift(expense);
      if (body.recurring) {
        const recurring = {
          id: uid("rec"),
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          splitMode: expense.splitMode,
          shares: expense.shares.map((share) => ({ ...share })),
          active: true,
          createdAt: new Date().toISOString()
        };
        state.recurringExpenses.unshift(recurring);
        expense.recurringId = recurring.id;
      }
      addAudit(state, `Added ${expense.category} expense worth ${expense.amount} BDT`);
      await writeState(state);
      return json(res, 201, expense);
    }

    const expenseMatch = url.pathname.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch && method === "DELETE") {
      const expense = state.expenses.find((item) => item.id === expenseMatch[1]);
      if (!expense) return notFound(res);
      assertMonthOpen(state, expense.month);
      state.expenses = state.expenses.filter((item) => item.id !== expense.id);
      addAudit(state, `Deleted ${expense.category} expense worth ${expense.amount} BDT`);
      await writeState(state);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/payments") {
      const body = await readBody(req);
      const payment = {
        id: uid("pay"),
        userId: String(body.userId || ""),
        amount: Number(body.amount),
        date: String(body.date || ""),
        month: normalizeMonth(body.month || monthFromDate(body.date)),
        method: String(body.method || ""),
        transactionId: String(body.transactionId || "").trim(),
        receiver: String(body.receiver || "").trim(),
        note: String(body.note || "").trim(),
        requestId: null,
        status: "Active",
        cancelledBy: "",
        cancelledAt: "",
        cancelReason: ""
      };
      if (!state.users.some((user) => user.id === payment.userId)) throw new Error("Member not found.");
      if (!payment.amount || payment.amount < 1) throw new Error("Payment amount is required.");
      assertMonthOpen(state, payment.month);
      state.payments.unshift(payment);
      addAudit(state, `Recorded ${payment.amount} BDT payment`);
      await writeState(state);
      return json(res, 201, payment);
    }

    const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
    if (requestMatch && method === "PATCH") {
      const request = state.requests.find((item) => item.id === requestMatch[1]);
      if (!request) return notFound(res);
      const body = await readBody(req);
      const status = String(body.status || "");
      if (!["Approved", "Rejected"].includes(status)) throw new Error("Invalid request status.");
      request.status = status;
      request.adminNote = String(body.adminNote || "").trim();
      if (status === "Approved" && !state.payments.some((payment) => payment.requestId === request.id)) {
        assertMonthOpen(state, request.month);
        state.payments.unshift({
          id: uid("pay"),
          userId: request.userId,
          amount: request.amount,
          date: request.date,
          month: request.month,
          method: request.method,
          transactionId: request.transactionId,
          receiver: request.receiver,
          note: request.adminNote || "Approved payment request",
          requestId: request.id,
          status: "Active",
          cancelledBy: "",
          cancelledAt: "",
          cancelReason: ""
        });
      }
      addAudit(state, `${status} payment request`);
      await writeState(state);
      return json(res, 200, request);
    }

    const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/cancel$/);
    if (paymentMatch && method === "PATCH") {
      const payment = state.payments.find((item) => item.id === paymentMatch[1]);
      if (!payment) return notFound(res);
      if (payment.status === "Cancelled") throw new Error("Payment is already cancelled.");
      assertMonthOpen(state, payment.month);
      const body = await readBody(req);
      payment.status = "Cancelled";
      payment.cancelledBy = session.name || session.username || "Admin";
      payment.cancelledAt = new Date().toISOString();
      payment.cancelReason = String(body.reason || "").trim();
      addAudit(state, `Cancelled ${payment.amount} BDT payment${payment.cancelReason ? `: ${payment.cancelReason}` : ""}`, payment.cancelledBy);
      await writeState(state);
      return json(res, 200, payment);
    }

    const monthMatch = url.pathname.match(/^\/api\/months\/(\d{4}-\d{2})$/);
    if (monthMatch && method === "PATCH") {
      const body = await readBody(req);
      const month = normalizeMonth(monthMatch[1]);
      const action = String(body.action || "");
      const record = monthRecord(state, month);
      if (action === "close") {
        record.status = "Closed";
        record.closedAt = new Date().toISOString();
        record.closedBy = session.name || session.username || "Admin";
        addAudit(state, `Closed month ${month}`, record.closedBy);
      } else if (action === "reopen") {
        record.status = "Open";
        record.reopenedAt = new Date().toISOString();
        record.reopenedBy = session.name || session.username || "Admin";
        addAudit(state, `Reopened month ${month}`, record.reopenedBy);
      } else {
        throw new Error("Invalid month action.");
      }
      await writeState(state);
      return json(res, 200, record);
    }

    if (method === "PATCH" && url.pathname === "/api/settings") {
      const body = await readBody(req);
      state.settings = {
        dueDate: String(body.dueDate || ""),
        reminderDays: Number(body.reminderDays || 0)
      };
      addAudit(state, "Updated admin payment deadline settings");
      await writeState(state);
      return json(res, 200, state.settings);
    }

    if (method === "POST" && url.pathname === "/api/demo") {
      const seeded = createSeedState();
      await writeState(seeded);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/reset") {
      const body = await readBody(req);
      if (!verifyPassword(String(body.adminPassword || ""), state.admin.password)) {
        return json(res, 403, { error: "Admin password is incorrect." });
      }
      const seeded = createSeedState();
      seeded.expenses = [];
      seeded.payments = [];
      seeded.requests = [];
      seeded.recurringExpenses = [];
      seeded.months = {};
      seeded.auditLogs = [{ id: uid("log"), at: new Date().toISOString(), actor: "Admin", action: "Server data reset" }];
      await writeState(seeded);
      return json(res, 200, { ok: true });
    }

    return notFound(res);
  } catch (error) {
    return json(res, 400, { error: error.message || "Bad request" });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(__dirname, requested));
  if (!filePath.startsWith(__dirname) || filePath.includes(`${path.sep}data${path.sep}`)) return notFound(res);
  fs.readFile(filePath, (error, data) => {
    if (error) return notFound(res);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, async () => {
  try {
    await readState();
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
  console.log(`brotel.ms running on port ${PORT}`);
});
