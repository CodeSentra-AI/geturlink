import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { initDB, getDB } from './db.js';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Ensure uploads folder exists
const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure private uploads folder exists (outside web root)
const privateUploadsDir = path.join(process.cwd(), 'private_uploads');
if (!fs.existsSync(privateUploadsDir)) {
  fs.mkdirSync(privateUploadsDir, { recursive: true });
}

// Multer Storage Configuration (Public Avatars)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Multer Storage Configuration (Private Products)
const privateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, privateUploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadPrivate = multer({ 
  storage: privateStorage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const app = express();
const PORT = process.env.PORT || 5050;
const JWT_SECRET = process.env.JWT_SECRET || 'geturlink-ultra-secret-key-999';

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// In-memory custom domain cache
const domainCache = new Map();

async function clearDomainCacheForUser(db, userId) {
  try {
    const profile = await db.get('SELECT custom_domain FROM profiles WHERE user_id = ?', [userId]);
    if (profile && profile.custom_domain) {
      domainCache.delete(profile.custom_domain);
    }
  } catch (err) {
    console.error('Error clearing domain cache for user:', err);
  }
}

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5050',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5050'
];

app.use(cors({
  origin: async (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    try {
      const db = getDB();
      const hostname = new URL(origin).hostname;
      
      const cached = domainCache.get(hostname);
      let userProfile = null;
      if (cached && cached.expires > Date.now()) {
        userProfile = cached.profile;
      } else {
        userProfile = await db.get(
          `SELECT u.id, u.username, u.is_premium, u.premium_until, p.* FROM profiles p 
           JOIN users u ON p.user_id = u.id 
           WHERE p.custom_domain = ?`, 
          [hostname]
        );
        domainCache.set(hostname, { profile: userProfile || null, expires: Date.now() + 60 * 1000 });
      }
      
      if (userProfile) {
        const isPremium = userProfile.is_premium === 1 && userProfile.premium_until > Date.now();
        if (isPremium) return callback(null, true);
      }
    } catch (err) {
      console.error('CORS custom domain validation error:', err);
    }
    
    callback(new Error('Not allowed by CORS'));
  }
}));

// Rate Limiters for Security Hardening
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30, // Limit each IP to 30 requests per windowMs
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 10, // Limit each IP to 10 requests per windowMs
  message: { error: 'Too many checkout attempts. Please try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/checkout', checkoutLimiter);

// Stripe Webhook Endpoint (Must be declared before express.json() raw body parsing)
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (webhookSecret && webhookSecret !== 'whsec_placeholder_please_replace_with_real_webhook_secret' && webhookSecret !== 'whsec_placeholder') {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      if (process.env.NODE_ENV === 'production') {
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
      // In development mode, fallback to unverified event if verification fails
      console.log('Development mode: Proceeding without Stripe signature verification.');
      try {
        event = JSON.parse(req.body.toString());
      } catch (parseErr) {
        return res.status(400).send('Invalid JSON payload');
      }
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      return res.status(400).send('Webhook configuration missing: STRIPE_WEBHOOK_SECRET is required');
    }
    console.log('Development mode: Webhook secret not configured. Parsing payload directly.');
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      return res.status(400).send('Invalid JSON payload');
    }
  }

  const db = getDB();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { productId, sellerId, customerEmail } = session.metadata;

    // Check if transaction already exists
    const existing = await db.get('SELECT * FROM transactions WHERE stripe_session_id = ?', [session.id]);
    if (!existing) {
      const amount = session.amount_total / 100;
      const now = Date.now();

      // Record purchase transaction
      const result = await db.run(
        'INSERT INTO transactions (seller_id, product_id, amount, status, customer_email, stripe_session_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sellerId, productId, amount, 'completed', customerEmail, session.id, now]
      );
      const transactionId = result.lastID;

      // Increment sales count for product
      await db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);

      // Record sale event in analytics
      await db.run(
        'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
        [sellerId, 'sale', productId, 'stripe_checkout', now]
      );

      console.log(`Transaction recorded via Webhook: GUL-${transactionId} for product ${productId}`);
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const customerId = invoice.customer;
    if (customerId) {
      await db.run(
        'UPDATE users SET is_premium = 1, premium_until = ? WHERE stripe_customer_id = ?',
        [Date.now() + 30 * 24 * 60 * 60 * 1000, customerId]
      );
      const user = await db.get('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);
      if (user) {
        await clearDomainCacheForUser(db, user.id);
      }
      console.log(`User upgraded to Premium via invoice payment for customer ${customerId}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    if (customerId) {
      await db.run(
        'UPDATE users SET is_premium = 0, premium_until = 0 WHERE stripe_customer_id = ?',
        [customerId]
      );
      const user = await db.get('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);
      if (user) {
        await clearDomainCacheForUser(db, user.id);
      }
      console.log(`User premium subscription deleted for customer ${customerId}`);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// Helper to escape HTML tags to prevent XSS injection
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Custom security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Seeding Default Creator Data
async function seedDefaultData(db) {
  const user = await db.get('SELECT * FROM users WHERE username = ?', ['alice']);
  if (!user) {
    const passwordHash = await bcrypt.hash('password123', 10);
    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, is_premium, premium_until) VALUES (?, ?, ?, ?, ?)',
      ['alice', 'alice@geturlink.com', passwordHash, 1, Date.now() + 30 * 24 * 60 * 60 * 1000]
    );
    const userId = result.lastID;

    // Profile
    await db.run(
      `INSERT INTO profiles (user_id, display_name, bio, avatar_url, theme, custom_css, layout_type, faq_context) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'Alice the Creator',
        'Hey! I am a digital artist and designer based in Tokyo. Creating custom phone themes and design presets.',
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
        'glass-dark',
        '',
        'grid',
        'FAQ Context:\n- Neon Glow Wallpaper Pack costs $9.99. It contains 10 ultra-high-res 8k desktop and mobile wallpapers with cybernetic neon themes.\n- Lightroom Classic Presets costs $24.99. It includes 15 custom film-style presets for street photography, works best with night/neon shots.\n- You can contact me at alice@creative.co.'
      ]
    );

    // Links
    await db.run(
      'INSERT INTO links (user_id, title, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Follow my Twitter/X', 'https://twitter.com', 'twitter', 1]
    );
    await db.run(
      'INSERT INTO links (user_id, title, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [userId, 'My Design Portfolio', 'https://dribbble.com', 'globe', 2]
    );

    // Products
    const prod1 = await db.run(
      'INSERT INTO products (user_id, title, description, price, file_url, sales_count) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'Neon Glow Wallpaper Pack', '10 cyberpunk neon mobile & desktop wallpapers (8K resolution). Perfect for high-contrast setups.', 9.99, 'neon_glow_wallpapers.zip', 42]
    );
    const prod2 = await db.run(
      'INSERT INTO products (user_id, title, description, price, file_url, sales_count) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'Lightroom Classic Presets', '15 elite night-street presets to make your neon street photography pop. Works in Lightroom CC & Classic.', 24.99, 'night_street_presets.xmp', 18]
    );

    // Transactions seeding (mock analytics)
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const isProd1 = Math.random() > 0.4;
      const prodId = isProd1 ? prod1.lastID : prod2.lastID;
      const amount = isProd1 ? 9.99 : 24.99;
      const offsetDays = Math.floor(Math.random() * 30);
      const timestamp = now - offsetDays * 24 * 60 * 60 * 1000;

      await db.run(
        'INSERT INTO transactions (seller_id, product_id, amount, status, customer_email, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, prodId, amount, 'completed', `customer${i}@gmail.com`, timestamp]
      );

      // Add analytics for sale
      await db.run(
        'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
        [userId, 'sale', prodId, 'instagram', timestamp]
      );
    }

    // Add profile view and click analytics
    const referrers = ['instagram', 'tiktok', 'twitter', 'youtube', 'direct'];
    for (let i = 0; i < 500; i++) {
      const offsetDays = Math.floor(Math.random() * 30);
      const timestamp = now - offsetDays * 24 * 60 * 60 * 1000;
      const ref = referrers[Math.floor(Math.random() * referrers.length)];

      await db.run(
        'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
        [userId, 'view', null, ref, timestamp]
      );

      if (Math.random() > 0.5) {
        await db.run(
          'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
          [userId, 'click', Math.random() > 0.5 ? 1 : 2, ref, timestamp]
        );
      }
    }

    console.log('Seeded database with default creator "alice" (Password: password123)');
  }
}

