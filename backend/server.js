const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_UPI_ID = process.env.UPI_ID || 'turfarena@upi';
const DEFAULT_UPI_NAME = process.env.UPI_NAME || 'TurfArena';
const DEFAULT_UPI_NOTE_PREFIX = process.env.UPI_NOTE_PREFIX || 'TurfArena';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/images', express.static(ROOT_DIR, { index: false, fallthrough: true }));
app.use(express.static(ROOT_DIR, { extensions: ['html'] }));

function createId() {
    return crypto.randomUUID();
}

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function parseAmount(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
}

function nowIso() {
    return new Date().toISOString();
}

function withTimestamps(record, previous = null) {
    const timestamp = nowIso();
    return {
        ...record,
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function getSeedData() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@turfarena.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const createdAt = nowIso();

    return {
        meta: {
            storage: 'file-store',
            initializedAt: createdAt
        },
        users: [
            {
                _id: createId(),
                name: 'TurfArena Admin',
                email: adminEmail,
                password: adminPassword,
                phone: '0000000000',
                role: 'admin',
                createdAt,
                updatedAt: createdAt
            }
        ],
        turfs: [
            {
                _id: createId(),
                name: 'GreenLine Arena',
                meta: 'Velachery • Football, Cricket',
                location: 'Velachery',
                basePrice: 1200,
                sports: ['Football', 'Cricket'],
                panoramaUrl: 'panaroma1.jpeg',
                image: 'aerial-view-grass-field-hockey.jpg',
                reviews: [],
                createdAt,
                updatedAt: createdAt
            },
            {
                _id: createId(),
                name: 'Boundary Line Turf',
                meta: 'Tambaram • Cricket box',
                location: 'Tambaram',
                basePrice: 800,
                sports: ['Cricket'],
                panoramaUrl: 'panaroma2.jpeg',
                image: 'izuddin-helmi-adnan-K5ChxJaheKI-unsplash.jpg',
                reviews: [],
                createdAt,
                updatedAt: createdAt
            },
            {
                _id: createId(),
                name: 'SkyLine Sports Hub',
                meta: 'OMR • Multi-sport',
                location: 'OMR',
                basePrice: 1000,
                sports: ['Football', 'Cricket', 'Multi-sport'],
                panoramaUrl: 'panaroma3.jpeg',
                image: 'thomas-park-fDmpxdV69eA-unsplash.jpg',
                reviews: [],
                createdAt,
                updatedAt: createdAt
            }
        ],
        bookings: [],
        communityPosts: []
    };
}

function readStore() {
    ensureDirExists(DATA_DIR);
    if (!fs.existsSync(STORE_PATH)) {
        const seed = getSeedData();
        fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
        return seed;
    }

    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            meta: parsed.meta || {},
            users: Array.isArray(parsed.users) ? parsed.users : [],
            turfs: Array.isArray(parsed.turfs) ? parsed.turfs : [],
            bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
            communityPosts: Array.isArray(parsed.communityPosts) ? parsed.communityPosts : []
        };
    } catch (error) {
        const backupPath = path.join(DATA_DIR, `store.corrupt.${Date.now()}.json`);
        try {
            fs.copyFileSync(STORE_PATH, backupPath);
        } catch (_) {
        }
        const seed = getSeedData();
        fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
        console.warn('Local data file was invalid and has been reset.', error.message);
        return seed;
    }
}

let store = readStore();

