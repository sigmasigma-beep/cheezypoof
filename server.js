const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Database helpers ───────────────────────────────────────────────
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      accounts: [
        {
          id: uuidv4(),
          firstName: "Chase",
          lastName: "Petrosky",
          credId: "10219982",
          protectionId: "3491",
          balance: 999999,
          isAdmin: true,
          createdAt: new Date().toISOString()
        }
      ],
      transactions: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Auth middleware ─────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const { credId, protectionId } = req.headers;
  const db = readDB();
  const account = db.accounts.find(a => a.credId === credId && a.protectionId === protectionId && a.isAdmin);
  if (!account) return res.status(403).json({ error: 'Admin access denied.' });
  req.admin = account;
  next();
}

function requireAuth(req, res, next) {
  const { credId, protectionId } = req.headers;
  const db = readDB();
  const account = db.accounts.find(a => a.credId === credId && a.protectionId === protectionId);
  if (!account) return res.status(401).json({ error: 'Invalid Cred ID or Protection ID.' });
  req.account = account;
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────

// Login
app.post('/api/login', (req, res) => {
  const { credId, protectionId } = req.body;
  const db = readDB();
  const account = db.accounts.find(a => a.credId === credId && a.protectionId === protectionId);
  if (!account) return res.status(401).json({ error: 'Invalid Cred ID or Protection ID.' });
  res.json({
    success: true,
    account: {
      id: account.id,
      firstName: account.firstName,
      lastName: account.lastName,
      credId: account.credId,
      balance: account.balance,
      isAdmin: account.isAdmin,
      createdAt: account.createdAt
    }
  });
});

// Get my account info
app.get('/api/me', requireAuth, (req, res) => {
  const a = req.account;
  res.json({
    id: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    credId: a.credId,
    balance: a.balance,
    isAdmin: a.isAdmin,
    createdAt: a.createdAt
  });
});

// Get my transactions
app.get('/api/transactions', requireAuth, (req, res) => {
  const db = readDB();
  const txs = db.transactions
    .filter(t => t.fromCredId === req.account.credId || t.toCredId === req.account.credId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json(txs);
});

// Send money (gift box)
app.post('/api/send', requireAuth, (req, res) => {
  const { toCredId, amount, message } = req.body;
  const db = readDB();

  const sender = db.accounts.find(a => a.credId === req.account.credId);
  const recipient = db.accounts.find(a => a.credId === toCredId);

  if (!recipient) return res.status(404).json({ error: 'Recipient Cred ID not found.' });
  if (sender.credId === toCredId) return res.status(400).json({ error: "You can't send to yourself!" });
  if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Invalid amount.' });
  if (sender.balance < amount) return res.status(400).json({ error: 'Not enough Cheezy Poofs!' });

  sender.balance -= amount;
  recipient.balance += amount;

  const tx = {
    id: uuidv4(),
    fromCredId: sender.credId,
    fromName: `${sender.firstName} ${sender.lastName}`,
    toCredId: recipient.credId,
    toName: `${recipient.firstName} ${recipient.lastName}`,
    amount,
    message: message || '',
    createdAt: new Date().toISOString()
  };

  db.transactions.push(tx);
  writeDB(db);

  res.json({ success: true, transaction: tx, newBalance: sender.balance });
});

// Look up a user by credId (for sending)
app.get('/api/lookup/:credId', requireAuth, (req, res) => {
  const db = readDB();
  const account = db.accounts.find(a => a.credId === req.params.credId);
  if (!account) return res.status(404).json({ error: 'User not found.' });
  res.json({ firstName: account.firstName, lastName: account.lastName, credId: account.credId });
});

// ─── ADMIN ROUTES ────────────────────────────────────────────────────

// Get all accounts
app.get('/api/admin/accounts', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.accounts.map(a => ({ ...a, protectionId: '****' })));
});

// Get all transactions
app.get('/api/admin/transactions', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Create new account
app.post('/api/admin/create-account', requireAdmin, (req, res) => {
  const { firstName, lastName, credId, protectionId, startingBalance } = req.body;
  const db = readDB();

  if (!firstName || !lastName || !credId || !protectionId)
    return res.status(400).json({ error: 'All fields required.' });
  if (!/^\d{8}$/.test(credId))
    return res.status(400).json({ error: 'Cred ID must be exactly 8 digits.' });
  if (!/^\d{4}$/.test(protectionId))
    return res.status(400).json({ error: 'Protection ID must be exactly 4 digits.' });
  if (db.accounts.find(a => a.credId === credId))
    return res.status(400).json({ error: 'Cred ID already in use.' });

  const newAccount = {
    id: uuidv4(),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    credId,
    protectionId,
    balance: startingBalance || 0,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };

  db.accounts.push(newAccount);
  writeDB(db);
  res.json({ success: true, account: { ...newAccount, protectionId: '****' } });
});

// Give money to any account
app.post('/api/admin/give-money', requireAdmin, (req, res) => {
  const { credId, amount } = req.body;
  const db = readDB();

  const account = db.accounts.find(a => a.credId === credId);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  if (typeof amount !== 'number' || amount === 0) return res.status(400).json({ error: 'Invalid amount.' });

  account.balance += amount;
  if (account.balance < 0) account.balance = 0;

  const tx = {
    id: uuidv4(),
    fromCredId: 'ADMIN',
    fromName: 'Admin (Chase Petrosky)',
    toCredId: account.credId,
    toName: `${account.firstName} ${account.lastName}`,
    amount,
    message: amount > 0 ? 'Admin grant' : 'Admin deduction',
    createdAt: new Date().toISOString()
  };
  db.transactions.push(tx);
  writeDB(db);

  res.json({ success: true, newBalance: account.balance });
});

// Delete account
app.delete('/api/admin/delete-account/:credId', requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.accounts.findIndex(a => a.credId === req.params.credId);
  if (idx === -1) return res.status(404).json({ error: 'Account not found.' });
  if (db.accounts[idx].isAdmin) return res.status(400).json({ error: 'Cannot delete admin account.' });
  db.accounts.splice(idx, 1);
  writeDB(db);
  res.json({ success: true });
});

// Reset someone's protection ID
app.post('/api/admin/reset-protection', requireAdmin, (req, res) => {
  const { credId, newProtectionId } = req.body;
  const db = readDB();
  const account = db.accounts.find(a => a.credId === credId);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  if (!/^\d{4}$/.test(newProtectionId)) return res.status(400).json({ error: 'Protection ID must be 4 digits.' });
  account.protectionId = newProtectionId;
  writeDB(db);
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🧀 Cheezy Poof server running on port ${PORT}`);
  readDB(); // initialize DB if needed
});
