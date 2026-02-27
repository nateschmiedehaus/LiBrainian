/**
 * @fileoverview Embedding Model Validation Test Suite
 *
 * This test validates embedding quality using a ground truth test set.
 * We define pairs of:
 * - Related code (should have HIGH similarity)
 * - Unrelated code (should have LOW similarity)
 *
 * A good embedding model should:
 * 1. Score related pairs higher than unrelated pairs
 * 2. Achieve high AUC (Area Under ROC Curve)
 * 3. Separate related from unrelated with minimal overlap
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateRealEmbedding,
  cosineSimilarity,
  EMBEDDING_MODELS,
  type EmbeddingModelId,
} from '../api/embedding_providers/real_embeddings.js';
import { checkAllProviders } from '../api/provider_check.js';

// ============================================================================
// GROUND TRUTH TEST SET
// ============================================================================

/**
 * Related code pairs - these SHOULD have high similarity.
 * Categories:
 * 1. Same-concept implementations (sorting, searching, etc.)
 * 2. Functions that call each other
 * 3. Same module/domain
 */
const RELATED_PAIRS: Array<{ name: string; code1: string; code2: string }> = [
  // Category 1: Same algorithm - different implementations
  {
    name: 'bubble-sort-variants',
    code1: `
function bubbleSort(arr) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
      }
    }
  }
  return arr;
}`,
    code2: `
function bubbleSortOptimized(array) {
  let swapped;
  do {
    swapped = false;
    for (let i = 0; i < array.length - 1; i++) {
      if (array[i] > array[i + 1]) {
        const temp = array[i];
        array[i] = array[i + 1];
        array[i + 1] = temp;
        swapped = true;
      }
    }
  } while (swapped);
  return array;
}`,
  },

  // Category 2: Related database operations
  {
    name: 'database-crud',
    code1: `
async function insertUser(db, user) {
  const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
  return stmt.run(user.name, user.email);
}`,
    code2: `
async function updateUser(db, id, data) {
  const stmt = db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?');
  return stmt.run(data.name, data.email, id);
}`,
  },

  // Category 3: Authentication related
  {
    name: 'auth-functions',
    code1: `
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}`,
    code2: `
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}`,
  },

  // Category 4: API endpoint handlers
  {
    name: 'rest-api-handlers',
    code1: `
app.get('/api/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});`,
    code2: `
app.put('/api/users/:id', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});`,
  },

  // Category 5: Array manipulation
  {
    name: 'array-utils',
    code1: `
function filterEvenNumbers(arr) {
  return arr.filter(x => x % 2 === 0);
}`,
    code2: `
function filterOddNumbers(arr) {
  return arr.filter(x => x % 2 !== 0);
}`,
  },

  // Category 6: Error handling
  {
    name: 'error-handlers',
    code1: `
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}`,
    code2: `
class AuthenticationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}`,
  },

  // Category 7: React components
  {
    name: 'react-button-components',
    code1: `
function PrimaryButton({ onClick, children }) {
  return (
    <button className="btn btn-primary" onClick={onClick}>
      {children}
    </button>
  );
}`,
    code2: `
function SecondaryButton({ onClick, children, disabled }) {
  return (
    <button className="btn btn-secondary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}`,
  },

  // Category 8: State management
  {
    name: 'redux-actions',
    code1: `
const addTodo = (text) => ({
  type: 'ADD_TODO',
  payload: { id: Date.now(), text, completed: false }
});`,
    code2: `
const removeTodo = (id) => ({
  type: 'REMOVE_TODO',
  payload: { id }
});`,
  },

  // Category 9: File operations
  {
    name: 'file-operations',
    code1: `
async function readJsonFile(path) {
  const content = await fs.readFile(path, 'utf8');
  return JSON.parse(content);
}`,
    code2: `
async function writeJsonFile(path, data) {
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(path, content, 'utf8');
}`,
  },

  // Category 10: Validation
  {
    name: 'email-validation',
    code1: `
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}`,
    code2: `
function validateEmailFormat(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[\w.-]+@[\w.-]+\.\w{2,}$/.test(email.toLowerCase());
}`,
  },
];