function writeStore() {
    ensureDirExists(DATA_DIR);
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function sanitizeUser(userDoc) {
    return {
        _id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        phone: userDoc.phone,
        role: userDoc.role,
        createdAt: userDoc.createdAt,
        updatedAt: userDoc.updatedAt
    };
}

function getBookingStartDateTime(booking) {
    const bookingDate = String(booking?.date || '').slice(0, 10);
    const numericSlots = (booking?.slots || [])
        .map(slot => parseInt(slot, 10))
        .filter(Number.isInteger)
        .sort((a, b) => a - b);

    if (!bookingDate || !numericSlots.length) return null;

    const [year, month, day] = bookingDate.split('-').map(Number);
    const hour = numericSlots[0];
    if (!year || !month || !day || !Number.isInteger(hour)) return null;

    return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function getRefundDecision(booking, turf) {
    const startAt = getBookingStartDateTime(booking);
    const now = new Date();
    const isEligible = !!startAt && (startAt.getTime() - now.getTime()) >= (30 * 60 * 1000);
    const slotCount = Array.isArray(booking?.slots) ? booking.slots.length : 0;
    const pricePerSlot = Number(turf?.basePrice || 0);
    const refundAmount = isEligible ? slotCount * pricePerSlot : 0;

    return {
        isEligible,
        refundAmount
    };
}

function buildUpiIntent({ amount, purpose, reference }) {
    const params = new URLSearchParams({
        pa: DEFAULT_UPI_ID,
        pn: DEFAULT_UPI_NAME,
        am: Number(amount).toFixed(2),
        cu: 'INR',
        tn: `${DEFAULT_UPI_NOTE_PREFIX} ${purpose}`.trim(),
        tr: reference
    });

    return {
        method: 'UPI',
        merchantUpiId: DEFAULT_UPI_ID,
        merchantName: DEFAULT_UPI_NAME,
        amount: Number(amount).toFixed(2),
        reference,
        note: `${DEFAULT_UPI_NOTE_PREFIX} ${purpose}`.trim(),
        upiUrl: `upi://pay?${params.toString()}`
    };
}

function normalizeCommunityPayload(body = {}) {
    return {
        postType: String(body.postType || '').trim(),
        sport: String(body.sport || 'Football').trim(),
        teamName: String(body.teamName || '').trim(),
        turf: String(body.turf || '').trim(),
        spots: Math.max(0, parseInt(body.spots, 10) || 0),
        fare: parseAmount(body.fare),
        prizePool: String(body.prizePool || '').trim(),
        eventDate: body.eventDate ? String(body.eventDate).trim() : '',
        eventTime: body.eventTime ? String(body.eventTime).trim() : '',
        maxTeams: Math.max(0, parseInt(body.maxTeams, 10) || 0),
        status: String(body.status || 'Open').trim(),
        createdBy: normalizeEmail(body.createdBy),
        requests: Array.isArray(body.requests) ? body.requests : [],
        reviews: Array.isArray(body.reviews) ? body.reviews : []
    };
}

function sortNewest(list) {
    return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function getTurfById(turfId) {
    return store.turfs.find(turf => turf._id === turfId);
}

function getCommunityPost(postId) {
    return store.communityPosts.find(post => post._id === postId);
}

function ensureSeededData() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@turfarena.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const existingAdmin = store.users.find(user => normalizeEmail(user.email) === normalizeEmail(adminEmail));
    if (!existingAdmin) {
        store.users.push(withTimestamps({
            _id: createId(),
            name: 'TurfArena Admin',
            email: normalizeEmail(adminEmail),
            password: adminPassword,
            phone: '0000000000',
            role: 'admin'
        }));
    }

    if (store.turfs.length === 0) {
        store.turfs = getSeedData().turfs;
    }

    writeStore();
}

ensureSeededData();

app.get('/api/health', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'turfarena-backend',
        db: 'file-store'
    });
});

app.get('/api/payments/config', (req, res) => {
    res.json({
        method: 'UPI',
        merchantUpiId: DEFAULT_UPI_ID,
        merchantName: DEFAULT_UPI_NAME,
        notePrefix: DEFAULT_UPI_NOTE_PREFIX,
        verification: 'client_confirmed'
    });
});

app.post('/api/payments/intent', (req, res) => {
    const amount = parseAmount(req.body.amount);
    const purpose = String(req.body.purpose || '').trim();
    const reference = String(req.body.reference || `TA-${Date.now()}`).trim();

    if (!amount || !purpose) {
        return res.status(400).json({ error: 'amount and purpose are required.' });
    }

    res.json(buildUpiIntent({ amount, purpose, reference }));
});