// Middleware: Authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// ----------------------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------------------

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing username, email, or password' });
  }

  // Validate username format (alphanumeric, 3 to 20 characters)
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters (underscores allowed)' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    const db = getDB();
    const existing = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );
    const userId = result.lastID;

    // Initialize blank profile
    await db.run(
      'INSERT INTO profiles (user_id, display_name, bio, theme, layout_type) VALUES (?, ?, ?, ?, ?)',
      [userId, username, `Welcome to my page!`, 'glass-dark', 'grid']
    );

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: userId, username, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { loginIdentifier, password } = req.body; // loginIdentifier can be username or email
  if (!loginIdentifier || !password) {
    return res.status(400).json({ error: 'Missing login identifier or password' });
  }

  try {
    const db = getDB();
    const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [loginIdentifier, loginIdentifier]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, isPremium: user.is_premium } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get('SELECT id, username, email, is_premium, premium_until, stripe_connect_id FROM users WHERE id = ?', [req.user.id]);
    
    if (user && user.is_premium === 1 && user.premium_until > 0 && user.premium_until < Date.now()) {
      await db.run('UPDATE users SET is_premium = 0, premium_until = 0 WHERE id = ?', [user.id]);
      user.is_premium = 0;
      user.premium_until = 0;
      await clearDomainCacheForUser(db, user.id);
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// FILE UPLOAD ENDPOINTS
// ----------------------------------------------------

app.post('/api/upload/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl });
});

app.post('/api/upload/product', authenticateToken, uploadPrivate.single('productFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl });
});

// ----------------------------------------------------
// STRIPE MONETIZATION (CONNECT & BILLING) ENDPOINTS
// ----------------------------------------------------

// Link Stripe account via OAuth Connect
app.get('/api/stripe/connect', authenticateToken, async (req, res) => {
  const clientId = process.env.STRIPE_CLIENT_ID;
  const apiBaseUrl = process.env.API_URL || `http://localhost:${PORT}`;
  
  if (!clientId || clientId === 'ca_placeholder') {
    // Development sandbox Connect simulation
    if (process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'Stripe Connect Client ID is not configured' });
    }
    
    const mockCode = 'ac_mock_code_12345';
    const redirectUrl = `${apiBaseUrl}/api/stripe/connect/callback?code=${mockCode}&state=${req.user.id}`;
    return res.json({ url: redirectUrl });
  }

  const state = req.user.id;
  const redirectUri = `${apiBaseUrl}/api/stripe/connect/callback`;
  const stripeUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  
  res.json({ url: stripeUrl });
});