/**
 * Unrelated code pairs - these SHOULD have low similarity.
 */
const UNRELATED_PAIRS: Array<{ name: string; code1: string; code2: string }> = [
  {
    name: 'sort-vs-auth',
    code1: `
function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[0];
  const left = arr.slice(1).filter(x => x < pivot);
  const right = arr.slice(1).filter(x => x >= pivot);
  return [...quickSort(left), pivot, ...quickSort(right)];
}`,
    code2: `
async function login(email, password) {
  const user = await User.findByEmail(email);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Invalid password');
  return generateToken(user);
}`,
  },

  {
    name: 'react-vs-database',
    code1: `
function UserProfile({ user }) {
  return (
    <div className="profile">
      <Avatar src={user.avatar} />
      <h2>{user.name}</h2>
      <p>{user.bio}</p>
    </div>
  );
}`,
    code2: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);`,
  },

  {
    name: 'math-vs-http',
    code1: `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`,
    code2: `
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).send('Invalid signature');
  }
  processWebhook(req.body);
  res.sendStatus(200);
});`,
  },

  {
    name: 'css-vs-algorithm',
    code1: `
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}`,
    code2: `
function dijkstra(graph, start) {
  const distances = {};
  const visited = new Set();
  const queue = new PriorityQueue();
  queue.enqueue(start, 0);
  while (!queue.isEmpty()) {
    const current = queue.dequeue();
    // Process neighbors...
  }
}`,
  },

  {
    name: 'regex-vs-dom',
    code1: `
function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.match(emailRegex) || [];
}`,
    code2: `
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signup-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    validateAndSubmit(form);
  });
});`,
  },

  {
    name: 'binary-tree-vs-config',
    code1: `
class TreeNode {
  constructor(value) {
    this.value = value;
    this.left = null;
    this.right = null;
  }
  insert(value) {
    if (value < this.value) {
      this.left ? this.left.insert(value) : (this.left = new TreeNode(value));
    } else {
      this.right ? this.right.insert(value) : (this.right = new TreeNode(value));
    }
  }
}`,
    code2: `
module.exports = {
  port: process.env.PORT || 3000,
  database: {
    host: 'localhost',
    name: 'myapp',
    pool: { min: 2, max: 10 }
  },
  jwt: { secret: process.env.JWT_SECRET, expiresIn: '7d' }
};`,
  },

  {
    name: 'websocket-vs-testing',
    code1: `
const ws = new WebSocket('wss://api.example.com/stream');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateUI(data);
};
ws.onerror = (error) => console.error('WebSocket error:', error);`,
    code2: `
describe('Calculator', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
  it('should subtract two numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });
});`,
  },

  {
    name: 'encryption-vs-logging',
    code1: `
function encryptAES(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { iv: iv.toString('hex'), data: encrypted };
}`,
    code2: `
const logger = {
  info: (msg) => console.log(\`[INFO] \${new Date().toISOString()}: \${msg}\`),
  error: (msg) => console.error(\`[ERROR] \${new Date().toISOString()}: \${msg}\`),
  debug: (msg) => process.env.DEBUG && console.log(\`[DEBUG] \${msg}\`)
};`,
  },

  {
    name: 'ml-vs-animation',
    code1: `
def train_model(X, y):
    model = Sequential([
        Dense(128, activation='relu', input_shape=(X.shape[1],)),
        Dropout(0.3),
        Dense(64, activation='relu'),
        Dense(1, activation='sigmoid')
    ])
    model.compile(optimizer='adam', loss='binary_crossentropy')
    return model.fit(X, y, epochs=10, batch_size=32)`,
    code2: `
@keyframes slideIn {
  from { transform: translateX(-100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.modal { animation: slideIn 0.3s ease-out forwards; }`,
  },

  {
    name: 'graphql-vs-cli',
    code1: `
const typeDefs = gql\`
  type User { id: ID!, name: String!, posts: [Post!]! }
  type Post { id: ID!, title: String!, author: User! }
  type Query { user(id: ID!): User, posts: [Post!]! }
\`;`,
    code2: `
const program = new Command();
program
  .version('1.0.0')
  .option('-c, --config <path>', 'config file path')
  .option('-v, --verbose', 'verbose output')
  .parse(process.argv);`,
  },
];