app.post('/api/auth/register', (req, res) => {
    try {
        const { name, phone, email, password } = req.body || {};
        if (!name || !phone || !email || !password) {
            return res.status(400).json({ error: 'name, phone, email, and password are required.' });
        }

        const normalizedEmail = normalizeEmail(email);
        const existingUser = store.users.find(user => normalizeEmail(user.email) === normalizedEmail);
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        const newUser = withTimestamps({
            _id: createId(),
            name: String(name).trim(),
            phone: String(phone).trim(),
            email: normalizedEmail,
            password: String(password),
            role: 'user'
        });

        store.users.push(newUser);
        writeStore();
        res.status(201).json({ user: sanitizeUser(newUser) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required.' });
        }

        const normalizedEmail = normalizeEmail(email);
        const user = store.users.find(item => normalizeEmail(item.email) === normalizedEmail);
        if (!user || user.password !== String(password)) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        res.json({ user: sanitizeUser(user) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', (req, res) => {
    try {
        res.json(sortNewest(store.users.map(sanitizeUser)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/turfs', (req, res) => {
    try {
        res.json(sortNewest(store.turfs));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/turfs', (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.name) {
            return res.status(400).json({ error: 'name is required.' });
        }

        const newTurf = withTimestamps({
            _id: createId(),
            name: String(payload.name).trim(),
            meta: String(payload.meta || '').trim(),
            location: String(payload.location || '').trim(),
            basePrice: parseAmount(payload.basePrice),
            sports: Array.isArray(payload.sports) ? payload.sports : [],
            panoramaUrl: String(payload.panoramaUrl || '').trim(),
            image: String(payload.image || '').trim(),
            reviews: Array.isArray(payload.reviews) ? payload.reviews : []
        });

        store.turfs.push(newTurf);
        writeStore();
        res.status(201).json(newTurf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/turfs/:id', (req, res) => {
    try {
        const turfIndex = store.turfs.findIndex(turf => turf._id === req.params.id);
        if (turfIndex === -1) return res.status(404).json({ error: 'Turf not found' });

        store.turfs[turfIndex] = withTimestamps({
            ...store.turfs[turfIndex],
            ...req.body
        }, store.turfs[turfIndex]);

        writeStore();
        res.json(store.turfs[turfIndex]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/turfs/:id/reviews', (req, res) => {
    try {
        const turf = getTurfById(req.params.id);
        if (!turf) return res.status(404).json({ error: 'Turf not found' });

        const userName = String(req.body.userName || '').trim();
        const userEmail = normalizeEmail(req.body.userEmail);
        const comment = String(req.body.comment || '').trim();
        const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 0));

        if (!userName || !userEmail || !rating) {
            return res.status(400).json({ error: 'userName, userEmail, and rating are required.' });
        }

        const existingReview = turf.reviews.find(entry => normalizeEmail(entry.userEmail) === userEmail);
        if (existingReview) {
            existingReview.userName = userName;
            existingReview.rating = rating;
            existingReview.comment = comment;
            existingReview.createdAt = nowIso();
        } else {
            turf.reviews.push({
                _id: createId(),
                userName,
                userEmail,
                rating,
                comment,
                createdAt: nowIso()
            });
        }

        turf.updatedAt = nowIso();
        writeStore();
        res.status(201).json(turf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/turfs/:id/reviews', (req, res) => {
    try {
        const turf = getTurfById(req.params.id);
        if (!turf) return res.status(404).json({ error: 'Turf not found' });

        const userEmail = normalizeEmail(req.body?.userEmail || req.query.userEmail);
        if (!userEmail) {
            return res.status(400).json({ error: 'userEmail is required.' });
        }

        const nextReviews = turf.reviews.filter(entry => normalizeEmail(entry.userEmail) !== userEmail);
        if (nextReviews.length === turf.reviews.length) {
            return res.status(404).json({ error: 'Review not found.' });
        }

        turf.reviews = nextReviews;
        turf.updatedAt = nowIso();
        writeStore();
        res.json(turf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/turfs/:id', (req, res) => {
    try {
        const turfIndex = store.turfs.findIndex(turf => turf._id === req.params.id);
        if (turfIndex === -1) return res.status(404).json({ error: 'Turf not found' });

        store.turfs.splice(turfIndex, 1);
        store.bookings = store.bookings.filter(booking => booking.turfId !== req.params.id);
        writeStore();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bookings', (req, res) => {
    try {
        const populated = sortNewest(store.bookings).map(booking => ({
            ...booking,
            turfId: getTurfById(booking.turfId) || booking.turfId
        }));
        res.json(populated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bookings', (req, res) => {
    try {
        if (!req.body.turfId || !Array.isArray(req.body.slots) || req.body.slots.length === 0) {
            return res.status(400).json({ error: 'turfId and at least one slot are required.' });
        }

        const turf = getTurfById(req.body.turfId);
        if (!turf) {
            return res.status(404).json({ error: 'Turf not found.' });
        }

        const newBooking = withTimestamps({
            _id: createId(),
            turfId: req.body.turfId,
            userName: String(req.body.userName || '').trim(),
            userEmail: normalizeEmail(req.body.userEmail),
            slots: req.body.slots.map(String),
            date: String(req.body.date || new Date().toISOString().split('T')[0]).slice(0, 10),
            status: 'Confirmed',
            paymentMethod: String(req.body.paymentMethod || 'UPI'),
            paymentStatus: req.body.upiTransactionId ? 'Paid' : 'Pending',
            upiTransactionId: String(req.body.upiTransactionId || '').trim(),
            refundStatus: 'Not Requested',
            refundAmount: 0,
            cancelledAt: null
        });

        store.bookings.push(newBooking);
        writeStore();
        res.status(201).json(newBooking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/bookings/:id', (req, res) => {
    try {
        const booking = store.bookings.find(item => item._id === req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found.' });

        if (req.body.status === 'Cancelled') {
            if (booking.status === 'Cancelled') {
                return res.status(400).json({ error: 'Booking already cancelled.' });
            }

            const turf = getTurfById(booking.turfId);
            const refundDecision = getRefundDecision(booking, turf);
            booking.status = 'Cancelled';
            booking.cancelledAt = nowIso();
            booking.refundStatus = refundDecision.isEligible ? 'Refunded' : 'Not Eligible';
            booking.refundAmount = refundDecision.refundAmount;
            booking.updatedAt = nowIso();
            writeStore();
            return res.json(booking);
        }

        booking.status = req.body.status || booking.status;
        booking.updatedAt = nowIso();
        writeStore();
        res.json(booking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/community', (req, res) => {
    try {
        res.json(sortNewest(store.communityPosts));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/community', (req, res) => {
    try {
        const payload = normalizeCommunityPayload(req.body);
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@turfarena.com';

        if (!['solo', 'team', 'tournament'].includes(payload.postType)) {
            return res.status(400).json({ error: 'postType must be solo, team, or tournament.' });
        }
        if (!payload.teamName || !payload.createdBy) {
            return res.status(400).json({ error: 'teamName and createdBy are required.' });
        }
        if (payload.postType === 'solo' && payload.spots <= 0) {
            return res.status(400).json({ error: 'Solo openings must have at least one open spot.' });
        }
        if (payload.postType === 'tournament') {
            if (payload.createdBy !== normalizeEmail(adminEmail)) {
                return res.status(403).json({ error: 'Only admins can create tournaments.' });
            }
            if (!payload.eventDate) {
                return res.status(400).json({ error: 'Tournament date is required.' });
            }
            payload.maxTeams = payload.maxTeams || 16;
            payload.status = payload.status || 'Registrations Open';
        }

        const savedPost = withTimestamps({
            _id: createId(),
            ...payload,
            requests: [],
            reviews: []
        });

        store.communityPosts.push(savedPost);
        writeStore();
        res.status(201).json(savedPost);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/community/:id', (req, res) => {
    try {
        const allowedFields = ['status', 'turf', 'fare', 'prizePool', 'eventDate', 'eventTime', 'maxTeams', 'spots'];
        const post = getCommunityPost(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        allowedFields.forEach(field => {
            if (!Object.prototype.hasOwnProperty.call(req.body, field)) return;

            if (field === 'spots') {
                post.spots = Math.max(0, parseInt(req.body.spots, 10) || 0);
                if (post.postType === 'solo') {
                    post.status = post.spots > 0 ? 'Open' : 'Full';
                }
                return;
            }

            post[field] = req.body[field];
        });

        post.updatedAt = nowIso();
        writeStore();
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/community/:id', (req, res) => {
    try {
        const beforeLength = store.communityPosts.length;
        store.communityPosts = store.communityPosts.filter(post => post._id !== req.params.id);
        if (beforeLength === store.communityPosts.length) {
            return res.status(404).json({ error: 'Post not found' });
        }

        writeStore();
        res.json({ success: true, deletedPostId: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/community/:id/request', (req, res) => {
    try {
        const post = getCommunityPost(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const requesterEmail = normalizeEmail(req.body.email);
        const requesterName = String(req.body.name || '').trim();
        const requesterTeam = String(req.body.teamName || '').trim();
        const requesterPhone = String(req.body.phone || '').trim();
        let requesterStatus = ['Accepted', 'Rejected', 'Pending'].includes(req.body.status) ? req.body.status : 'Pending';
        const paymentStatus = req.body.paymentStatus === 'Paid' ? 'Paid' : (post.postType === 'tournament' ? 'Pending' : 'Not Required');
        const paymentAmount = parseAmount(req.body.paymentAmount || req.body.fare || post.fare || 0);
        const upiTransactionId = String(req.body.upiTransactionId || '').trim();

        if (!requesterEmail || !requesterName) {
            return res.status(400).json({ error: 'name and email are required for requests.' });
        }
        if (requesterEmail === post.createdBy) {
            return res.status(400).json({ error: 'You cannot respond to your own post.' });
        }
        if (post.postType === 'solo' && post.spots <= 0) {
            return res.status(400).json({ error: 'This team is already full.' });
        }
        if (post.postType === 'tournament') {
            if (!requesterTeam || !requesterPhone) {
                return res.status(400).json({ error: 'teamName and phone are required for tournament registration.' });
            }
            const acceptedTeams = post.requests.filter(entry => entry.status !== 'Rejected').length;
            if (post.maxTeams > 0 && acceptedTeams >= post.maxTeams) {
                return res.status(400).json({ error: 'Tournament registration is full.' });
            }
            if (!upiTransactionId) {
                return res.status(400).json({ error: 'UPI transaction ID is required for tournament registration.' });
            }
        }

        const duplicateRequest = post.requests.some(entry => normalizeEmail(entry.email) === requesterEmail);
        const duplicateTeamName = post.postType === 'tournament'
            ? post.requests.some(entry => String(entry.teamName || '').trim().toLowerCase() === requesterTeam.toLowerCase())
            : false;

        if (duplicateRequest || duplicateTeamName) {
            return res.status(409).json({ error: 'A request from this user or team already exists.' });
        }

        if (post.postType === 'team' || post.postType === 'tournament') {
            requesterStatus = 'Pending';
        }

        post.requests.push({
            _id: createId(),
            name: requesterName,
            teamName: requesterTeam,
            phone: requesterPhone,
            email: requesterEmail,
            message: String(req.body.message || '').trim(),
            status: requesterStatus,
            paymentMethod: 'UPI',
            paymentStatus,
            paymentAmount,
            upiTransactionId,
            registeredAt: nowIso()
        });

        if (post.postType === 'team') {
            post.status = 'Awaiting Admin Approval';
        }
        if (post.postType === 'tournament' && post.maxTeams > 0 && post.requests.length >= post.maxTeams) {
            post.status = 'Full';
        }

        post.updatedAt = nowIso();
        writeStore();
        res.status(201).json(post);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/community/:postId/request/:requestId', (req, res) => {
    try {
        const { status } = req.body;
        if (!['Accepted', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ error: 'status must be Accepted, Rejected, or Pending.' });
        }

        const post = getCommunityPost(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const requestEntry = post.requests.find(entry => entry._id === req.params.requestId);
        if (!requestEntry) return res.status(404).json({ error: 'Request not found' });

        const previousStatus = requestEntry.status;
        if (post.postType === 'solo') {
            if (status === 'Accepted' && previousStatus !== 'Accepted') {
                if (post.spots <= 0) {
                    return res.status(400).json({ error: 'No spots remaining.' });
                }
                post.spots -= 1;
            }
            if (previousStatus === 'Accepted' && status !== 'Accepted') {
                post.spots += 1;
            }
            if (post.spots <= 0) {
                post.status = 'Full';
            } else if (post.status === 'Full') {
                post.status = 'Open';
            }
        }

        if (post.postType === 'team') {
            if (status === 'Accepted') {
                post.requests.forEach(entry => {
                    if (entry._id !== requestEntry._id && entry.status === 'Accepted') {
                        entry.status = 'Rejected';
                    }
                });
                post.status = 'Matched';
            } else if (previousStatus === 'Accepted' && status !== 'Accepted') {
                post.status = 'Open';
            }
        }

        requestEntry.status = status;
        post.updatedAt = nowIso();
        writeStore();
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/community/:postId/request/:requestId', (req, res) => {
    try {
        const post = getCommunityPost(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const requestEntry = post.requests.find(entry => entry._id === req.params.requestId);
        if (!requestEntry) return res.status(404).json({ error: 'Request not found' });

        const previousStatus = requestEntry.status;
        if (post.postType === 'solo' && previousStatus === 'Accepted') {
            post.spots += 1;
            if (post.spots > 0 && post.status === 'Full') {
                post.status = 'Open';
            }
        }

        post.requests = post.requests.filter(entry => entry._id !== req.params.requestId);

        if (post.postType === 'team') {
            const acceptedRequest = post.requests.find(entry => entry.status === 'Accepted');
            post.status = acceptedRequest ? 'Matched' : 'Open';
        }

        if (post.postType === 'tournament' && post.maxTeams > 0) {
            const liveTeams = post.requests.filter(entry => entry.status !== 'Rejected').length;
            if (liveTeams < post.maxTeams && post.status === 'Full') {
                post.status = 'Registrations Open';
            }
        }

        post.updatedAt = nowIso();
        writeStore();
        res.json(post);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/community/:id/reviews', (req, res) => {
    try {
        const post = getCommunityPost(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const userName = String(req.body.userName || '').trim();
        const userEmail = normalizeEmail(req.body.userEmail);
        const comment = String(req.body.comment || '').trim();
        const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 0));

        if (!userName || !userEmail || !rating) {
            return res.status(400).json({ error: 'userName, userEmail, and rating are required.' });
        }

        const existingReview = post.reviews.find(entry => normalizeEmail(entry.userEmail) === userEmail);
        if (existingReview) {
            existingReview.userName = userName;
            existingReview.rating = rating;
            existingReview.comment = comment;
            existingReview.createdAt = nowIso();
        } else {
            post.reviews.push({
                _id: createId(),
                userName,
                userEmail,
                rating,
                comment,
                createdAt: nowIso()
            });
        }

        post.updatedAt = nowIso();
        writeStore();
        res.status(201).json(post);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => {
    console.log('\n================================');
    console.log('TurfArena Backend Live');
    console.log(`Storage: ${STORE_PATH}`);
    console.log(`Host: ${HOST}`);
    console.log(`Port: ${PORT}`);
    console.log(`Open: http://${HOST}:${PORT}`);
    console.log('================================\n');
});
