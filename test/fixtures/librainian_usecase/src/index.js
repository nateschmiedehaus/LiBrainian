/**
 * Main entry point for the User Management Service.
 * Initializes Express server, connects to database, and sets up routes.
 */

const express = require('express');
const { initializeDatabase } = require('./db/client');
const { loadConfig } = require('./config/config');
const { authenticateUser } = require('./auth/authenticate');
const { processUser, getUserById } = require('./user/user_service');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes
app.post('/auth/login', async (req, res) => {
  try {
    const result = await authenticateUser(req.body.email, req.body.password);
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// User routes
app.post('/users', async (req, res) => {
  try {
    const user = await processUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function start() {
  const config = loadConfig();
  await initializeDatabase();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

start().catch(console.error);

module.exports = { app };