// ============================================================================
// METRICS COMPUTATION
// ============================================================================

interface TestResult {
  model: EmbeddingModelId;
  relatedScores: number[];
  unrelatedScores: number[];
  meanRelated: number;
  meanUnrelated: number;
  separation: number;
  auc: number;
  accuracy: number;
}

/**
 * Compute Area Under ROC Curve (AUC).
 * Perfect separation = 1.0, random = 0.5
 */
function computeAUC(relatedScores: number[], unrelatedScores: number[]): number {
  // Create labeled pairs
  const pairs: Array<{ score: number; label: 1 | 0 }> = [
    ...relatedScores.map((score) => ({ score, label: 1 as const })),
    ...unrelatedScores.map((score) => ({ score, label: 0 as const })),
  ];

  // Sort by score descending
  pairs.sort((a, b) => b.score - a.score);

  // Compute AUC using trapezoidal rule
  let tp = 0,
    fp = 0;
  const totalPositive = relatedScores.length;
  const totalNegative = unrelatedScores.length;

  let prevTpr = 0,
    prevFpr = 0;
  let auc = 0;

  for (const pair of pairs) {
    if (pair.label === 1) {
      tp++;
    } else {
      fp++;
    }

    const tpr = tp / totalPositive;
    const fpr = fp / totalNegative;

    // Trapezoidal area
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;

    prevTpr = tpr;
    prevFpr = fpr;
  }

  return auc;
}

/**
 * Compute accuracy using optimal threshold.
 */
function computeAccuracy(relatedScores: number[], unrelatedScores: number[]): number {
  // Find optimal threshold
  const allScores = [...relatedScores, ...unrelatedScores].sort((a, b) => a - b);

  let bestAccuracy = 0;

  for (const threshold of allScores) {
    const truePositives = relatedScores.filter((s) => s >= threshold).length;
    const trueNegatives = unrelatedScores.filter((s) => s < threshold).length;
    const accuracy = (truePositives + trueNegatives) / (relatedScores.length + unrelatedScores.length);

    if (accuracy > bestAccuracy) {
      bestAccuracy = accuracy;
    }
  }

  return bestAccuracy;
}

// ============================================================================
// TEST RUNNER
// ============================================================================