// Stripe Connect OAuth Callback
app.get('/api/stripe/connect/callback', async (req, res) => {
  const { code, state } = req.query; // state is the userId
  if (!code || !state) {
    return res.status(400).send('OAuth parameters missing');
  }

  try {
    const db = getDB();
    let stripeUserId = 'acct_mock_connect_id_12345';

    if (code !== 'ac_mock_code_12345') {
      const response = await stripe.oauth.token({
        grant_type: 'authorization_code',
        code,
      });
      stripeUserId = response.stripe_user_id;
    }

    await db.run('UPDATE users SET stripe_connect_id = ? WHERE id = ?', [stripeUserId, state]);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?stripe_connected=true`);
  } catch (error) {
    console.error('Stripe Connect OAuth Error:', error);
    res.status(500).send('Stripe Connect failed: ' + error.message);
  }
});

// Disconnect Stripe account
app.post('/api/stripe/disconnect', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    await db.run('UPDATE users SET stripe_connect_id = NULL WHERE id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Stripe Checkout Session for Premium Monthly Subscription
app.post('/api/stripe/create-subscription', authenticateToken, async (req, res) => {
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  const apiBaseUrl = process.env.API_URL || `http://localhost:${PORT}`;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    const db = getDB();
    const user = await db.get('SELECT email, stripe_customer_id FROM users WHERE id = ?', [req.user.id]);
    
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: req.user.id.toString() }
      });
      customerId = customer.id;
      await db.run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customerId, req.user.id]);
    }

    if (!priceId || priceId === 'price_placeholder') {
      // Direct mock upgrade in development mode
      if (process.env.NODE_ENV === 'production') {
        return res.status(400).json({ error: 'Stripe Premium Price ID is not configured' });
      }
      
      console.log('Development mode: Directly upgrading user to premium.');
      await db.run(
        'UPDATE users SET is_premium = 1, premium_until = ? WHERE id = ?',
        [Date.now() + 30 * 24 * 60 * 60 * 1000, req.user.id]
      );
      await clearDomainCacheForUser(db, req.user.id);
      return res.json({ url: `${frontendUrl}?premium_success=true` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}?premium_success=true`,
      cancel_url: `${frontendUrl}?premium_cancel=true`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Subscription checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// PROFILE ENDPOINTS (ADMIN)
// ----------------------------------------------------

app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const profile = await db.get('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  const { displayName, bio, avatarUrl, theme, customCss, layoutType, faqContext, customDomain } = req.body;
  try {
    const db = getDB();
    
    // Check if custom domain is already taken
    if (customDomain) {
      const existing = await db.get(
        'SELECT user_id FROM profiles WHERE custom_domain = ? AND user_id != ?',
        [customDomain, req.user.id]
      );
      if (existing) {
        return res.status(400).json({ error: 'Custom domain is already registered to another profile' });
      }
    }

    // Clear custom domain cache for the user's domains
    const currentProfile = await db.get('SELECT custom_domain FROM profiles WHERE user_id = ?', [req.user.id]);
    if (currentProfile && currentProfile.custom_domain) {
      domainCache.delete(currentProfile.custom_domain);
    }
    if (customDomain) {
      domainCache.delete(customDomain);
    }

    await db.run(
      `UPDATE profiles SET display_name = ?, bio = ?, avatar_url = ?, theme = ?, custom_css = ?, layout_type = ?, faq_context = ?, custom_domain = ?
       WHERE user_id = ?`,
      [displayName, bio, avatarUrl, theme, customCss, layoutType, faqContext, customDomain || null, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle premium simulation
app.post('/api/profile/toggle-premium', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get('SELECT is_premium FROM users WHERE id = ?', [req.user.id]);
    const nextPremium = user.is_premium ? 0 : 1;
    const premiumUntil = nextPremium ? Date.now() + 30 * 24 * 60 * 60 * 1000 : 0;
    await db.run('UPDATE users SET is_premium = ?, premium_until = ? WHERE id = ?', [nextPremium, premiumUntil, req.user.id]);
    await clearDomainCacheForUser(db, req.user.id);
    res.json({ isPremium: nextPremium, premiumUntil });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// LINKS ENDPOINTS (ADMIN)
// ----------------------------------------------------

app.get('/api/links', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const links = await db.all('SELECT * FROM links WHERE user_id = ? ORDER BY sort_order ASC', [req.user.id]);
    res.json(links);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/links', authenticateToken, async (req, res) => {
  const { title, url, icon, sortOrder } = req.body;
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  try {
    const db = getDB();
    const result = await db.run(
      'INSERT INTO links (user_id, title, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, title, url, icon || 'link', sortOrder || 0]
    );
    res.json({ id: result.lastID, title, url, icon: icon || 'link', sort_order: sortOrder || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/links/:id', authenticateToken, async (req, res) => {
  const { title, url, icon, sortOrder } = req.body;
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  try {
    const db = getDB();
    await db.run(
      'UPDATE links SET title = ?, url = ?, icon = ?, sort_order = ? WHERE id = ? AND user_id = ?',
      [title, url, icon, sortOrder, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/links/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    await db.run('DELETE FROM links WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// PRODUCTS ENDPOINTS (ADMIN)
// ----------------------------------------------------

app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const products = await db.all('SELECT * FROM products WHERE user_id = ?', [req.user.id]);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  const { title, description, price, fileUrl } = req.body;
  try {
    const db = getDB();
    const result = await db.run(
      'INSERT INTO products (user_id, title, description, price, file_url) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, title, description, price, fileUrl || 'digital_product.zip']
    );
    res.json({ id: result.lastID, title, description, price, file_url: fileUrl || 'digital_product.zip', sales_count: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  const { title, description, price, fileUrl } = req.body;
  try {
    const db = getDB();
    await db.run(
      'UPDATE products SET title = ?, description = ?, price = ?, file_url = ? WHERE id = ? AND user_id = ?',
      [title, description, price, fileUrl, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    await db.run('DELETE FROM products WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ANALYTICS ENDPOINTS (ADMIN)
// ----------------------------------------------------

app.get('/api/analytics', authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    // Totals
    const totalViews = await db.get("SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'view'", [userId]);
    const totalClicks = await db.get("SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'click'", [userId]);
    const totalSales = await db.get("SELECT COUNT(*) as count FROM transactions WHERE seller_id = ?", [userId]);
    const totalRevenue = await db.get("SELECT SUM(amount) as sum FROM transactions WHERE seller_id = ?", [userId]);

    // Graph data: views and clicks grouped by day (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const viewsTimeSeries = await db.all(
      `SELECT date(timestamp/1000, 'unixepoch') as date_str, COUNT(*) as count 
       FROM analytics 
       WHERE user_id = ? AND event_type = 'view' AND timestamp >= ? 
       GROUP BY date_str ORDER BY date_str ASC`,
      [userId, thirtyDaysAgo]
    );

    const clicksTimeSeries = await db.all(
      `SELECT date(timestamp/1000, 'unixepoch') as date_str, COUNT(*) as count 
       FROM analytics 
       WHERE user_id = ? AND event_type = 'click' AND timestamp >= ? 
       GROUP BY date_str ORDER BY date_str ASC`,
      [userId, thirtyDaysAgo]
    );

    const salesTimeSeries = await db.all(
      `SELECT date(timestamp/1000, 'unixepoch') as date_str, COUNT(*) as count, SUM(amount) as earnings 
       FROM transactions 
       WHERE seller_id = ? AND timestamp >= ? 
       GROUP BY date_str ORDER BY date_str ASC`,
      [userId, thirtyDaysAgo]
    );

    // Referral breakdown
    const referrals = await db.all(
      `SELECT referrer, COUNT(*) as count FROM analytics 
       WHERE user_id = ? AND event_type = 'view' AND referrer IS NOT NULL 
       GROUP BY referrer ORDER BY count DESC`,
      [userId]
    );

    // Recent Transactions
    const recentTransactions = await db.all(
      `SELECT t.*, p.title as product_title FROM transactions t
       JOIN products p ON t.product_id = p.id
       WHERE t.seller_id = ?
       ORDER BY t.timestamp DESC LIMIT 10`,
      [userId]
    );

    res.json({
      totals: {
        views: totalViews.count || 0,
        clicks: totalClicks.count || 0,
        sales: totalSales.count || 0,
        revenue: totalRevenue.sum || 0
      },
      timeSeries: {
        views: viewsTimeSeries,
        clicks: clicksTimeSeries,
        sales: salesTimeSeries
      },
      referrals,
      recentTransactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// PUBLIC STORE & CHECKOUT ENDPOINTS
// ----------------------------------------------------

// Track public page view
app.post('/api/public/:username/view', async (req, res) => {
  const { referrer } = req.body;
  try {
    const db = getDB();
    const user = await db.get('SELECT id FROM users WHERE username = ?', [req.params.username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.run(
      'INSERT INTO analytics (user_id, event_type, referrer, timestamp) VALUES (?, ?, ?, ?)',
      [user.id, 'view', referrer || 'direct', Date.now()]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Click redirection with tracking
app.get('/r/:linkId', async (req, res) => {
  const linkId = req.params.linkId;
  const ref = req.query.ref || 'direct';
  try {
    const db = getDB();
    const link = await db.get('SELECT * FROM links WHERE id = ?', [linkId]);
    if (!link) return res.status(404).send('Link not found');

    // Register analytics click
    await db.run(
      'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
      [link.user_id, 'click', link.id, ref, Date.now()]
    );

    // Update click count in links table
    await db.run('UPDATE links SET click_count = click_count + 1 WHERE id = ?', [link.id]);

    res.redirect(link.url);
  } catch (error) {
    res.status(500).send('Error processing redirection');
  }
});

// Stripe Checkout Session Creator
app.post('/api/checkout', async (req, res) => {
  const { productId, email } = req.body;
  if (!productId || !email) {
    return res.status(400).json({ error: 'Product ID and email are required' });
  }

  try {
    const db = getDB();
    const product = await db.get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const referer = req.headers.referer || `${process.env.FRONTEND_URL || 'http://localhost:5173'}`;
    const apiBaseUrl = process.env.API_URL || `http://localhost:${PORT}`;

    // Get seller Stripe Connect account and premium status
    const seller = await db.get('SELECT stripe_connect_id, is_premium, premium_until FROM users WHERE id = ?', [product.user_id]);

    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: product.title,
            description: product.description || undefined,
          },
          unit_amount: Math.round(product.price * 100), // Stripe uses cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${apiBaseUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: referer,
      metadata: {
        productId: product.id.toString(),
        sellerId: product.user_id.toString(),
        customerEmail: email,
      }
    };

    // Route split payments if seller has Stripe Connect linked
    if (seller && seller.stripe_connect_id) {
      // 5% cut for free tier, 0% cut for premium (verifying premium_until is in the future)
      const isSellerPremium = seller.is_premium === 1 && seller.premium_until > Date.now();
      const feePercent = isSellerPremium ? 0.0 : 0.05;
      const feeAmount = Math.round(product.price * feePercent * 100);

      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: seller.stripe_connect_id,
        },
      };

      if (feeAmount > 0) {
        sessionParams.payment_intent_data.application_fee_amount = feeAmount;
      }
    }

    // Fallback for development mode if keys are not configured
    const isPlaceholderKey = !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('placeholder');
    if (isPlaceholderKey && process.env.NODE_ENV !== 'production') {
      console.log('Development mode: Generating mock checkout session.');
      const mockSessionId = 'cs_mock_' + Math.random().toString(36).substring(2, 11);
      const mockSuccessUrl = `${apiBaseUrl}/checkout-success?session_id=${mockSessionId}&dev_fallback=true&productId=${product.id}&sellerId=${product.user_id}&customerEmail=${encodeURIComponent(email)}&amount=${product.price}`;
      return res.json({
        success: true,
        checkoutUrl: mockSuccessUrl
      });
    }

    // Create Stripe Checkout Session
    try {
      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({
        success: true,
        checkoutUrl: session.url
      });
    } catch (stripeErr) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Stripe checkout error, falling back to mock checkout:', stripeErr.message);
        const mockSessionId = 'cs_mock_' + Math.random().toString(36).substring(2, 11);
        const mockSuccessUrl = `${apiBaseUrl}/checkout-success?session_id=${mockSessionId}&dev_fallback=true&productId=${product.id}&sellerId=${product.user_id}&customerEmail=${encodeURIComponent(email)}&amount=${product.price}`;
        return res.json({
          success: true,
          checkoutUrl: mockSuccessUrl
        });
      }
      console.error('Stripe checkout error:', stripeErr);
      res.status(500).json({ error: stripeErr.message });
    }
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Checkout Success Handler (Renders Premium Download Page)
app.get('/checkout-success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).send('Session ID is missing');
  }

  try {
    const db = getDB();

    // Check if the transaction already exists in our database first.
    // If it does, we can immediately serve the success page without querying Stripe!
    const transaction = await db.get(
      `SELECT t.*, p.title, p.file_url FROM transactions t
       JOIN products p ON t.product_id = p.id
       WHERE t.stripe_session_id = ?`,
      [session_id]
    );

    if (transaction) {
      return renderSuccessPage(res, transaction);
    }

    // Retrieve checkout session from stripe to verify payment
    let session;
    if (req.query.dev_fallback === 'true' && process.env.NODE_ENV !== 'production') {
      console.log('Development mode: Reconstructing mock session details from URL parameters.');
      session = {
        payment_status: 'paid',
        amount_total: Math.round(parseFloat(req.query.amount || '0') * 100),
        metadata: {
          productId: req.query.productId,
          sellerId: req.query.sellerId,
          customerEmail: decodeURIComponent(req.query.customerEmail || 'dev_stripe_fallback@gmail.com')
        }
      };
    } else {
      try {
        session = await stripe.checkout.sessions.retrieve(session_id);
      } catch (stripeErr) {
        console.warn('Stripe session retrieve failed:', stripeErr.message);
        if (process.env.NODE_ENV === 'production') {
          return res.status(400).send('Error verifying payment with Stripe: ' + stripeErr.message);
        }
        
        // In development mode, mock a successful retrieval if Stripe fails
        console.log('Development mode: Mocking successful payment session.');
        session = {
          payment_status: 'paid',
          amount_total: 999,
          metadata: {
            productId: '1',
            sellerId: '1',
            customerEmail: 'dev_stripe_fallback@gmail.com'
          }
        };
      }
    }
    
    if (session.payment_status !== 'paid') {
      return res.status(400).send('Payment has not been completed');
    }

    // Inline fallback if webhook hasn't processed it yet
    const { productId, sellerId, customerEmail } = session.metadata;
    const amount = session.amount_total / 100;
    const now = Date.now();
    
    await db.run(
      'INSERT INTO transactions (seller_id, product_id, amount, status, customer_email, stripe_session_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sellerId, productId, amount, 'completed', customerEmail, session_id, now]
    );
    
    await db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);
    await db.run(
      'INSERT INTO analytics (user_id, event_type, target_id, referrer, timestamp) VALUES (?, ?, ?, ?, ?)',
      [sellerId, 'sale', productId, 'stripe_checkout_inline', now]
    );
    
    const inlineTransaction = await db.get(
      `SELECT t.*, p.title, p.file_url FROM transactions t
       JOIN products p ON t.product_id = p.id
       WHERE t.stripe_session_id = ?`,
      [session_id]
    );
    
    return renderSuccessPage(res, inlineTransaction);
  } catch (err) {
    console.error('Error loading checkout success:', err);
    res.status(500).send('Error loading transaction success: ' + err.message);
  }
});