describe('Embedding Model Validation', () => {
  // Models to test - using models that actually exist in @huggingface/transformers
  const MODELS_TO_TEST: EmbeddingModelId[] = ['all-MiniLM-L6-v2', 'jina-embeddings-v2-base-en', 'bge-small-en-v1.5'];

  // Store results for comparison
  const results: TestResult[] = [];

  // Timeout for model loading
  const TIMEOUT = 300000; // 5 minutes

  for (const modelId of MODELS_TO_TEST) {
    describe(`Model: ${modelId}`, () => {
      let relatedScores: number[] = [];
      let unrelatedScores: number[] = [];
      let skipReason: string | null = null;

      beforeAll(async () => {
        const status = await checkAllProviders({ workspaceRoot: process.cwd() });
        if (!status.embedding.available) {
          skipReason = `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`;
          return;
        }

        console.log(`\n[Test] Loading model: ${modelId}...`);

        // Compute embeddings for related pairs
        for (const pair of RELATED_PAIRS) {
          const [result1, result2] = await Promise.all([
            generateRealEmbedding(pair.code1, modelId),
            generateRealEmbedding(pair.code2, modelId),
          ]);
          const similarity = cosineSimilarity(result1.embedding, result2.embedding);
          relatedScores.push(similarity);
          console.log(`  [Related] ${pair.name}: ${similarity.toFixed(4)}`);
        }

        // Compute embeddings for unrelated pairs
        for (const pair of UNRELATED_PAIRS) {
          const [result1, result2] = await Promise.all([
            generateRealEmbedding(pair.code1, modelId),
            generateRealEmbedding(pair.code2, modelId),
          ]);
          const similarity = cosineSimilarity(result1.embedding, result2.embedding);
          unrelatedScores.push(similarity);
          console.log(`  [Unrelated] ${pair.name}: ${similarity.toFixed(4)}`);
        }
      }, TIMEOUT);

      it('should produce valid embeddings', async (ctx) => {
        ctx.skip(skipReason !== null, skipReason ?? undefined);
        expect(relatedScores.length).toBe(RELATED_PAIRS.length);
        expect(unrelatedScores.length).toBe(UNRELATED_PAIRS.length);
      }, TIMEOUT);

      it('should have higher mean similarity for related pairs', async (ctx) => {
        ctx.skip(skipReason !== null, skipReason ?? undefined);
        const meanRelated = relatedScores.reduce((a, b) => a + b, 0) / relatedScores.length;
        const meanUnrelated = unrelatedScores.reduce((a, b) => a + b, 0) / unrelatedScores.length;

        console.log(`\n[${modelId}] Mean Related: ${meanRelated.toFixed(4)}`);
        console.log(`[${modelId}] Mean Unrelated: ${meanUnrelated.toFixed(4)}`);
        console.log(`[${modelId}] Separation: ${(meanRelated - meanUnrelated).toFixed(4)}`);

        expect(meanRelated).toBeGreaterThan(meanUnrelated);
      }, TIMEOUT);

      it('should achieve AUC > 0.7 (better than random)', async (ctx) => {
        ctx.skip(skipReason !== null, skipReason ?? undefined);
        const auc = computeAUC(relatedScores, unrelatedScores);
        console.log(`[${modelId}] AUC: ${auc.toFixed(4)}`);

        // Store result for comparison
        const meanRelated = relatedScores.reduce((a, b) => a + b, 0) / relatedScores.length;
        const meanUnrelated = unrelatedScores.reduce((a, b) => a + b, 0) / unrelatedScores.length;
        const accuracy = computeAccuracy(relatedScores, unrelatedScores);

        results.push({
          model: modelId,
          relatedScores: [...relatedScores],
          unrelatedScores: [...unrelatedScores],
          meanRelated,
          meanUnrelated,
          separation: meanRelated - meanUnrelated,
          auc,
          accuracy,
        });

        expect(auc).toBeGreaterThan(0.7);
      }, TIMEOUT);

      it('should achieve accuracy > 70%', async (ctx) => {
        ctx.skip(skipReason !== null, skipReason ?? undefined);
        const accuracy = computeAccuracy(relatedScores, unrelatedScores);
        console.log(`[${modelId}] Accuracy: ${(accuracy * 100).toFixed(1)}%`);

        expect(accuracy).toBeGreaterThan(0.7);
      }, TIMEOUT);
    });
  }

  // Final comparison (runs after all models tested)
  describe('Model Comparison', () => {
    it('should compare all models', (ctx) => {
      ctx.skip(results.length === 0, 'unverified_by_trace(provider_unavailable): No embedding results (providers unavailable or tests skipped)');

      console.log('\n' + '='.repeat(60));
      console.log('EMBEDDING MODEL COMPARISON');
      console.log('='.repeat(60));

      results.sort((a, b) => b.auc - a.auc);

      for (const result of results) {
        console.log(`\nModel: ${result.model}`);
        console.log(`  AUC:              ${result.auc.toFixed(4)}`);
        console.log(`  Accuracy:         ${(result.accuracy * 100).toFixed(1)}%`);
        console.log(`  Mean Related:     ${result.meanRelated.toFixed(4)}`);
        console.log(`  Mean Unrelated:   ${result.meanUnrelated.toFixed(4)}`);
        console.log(`  Separation:       ${result.separation.toFixed(4)}`);
      }

      console.log('\n' + '='.repeat(60));
      console.log(`BEST MODEL: ${results[0].model} (AUC: ${results[0].auc.toFixed(4)})`);
      console.log('='.repeat(60) + '\n');

      // The best model should have AUC > 0.75
      expect(results[0].auc).toBeGreaterThan(0.75);
    });
  });
});