function renderSuccessPage(res, transaction) {
  const downloadToken = jwt.sign(
    { transactionId: transaction.id }, 
    JWT_SECRET, 
    { expiresIn: '1h' } // 1 hour token expiration
  );

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful | GetUrLink</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          background: radial-gradient(circle at top, #111827, #030712);
          color: #f9fafb;
          font-family: 'Outfit', sans-serif;
          display: flex;
          align-items: center;
          justifyContent: center;
          height: 100vh;
          margin: 0;
          padding: 1rem;
          box-sizing: border-box;
        }
        .success-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 2.5rem;
          max-width: 480px;
          width: 100%;
          text-align: center;
          backdrop-filter: blur(16px);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        }
        .icon-container {
          width: 72px;
          height: 72px;
          background: rgba(16, 185, 129, 0.1);
          border: 2px solid #10b981;
          color: #10b981;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justifyContent: center;
          font-size: 2.25rem;
          margin: 0 auto 1.5rem auto;
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
        }
        h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
        }
        p {
          color: #9ca3af;
          font-size: 0.95rem;
          line-height: 1.6;
          margin: 0 0 2rem 0;
        }
        .btn-download {
          display: inline-block;
          background: #10b981;
          color: white;
          text-decoration: none;
          padding: 1rem 2rem;
          border-radius: 12px;
          font-weight: 700;
          font-size: 1rem;
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
          transition: all 0.3s ease;
        }
        .btn-download:hover {
          transform: translateY(-2px);
          box-shadow: 0 0 25px rgba(16, 185, 129, 0.5);
        }
        .receipt-info {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 0.8rem;
          color: #6b7280;
          text-align: left;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="success-card">
        <div class="icon-container">✓</div>
        <h1>Payment Successful!</h1>
        <p>Thank you for purchasing <strong>${escapeHTML(transaction.title)}</strong>. Your files are ready to download.</p>
        <a href="/api/products/download?token=${downloadToken}" class="btn-download">Download Your Product</a>
        
        <div class="receipt-info">
          <div><strong>Order Details:</strong></div>
          <div style="margin-top: 0.25rem;">Transaction Ref: GUL-${transaction.id}</div>
          <div>Customer: ${escapeHTML(transaction.customer_email)}</div>
          <div>Amount Paid: $${transaction.amount.toFixed(2)}</div>
        </div>
      </div>
    </body>
    </html>
  `);
}

// Serve product file download via secure JWT tokens
app.get('/api/products/download', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).send('Download token is missing');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const transactionId = decoded.transactionId;

    const db = getDB();
    const transaction = await db.get(
      `SELECT t.*, p.title, p.file_url FROM transactions t
       JOIN products p ON t.product_id = p.id
       WHERE t.id = ?`,
      [transactionId]
    );

    if (!transaction) return res.status(404).send('Transaction invalid');
    if (transaction.status !== 'completed') return res.status(400).send('Payment is not completed');

    // Download limit enforcement (allowing up to 5 downloads)
    if (transaction.download_count >= 5) {
      return res.status(410).send(`
        <html>
          <head>
            <title>Link Expired | GetUrLink</title>
            <style>
              body { background: #0b0f19; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { text-align: center; padding: 2rem; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.1); max-width: 400px; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Link Expired</h1>
              <p style="color: #94a3b8; margin-top: 0.5rem;">This secure download link has reached its limit (maximum 5 downloads).</p>
              <p style="color: #64748b; font-size: 0.85rem; margin-top: 1rem;">If you need to download this product again, please contact the creator directly.</p>
            </div>
          </body>
        </html>
      `);
    }

    // Increment download count to enforce single-use
    await db.run('UPDATE transactions SET download_count = download_count + 1 WHERE id = ?', [transactionId]);

    const filename = path.basename(transaction.file_url);
    // Resolve secure private upload path (falling back to public/uploads in development for backward-compatibility)
    let filePath = path.join(process.cwd(), 'private_uploads', filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'public', 'uploads', filename);
    }

    if (!fs.existsSync(filePath)) {
      // Serve simulated payload if actual file is missing in sandbox
      res.setHeader('Content-disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-type', 'application/octet-stream');
      
      const fileContent = `====================================================
GETURLINK SECURE DIGITAL PRODUCTS VAULT
====================================================
Product: ${transaction.title}
Transaction Reference: GUL-${transaction.id}
Customer Email: ${transaction.customer_email}
Purchase Date: ${new Date(transaction.timestamp).toISOString()}

Thank you for your purchase! 
Your download link is validated. This simulated payload represents 
your secure digital preset / wallpaper package. 

GetUrLink Team.
====================================================`;
      return res.send(Buffer.from(fileContent));
    }

    res.download(filePath, filename);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(403).send('Download link has expired. Secure links expire after 1 hour.');
    }
    res.status(403).send('Invalid or expired download link');
  }
});

// Helper function to call the real Gemini 1.5 Flash model
async function queryGemini(faqContext, products, query, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const systemPrompt = `You are a helpful, warm digital sales assistant for a creator's link-in-bio profile.
Here is the creator's FAQ context:
${faqContext}

Here is the creator's digital products catalog:
${products.map(p => `- ID: ${p.id}, Title: "${p.title}", Description: "${p.description || ''}", Price: $${p.price}`).join('\n')}

Rules:
1. Answer the user's question accurately based ONLY on the provided FAQ context and product catalog.
2. Keep your answer brief, warm, friendly, and conversational (under 3 sentences).
3. If they ask about a product or show interest in buying, match the product and recommend it.
4. If you recommend a product, return the matching product ID in the JSON response format below.
5. Format your output strictly as a JSON object with two fields: "answer" (string) and "productId" (number, or null if no product matches). Do not include markdown code block formatting in your JSON output.`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `System Instructions:\n${systemPrompt}\n\nUser Question: ${query}` }] }
        ]
      })
    });
    
    if (!response.ok) throw new Error(`Gemini API error: ${response.statusText}`);
    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) return null;

    // Parse response JSON
    try {
      const cleanedText = responseText.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleanedText);
      return {
        answer: parsed.answer,
        productId: parsed.productId ? Number(parsed.productId) : null
      };
    } catch (parseErr) {
      console.warn("Failed to parse Gemini JSON output, returning raw text:", responseText);
      return {
        answer: responseText,
        productId: null
      };
    }
  } catch (err) {
    console.error("Gemini API call failed:", err.message);
    return null;
  }
}

// Local Heuristic AI shop assistant query responder
app.post('/api/public/:username/ask', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Question is empty' });

  try {
    const db = getDB();
    const userProfile = await db.get(
      'SELECT u.id, u.username, u.is_premium, u.premium_until, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.username = ?',
      [req.params.username]
    );
    if (!userProfile) return res.status(404).json({ error: 'Creator not found' });

    const products = await db.all('SELECT * FROM products WHERE user_id = ?', [userProfile.id]);

    // Check if Gemini API key is configured
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'gemini_placeholder' && apiKey.trim() !== '') {
      const geminiResponse = await queryGemini(userProfile.faq_context || '', products, query, apiKey);
      if (geminiResponse) {
        return res.json({
          answer: geminiResponse.answer,
          product: geminiResponse.productId ? products.find(p => p.id === geminiResponse.productId) : null
        });
      }
    }

    console.log('Gemini API key missing or failed. Falling back to local heuristic matching.');

    // Local heuristic matching logic (simulating a smart sales assistant)
    const lowerQuery = query.toLowerCase();
    let matchedProduct = null;
    
    // Find matching product by keyword in title or description
    for (const p of products) {
      if (lowerQuery.includes(p.title.toLowerCase()) || 
          p.title.toLowerCase().split(' ').some(word => word.length > 3 && lowerQuery.includes(word)) ||
          (p.description && p.description.toLowerCase().split(' ').some(word => word.length > 3 && lowerQuery.includes(word)))) {
        matchedProduct = p;
        break;
      }
    }

    // Process context if creator has FAQ context defined
    const faqContext = userProfile.faq_context || '';
    let responseText = '';

    if (matchedProduct) {
      responseText = `Yes! I highly recommend checking out "${matchedProduct.title}". It's exactly what you need. It costs just $${matchedProduct.price}. ${matchedProduct.description || ''} Would you like to buy it right now?`;
    } else if (lowerQuery.includes('price') || lowerQuery.includes('cost') || lowerQuery.includes('how much')) {
      if (products.length > 0) {
        responseText = `I sell the following products:\n` + products.map(p => `- ${p.title} for $${p.price}`).join('\n') + `\nLet me know if you want a direct link for any of them!`;
      } else {
        responseText = `I don't have any digital products listed for sale at the moment. Let me know if you want to connect elsewhere!`;
      }
    } else if (lowerQuery.includes('hello') || lowerQuery.includes('hi') || lowerQuery.includes('hey')) {
      responseText = `Hey there! I'm the digital assistant for ${userProfile.display_name || req.params.username}. I can answer questions about their products, services, or how to reach them. What are you looking for today?`;
    } else if (faqContext && lowerQuery.split(' ').some(w => w.length > 3 && faqContext.toLowerCase().includes(w))) {
      // Heuristic extraction of lines from FAQ
      const lines = faqContext.split('\n').filter(line => line.trim().length > 0);
      const matchingLines = lines.filter(line => 
        lowerQuery.split(' ').some(word => word.length > 3 && line.toLowerCase().includes(word))
      );
      if (matchingLines.length > 0) {
        responseText = matchingLines.join('\n');
      } else {
        responseText = `Thanks for asking! Based on ${userProfile.display_name}'s info: ${faqContext.substring(0, 150)}... If you need anything specific, let me know!`;
      }
    } else {
      // General fallbacks
      responseText = `That's a great question! While I don't have a specific answer for that, you can check out ${userProfile.display_name || req.params.username}'s links below or ask me about their files/presets.`;
    }

    res.json({
      answer: responseText,
      product: matchedProduct ? {
        id: matchedProduct.id,
        title: matchedProduct.title,
        price: matchedProduct.price
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// SERVER-SIDE RENDERED (SSR) PUBLIC PROFILES
// ---------------------------------------------------

function sanitizeCSS(css) {
  if (!css) return '';
  return css
    .replace(/<\/style>/gi, '')
    .replace(/<script/gi, '')
    .replace(/@import/gi, '/*blocked-import*/')
    .replace(/url\s*\(/gi, '/*blocked-url*/(')
    .replace(/expression\s*\(/gi, '/*blocked-expression*/(');
}

// Helper to render public profile HTML
async function serveProfile(req, res, userProfile) {
  try {
    const db = getDB();
    const links = await db.all('SELECT * FROM links WHERE user_id = ? ORDER BY sort_order ASC', [userProfile.id]);
    const products = await db.all('SELECT * FROM products WHERE user_id = ?', [userProfile.id]);

    // CSS Theme Variable Maps
    const themes = {
      'glass-dark': `
        --bg: radial-gradient(circle at top, #111827, #030712);
        --card-bg: rgba(255, 255, 255, 0.05);
        --card-border: rgba(255, 255, 255, 0.1);
        --card-hover: rgba(255, 255, 255, 0.1);
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --accent: #6366f1;
        --accent-glow: rgba(99, 102, 241, 0.5);
      `,
      'neon-glow': `
        --bg: #050508;
        --card-bg: rgba(16, 16, 24, 0.7);
        --card-border: #d946ef;
        --card-hover: rgba(217, 70, 239, 0.2);
        --text: #fdf4ff;
        --text-muted: #e879f9;
        --accent: #d946ef;
        --accent-glow: rgba(217, 70, 239, 0.6);
        --shadow-glow: 0 0 15px rgba(217, 70, 239, 0.4);
      `,
      'cyberpunk': `
        --bg: #f3f4f6;
        --bg-img: linear-gradient(135deg, #ffe600, #ffe600);
        --bg: #000;
        --card-bg: #1c1917;
        --card-border: #facc15;
        --card-hover: #facc15;
        --text: #00ff66;
        --text-muted: #facc15;
        --accent: #00ff66;
        --accent-glow: rgba(0, 255, 102, 0.5);
      `,
      'sunset-glow': `
        --bg: linear-gradient(to bottom, #1e1b4b, #31102f);
        --card-bg: rgba(254, 215, 170, 0.08);
        --card-border: rgba(249, 115, 22, 0.3);
        --card-hover: rgba(249, 115, 22, 0.2);
        --text: #ffedd5;
        --text-muted: #fdba74;
        --accent: #f97316;
        --accent-glow: rgba(249, 115, 22, 0.5);
      `,
      'aurora-borealis': `
        --bg: linear-gradient(135deg, #022c22, #0f172a, #1e1b4b);
        --card-bg: rgba(255, 255, 255, 0.04);
        --card-border: rgba(16, 185, 129, 0.3);
        --card-hover: rgba(16, 185, 129, 0.1);
        --text: #f0fdf4;
        --text-muted: #a7f3d0;
        --accent: #10b981;
        --accent-glow: rgba(16, 185, 129, 0.4);
      `,
      'retro-wave': `
        --bg: linear-gradient(to bottom, #11001c, #2d004d, #000000);
        --card-bg: rgba(255, 0, 127, 0.05);
        --card-border: #ff007f;
        --card-hover: rgba(255, 0, 127, 0.2);
        --text: #ffffff;
        --text-muted: #ff9ebb;
        --accent: #ff007f;
        --accent-glow: rgba(255, 0, 127, 0.6);
      `,
      'sakura-blossom': `
        --bg: linear-gradient(135deg, #fff1f2, #ffe4e6, #fce7f3);
        --card-bg: rgba(255, 255, 255, 0.7);
        --card-border: rgba(251, 113, 133, 0.3);
        --card-hover: rgba(251, 113, 133, 0.15);
        --text: #4c0519;
        --text-muted: #9f1239;
        --accent: #db2777;
        --accent-glow: rgba(219, 39, 119, 0.3);
      `,
      'glass-light': `
        --bg: linear-gradient(135deg, #e0e7ff, #f3e8ff, #fdf2f8);
        --card-bg: rgba(255, 255, 255, 0.35);
        --card-border: rgba(255, 255, 255, 0.6);
        --card-hover: rgba(255, 255, 255, 0.5);
        --text: #1e1b4b;
        --text-muted: #4f46e5;
        --accent: #6366f1;
        --accent-glow: rgba(99, 102, 241, 0.25);
      `
    };

    const selectedThemeVars = themes[userProfile.theme] || themes['glass-dark'];

    // Sanitize custom CSS to prevent tag breakout XSS
    const isPremium = userProfile.is_premium === 1 && userProfile.premium_until > Date.now();
    const sanitizedCss = isPremium ? sanitizeCSS(userProfile.custom_css) : '';

    // Generate public HTML page with embedded client-side checkout and AI shop chat widgets
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(userProfile.display_name || userProfile.username)} | GetUrLink</title>
  <meta name="description" content="${escapeHTML(userProfile.bio || '')}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      ${selectedThemeVars}
      font-family: 'Outfit', sans-serif;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    body {
      background: var(--bg);
      background-attachment: fixed;
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
      overflow-x: hidden;
    }
 
    .container {
      width: 100%;
      max-width: 580px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    }
 
    .profile-header {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--accent);
      box-shadow: 0 0 20px var(--accent-glow);
    }
 
    .name {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.025em;
    }
 
    .bio {
      font-size: 0.95rem;
      color: var(--text-muted);
      line-height: 1.5;
      max-width: 420px;
    }
 
    /* Bento / Grid Layout */
    .links-grid {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }
 
    .layout-list .links-grid {
      grid-template-columns: 1fr;
    }
 
    .bento-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      text-decoration: none;
      color: var(--text);
      cursor: pointer;
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow-glow);
      position: relative;
      overflow: hidden;
    }
 
    .bento-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%);
      pointer-events: none;
    }
 
    .bento-card:hover {
      transform: translateY(-4px);
      border-color: var(--accent);
      background: var(--card-hover);
      box-shadow: 0 8px 25px var(--accent-glow);
    }
 
    .bento-card.full-width {
      grid-column: span 2;
    }
 
    .layout-list .bento-card {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
    }
 
    .card-title {
      font-weight: 600;
      font-size: 1.1rem;
    }
 
    .card-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
 
    .card-icon {
      font-size: 1.5rem;
      color: var(--accent);
    }
 
    .price-badge {
      align-self: flex-start;
      background: var(--accent);
      color: #fff;
      padding: 0.25rem 0.75rem;
      border-radius: 99px;
      font-weight: 600;
      font-size: 0.8rem;
    }
 
    /* Store Section Header */
    .section-title {
      align-self: flex-start;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 1rem;
    }
 
    /* Interactive Assistant Widget */
    .assistant-section {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      backdrop-filter: blur(12px);
    }
 
    .chat-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      color: var(--accent);
    }
 
    .chat-box {
      max-height: 200px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding-right: 0.5rem;
    }
 
    .chat-msg {
      padding: 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      max-width: 85%;
      line-height: 1.4;
    }
 
    .msg-bot {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255,255,255,0.06);
      align-self: flex-start;
    }
 
    .msg-user {
      background: var(--accent);
      color: #fff;
      align-self: flex-end;
    }
 
    .chat-input-row {
      display: flex;
      gap: 0.5rem;
    }
 
    .chat-input {
      flex: 1;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-family: inherit;
      outline: none;
    }
 
    .chat-input:focus {
      border-color: var(--accent);
    }
 
    .btn-send {
      background: var(--accent);
      border: none;
      color: white;
      padding: 0.75rem 1.25rem;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 600;
    }
 
    .btn-send:hover {
      box-shadow: 0 0 15px var(--accent-glow);
    }
 
    /* Checkout Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
 
    .modal-card {
      background: #0f172a;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 2rem;
      max-width: 440px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
 
    .modal-title {
      font-size: 1.25rem;
      font-weight: 700;
    }
 
    .modal-input {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #fff;
      padding: 0.875rem 1.25rem;
      border-radius: 12px;
      outline: none;
      font-family: inherit;
    }
 
    .modal-input:focus {
      border-color: var(--accent);
    }
 
    .btn-pay {
      background: #10b981;
      color: white;
      border: none;
      padding: 1rem;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 700;
      font-size: 1rem;
    }
 
    .btn-pay:hover {
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
    }
 
    .btn-close {
      background: transparent;
      color: var(--text-muted);
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
      align-self: center;
    }
 
    .watermark {
      margin-top: 3rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      text-decoration: none;
      opacity: 0.6;
    }
 
    .watermark:hover {
      opacity: 1;
      color: var(--accent);
    }
 
    ${sanitizedCss}
  </style>
</head>
<body class="layout-${userProfile.layout_type}">
 
  <div class="container">
    
    <div class="profile-header">
      <img src="${escapeHTML(userProfile.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150')}" alt="${escapeHTML(userProfile.display_name || userProfile.username)}" class="avatar">
      <h1 class="name">${escapeHTML(userProfile.display_name || userProfile.username)}</h1>
      <p class="bio">${escapeHTML(userProfile.bio || '')}</p>
    </div>
 
    <!-- Interactive AI Assistant Widget -->
    <div class="assistant-section">
      <div class="chat-header">
        <span class="chat-icon">✨</span> Ask ${escapeHTML(userProfile.display_name || userProfile.username)}'s Assistant
      </div>
      <div class="chat-box" id="chatBox">
        <div class="chat-msg msg-bot">
          Hi! Ask me anything about ${escapeHTML(userProfile.display_name || userProfile.username)}'s presets, templates, or wallpaper files! I can help you checkout directly.
        </div>
      </div>
      <div class="chat-input-row">
        <input type="text" class="chat-input" id="chatInput" placeholder="Ask a question about the presets...">
        <button class="btn-send" onclick="sendMessage()">Ask</button>
      </div>
    </div>
 
    <div class="section-title">Links & Projects</div>
    <div class="links-grid">
      ${links.map(link => `
        <a href="/r/${link.id}?ref=bio" class="bento-card full-width" target="_blank">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div>
              <div class="card-title">${escapeHTML(link.title)}</div>
              <div class="card-desc">${escapeHTML(link.url)}</div>
            </div>
            <div class="card-icon">🔗</div>
          </div>
        </a>
      `).join('')}
    </div>
 
    ${products.length > 0 ? `
      <div class="section-title">Digital Shop</div>
      <div class="links-grid">
        ${products.map(p => `
          <div class="bento-card" onclick="openCheckout(${p.id}, '${escapeHTML(p.title).replace(/'/g, "\\'")}', ${p.price})">
            <span class="price-badge">$${p.price}</span>
            <div class="card-title" style="margin-top: 0.5rem;">${escapeHTML(p.title)}</div>
            <div class="card-desc">${escapeHTML(p.description || '')}</div>
            <div class="card-icon" style="margin-top: auto; align-self: flex-end;">🛍️</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
 
    <a href="https://geturlink.com" class="watermark" target="_blank">Powered by GetUrLink</a>
  </div>
 
  <!-- Checkout Modal -->
  <div class="modal-overlay" id="checkoutModal">
    <div class="modal-card">
      <div class="modal-title" id="checkoutTitle">Buy Digital Product</div>
      <p style="color: #94a3b8; font-size: 0.9rem;">Enter your email address. Since this is in sandbox mode, you'll receive your download link instantly after submitting.</p>
      <input type="email" class="modal-input" id="checkoutEmail" placeholder="yourname@gmail.com" required>
      <button class="btn-pay" onclick="processPayment()">Complete Secure Checkout</button>
      <button class="btn-close" onclick="closeCheckout()">Cancel</button>
    </div>
  </div>
 
  <script>
    // Record page view analytics
    fetch('/api/public/${userProfile.username}/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referrer: document.referrer || 'direct' })
    }).catch(err => console.log('Analytics view err', err));
 
    let activeProductId = null;
 
    function openCheckout(productId, title, price) {
      activeProductId = productId;
      document.getElementById('checkoutTitle').innerText = 'Get ' + title + ' - $' + price;
      document.getElementById('checkoutModal').style.display = 'flex';
      document.getElementById('checkoutEmail').focus();
    }
 
    function closeCheckout() {
      document.getElementById('checkoutModal').style.display = 'none';
      activeProductId = null;
    }
 
    async function processPayment() {
      const email = document.getElementById('checkoutEmail').value;
      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }
 
      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: activeProductId, email })
        });
        const data = await response.json();
        
        if (data.success) {
          closeCheckout();
          // Redirect user to Stripe Checkout hosted checkout page
          window.location.href = data.checkoutUrl;
        } else {
          alert('Error completing checkout: ' + data.error);
        }
      } catch (err) {
        console.error(err);
        alert('Checkout request failed.');
      }
    }
 
    async function sendMessage() {
      const input = document.getElementById('chatInput');
      const query = input.value.trim();
      if (!query) return;
 
      input.value = '';
      appendMessage(query, 'user');
 
      // Append typing loader
      const chatBox = document.getElementById('chatBox');
      const loader = document.createElement('div');
      loader.className = 'chat-msg msg-bot';
      loader.id = 'chatLoader';
      loader.innerText = 'Thinking...';
      chatBox.appendChild(loader);
      chatBox.scrollTop = chatBox.scrollHeight;
 
      try {
        const response = await fetch('/api/public/${userProfile.username}/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await response.json();
        
        // Remove loader
        const loaderEl = document.getElementById('chatLoader');
        if (loaderEl) loaderEl.remove();
 
        appendMessage(data.answer, 'bot');
 
        // If assistant matched a specific product, present buy action
        if (data.product) {
          const buyCard = document.createElement('div');
          buyCard.className = 'chat-msg msg-bot';
          buyCard.style.border = '1px solid var(--accent)';
          buyCard.innerHTML = \`
            <div style="font-weight:600;margin-bottom:0.25rem;">\${data.product.title}</div>
            <button onclick="openCheckout(\${data.product.id}, '\${data.product.title}', \${data.product.price})" 
                    style="background:var(--accent);color:#white;border:none;padding:0.4rem 0.8rem;border-radius:6px;font-weight:600;font-size:0.8rem;cursor:pointer;">
              Buy Now for $\${data.product.price}
            </button>
          \`;
          chatBox.appendChild(buyCard);
          chatBox.scrollTop = chatBox.scrollHeight;
        }
 
      } catch (err) {
        console.error(err);
        const loaderEl = document.getElementById('chatLoader');
        if (loaderEl) loaderEl.remove();
        appendMessage('Sorry, I am having trouble answering right now.', 'bot');
      }
    }
 
    function appendMessage(text, sender) {
      const chatBox = document.getElementById('chatBox');
      const msg = document.createElement('div');
      msg.className = 'chat-msg ' + (sender === 'user' ? 'msg-user' : 'msg-bot');
      msg.innerText = text;
      chatBox.appendChild(msg);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
 
    // Support Enter Key for Chat
    document.getElementById('chatInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    res.status(500).send('Error rendering profile: ' + error.message);
  }
}

// Custom Domain Wildcard Router middleware
app.use(async (req, res, next) => {
  const host = req.hostname;
  
  if (host === 'localhost' || host === 'geturlink.com' || host === '127.0.0.1') {
    return next();
  }

  try {
    const db = getDB();
    
    let userProfile = null;
    const cached = domainCache.get(host);
    if (cached && cached.expires > Date.now()) {
      userProfile = cached.profile;
    } else {
      userProfile = await db.get(
        `SELECT u.id, u.username, u.is_premium, u.premium_until, p.* FROM profiles p 
         JOIN users u ON p.user_id = u.id 
         WHERE p.custom_domain = ?`, 
        [host]
      );
      domainCache.set(host, { profile: userProfile || null, expires: Date.now() + 60 * 1000 });
    }

    if (userProfile) {
      const isPremium = userProfile.is_premium === 1 && userProfile.premium_until > Date.now();
      if (isPremium) {
        return serveProfile(req, res, userProfile);
      } else {
        console.log(`Custom domain ${host} requested but creator is not premium or subscription expired.`);
      }
    }
  } catch (err) {
    console.error('Custom domain route check error:', err);
  }

  next();
});

app.get('/p/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const db = getDB();
    const userProfile = await db.get(
      'SELECT u.id, u.username, u.is_premium, u.premium_until, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.username = ?',
      [username]
    );

    if (!userProfile) {
      return res.status(404).send(`
        <html>
          <head>
            <title>User Not Found</title>
            <style>
              body { background: #0b0f19; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { text-align: center; padding: 2rem; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.1); }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Creator Not Found</h1>
              <p>The profile "${username}" does not exist on GetUrLink.</p>
              <a href="/" style="color: #6366f1; text-decoration: none;">Create your profile</a>
            </div>
          </body>
        </html>
      `);
    }

    await serveProfile(req, res, userProfile);
  } catch (error) {
    res.status(500).send('Error rendering profile: ' + error.message);
  }
});

// Setup public files upload endpoint wrapper
app.use(express.static('public'));

// Server init
initDB()
  .then(async (db) => {
    if (process.env.NODE_ENV !== 'production') {
      await seedDefaultData(db);
    }
    app.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize SQLite Database:', err);
  });
