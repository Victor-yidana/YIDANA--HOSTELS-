// ==================== YIDANA HOSTELS - COMPLETE BACKEND WITH AI ASSISTANT ====================
// File: server.js
// Description: Full backend API for YIDANA HOSTELS platform with DeepSeek AI Assistant
// ==================== IMPORTS ====================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

// ==================== INIT APP ====================
const app = express();

// ==================== UPDATED CORS CONFIGURATION FOR RENDER & GITHUB PAGES ====================
const allowedOrigins = [
    'http://localhost:5000',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://victor-yidana.github.io',
    'https://yidana-hostels.onrender.com'
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            console.log('Blocked origin:', origin);
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

// ✅ REMOVED the problematic line: app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Create directories if they don't exist
const dirs = ['uploads', 'frontend'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve static files
app.use(express.static('frontend'));
app.use('/uploads', express.static('uploads'));

// ==================== MONGODB CONNECTION ====================
mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    console.log('✅ MongoDB connected successfully');

    try {
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        if (collections.some(col => col.name === 'users')) {
            const indexes = await db.collection('users').indexes();
            const phoneIndex = indexes.find(idx => idx.name === 'phone_1');

            if (phoneIndex) {
                await db.collection('users').dropIndex('phone_1');
                console.log('✅ Successfully dropped old phone_1 index');
            } else {
                console.log('✅ No phone_1 index found - database is clean');
            }
        }
    } catch (indexError) {
        console.log('Note: Could not check indexes:', indexError.message);
    }
})
.catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== NODEMAILER SETUP ====================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.verify(function(error, success) {
    if (error) {
        console.log('❌ Email server error:', error);
    } else {
        console.log('✅ Email server is ready to send messages');
    }
});

// ==================== MULTER SETUP ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'hostel-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// ==================== DATABASE MODELS ====================
// (All your existing models remain exactly the same - I'm keeping them unchanged)

// --- User Schema ---
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    mobile: { type: String, required: true, unique: true },
    phone: { type: String, sparse: true },
    userId: { type: String, unique: true, sparse: true },
    userPin: { type: String },
    role: { type: String, enum: ['student', 'owner'], required: true },
    isApproved: { type: Boolean, default: function() { return this.role === 'student' ? true : false; } },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    
    profilePicture: { type: String },
    
    roommatePreferences: {
        smoking: { type: String, enum: ['yes', 'no', 'indifferent'], default: 'indifferent' },
        pets: { type: String, enum: ['yes', 'no', 'indifferent'], default: 'indifferent' },
        studyHabits: { type: String, enum: ['morning', 'night', 'flexible'], default: 'flexible' },
        sleepSchedule: { type: String, enum: ['early', 'late', 'flexible'], default: 'flexible' },
        cleanliness: { type: Number, min: 1, max: 5, default: 3 },
        noiseLevel: { type: Number, min: 1, max: 5, default: 3 },
        budget: { type: Number },
        preferredGender: { type: String, enum: ['male', 'female', 'any'], default: 'any' }
    },
    
    createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', function() {
    if (!this.phone && this.mobile) {
        this.phone = this.mobile;
    }
});

userSchema.pre('findOneAndUpdate', function() {
    const update = this.getUpdate();
    if (update && update.mobile && !update.phone) {
        update.phone = update.mobile;
    }
});

// --- Announcement Schema ---
const announcementSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    sender: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: false 
    },
    senderRole: { type: String, enum: ['admin', 'owner'], required: true },
    senderName: { type: String, required: true },
    
    targetAudience: { 
        type: String, 
        enum: ['everyone', 'students', 'owners', 'specific_hostel', 'specific_students'],
        required: true 
    },
    
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
    
    targetedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    
    scheduledFor: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    
    isActive: { type: Boolean, default: true },
    isRead: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    
    attachments: [String],
    
    isImportant: { type: Boolean, default: false },
    
    createdAt: { type: Date, default: Date.now }
});

announcementSchema.index({ expiresAt: 1 });

// --- Private Message Schema ---
const messageSchema = new mongoose.Schema({
    sender: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: false 
    },
    senderRole: { type: String, enum: ['admin', 'owner', 'student'], required: true },
    senderName: { type: String, required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientRole: String,
    subject: String,
    content: { type: String, required: true },
    attachments: [String],
    isRead: { type: Boolean, default: false },
    readAt: Date,
    isImportant: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// --- Complaint Schema ---
const complaintSchema = new mongoose.Schema({
    complainant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    complainantName: String,
    complainantEmail: String,
    complainantRole: String,
    accused: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    accusedName: String,
    accusedEmail: String,
    accusedRole: String,
    reason: { type: String, required: true },
    details: String,
    status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
    adminResponse: String,
    createdAt: { type: Date, default: Date.now },
    resolvedAt: Date
});

// --- Hostel Schema ---
const hostelSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    location: { type: String, required: true },
    address: String,
    description: String,
    images: [String],
    amenities: [String],
    contactPhone: String,
    createdAt: { type: Date, default: Date.now }
});

// --- Room Schema ---
const roomSchema = new mongoose.Schema({
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    name: { type: String, required: true },
    roomNumber: { type: String },
    floor: { type: Number },
    roomType: { type: String, enum: ['single', 'double', 'triple', 'quad', 'dorm'], default: 'double' },
    pricePerBed: { type: Number, required: true },
    totalBeds: { type: Number, required: true, min: 1 },
    availableBeds: { type: Number, required: true, min: 0 },
    amenities: [String],
    images: [String],
    bedAssignments: [{
        bedNumber: { type: Number },
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        checkInDate: { type: Date },
        status: { type: String, enum: ['occupied', 'reserved', 'vacant'], default: 'vacant' }
    }],
    createdAt: { type: Date, default: Date.now }
});

// --- Occupancy Schema ---
const occupancySchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    bedNumber: { type: Number },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    checkInDate: { type: Date, required: true, default: Date.now },
    checkOutDate: { type: Date },
    expectedCheckOutDate: { type: Date },
    status: { 
        type: String, 
        enum: ['active', 'checked_out', 'evicted', 'transferred'], 
        default: 'active' 
    },
    evictionReason: { type: String },
    depositPaid: { type: Boolean, default: false },
    depositAmount: { type: Number },
    depositRefunded: { type: Boolean, default: false },
    refundDate: { type: Date },
    notes: { type: String },
    createdAt: { type: Date, default: Date.now }
});

// --- Leave Request Schema ---
const leaveRequestSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    occupancy: { type: mongoose.Schema.Types.ObjectId, ref: 'Occupancy', required: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    reason: { type: String, required: true },
    details: { type: String },
    requestedLeaveDate: { type: Date, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'cancelled'], 
        default: 'pending' 
    },
    ownerResponse: { type: String },
    depositRefundRequested: { type: Boolean, default: false },
    depositRefunded: { type: Boolean, default: false },
    refundAmount: { type: Number },
    processedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// --- Maintenance Request Schema ---
const maintenanceSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { 
        type: String, 
        enum: ['plumbing', 'electrical', 'furniture', 'appliance', 'cleaning', 'security', 'other'],
        required: true 
    },
    priority: { 
        type: String, 
        enum: ['low', 'medium', 'high', 'emergency'], 
        default: 'medium' 
    },
    status: { 
        type: String, 
        enum: ['pending', 'in_progress', 'completed', 'cancelled', 'rejected'], 
        default: 'pending' 
    },
    attachments: [String],
    assignedTo: { type: String },
    estimatedCompletion: { type: Date },
    completedAt: { type: Date },
    ownerNotes: { type: String },
    studentFeedback: { 
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String },
        submittedAt: { type: Date }
    },
    createdAt: { type: Date, default: Date.now }
});

// --- Roommate Request Schema ---
const roommateRequestSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { 
        type: String, 
        enum: ['pending', 'accepted', 'rejected', 'cancelled'], 
        default: 'pending' 
    },
    message: { type: String },
    respondedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// --- Roommate Group Schema ---
const roommateGroupSchema = new mongoose.Schema({
    name: { type: String },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// --- Room Transfer Request Schema ---
const transferRequestSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    currentOccupancy: { type: mongoose.Schema.Types.ObjectId, ref: 'Occupancy', required: true },
    currentHostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    currentRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    
    targetHostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel' },
    targetRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    
    transferType: { 
        type: String, 
        enum: ['same_hostel', 'different_hostel'], 
        required: true 
    },
    reason: { type: String, required: true },
    
    status: { 
        type: String, 
        enum: ['pending', 'approved_by_owner', 'approved_by_target_owner', 'rejected', 'completed', 'cancelled'], 
        default: 'pending' 
    },
    
    targetOwnerApproval: { type: Boolean, default: false },
    targetOwnerResponse: { type: String },
    
    currentOwnerApproval: { type: Boolean, default: false },
    currentOwnerResponse: { type: String },
    
    processedAt: { type: Date },
    completedAt: { type: Date },
    
    createdAt: { type: Date, default: Date.now }
});

// --- Payment Schema ---
const paymentSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    occupancy: { type: mongoose.Schema.Types.ObjectId, ref: 'Occupancy' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    
    paymentType: { 
        type: String, 
        enum: ['deposit', 'rent', 'maintenance_fee', 'late_fee', 'other'], 
        required: true 
    },
    
    amount: { type: Number, required: true },
    currency: { type: String, default: 'GHS' },
    
    paymentMethod: { 
        type: String, 
        enum: ['cash', 'mobile_money', 'bank_transfer', 'card', 'other'], 
        required: true 
    },
    
    paymentDate: { type: Date, default: Date.now },
    
    transactionId: { type: String },
    referenceNumber: { type: String },
    
    receiptNumber: { type: String, unique: true },
    
    period: {
        from: { type: Date },
        to: { type: Date }
    },
    
    status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed', 'refunded'], 
        default: 'completed' 
    },
    
    notes: { type: String },
    
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    createdAt: { type: Date, default: Date.now }
});

paymentSchema.pre('save', function(next) {
    if (!this.receiptNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        this.receiptNumber = `RCP-${year}${month}-${random}`;
    }
    next();
});

// --- Booking Schema ---
const bookingSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    moveInDate: { type: Date, required: true },
    duration: { type: String, enum: ['semester', 'academic year', 'monthly'], required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled', 'checked_in'], default: 'pending' },
    
    depositPaid: { type: Boolean, default: false },
    depositAmount: { type: Number },
    depositPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    
    occupancy: { type: mongoose.Schema.Types.ObjectId, ref: 'Occupancy' },
    
    createdAt: { type: Date, default: Date.now }
});

// --- Password Reset Request Schema ---
const resetRequestSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now }
});

// --- Settings Schema ---
const settingsSchema = new mongoose.Schema({
    logoUrl: String,
    contactEmail: String,
    contactPhone: String,
    updatedAt: { type: Date, default: Date.now }
});

// --- Developer Schema ---
const developerSchema = new mongoose.Schema({
    name: { type: String, default: 'Victor Yidana' },
    title: { type: String, default: 'Full Stack Developer & Tech Innovator' },
    bio: { type: String, default: 'Victor Yidana is a passionate software developer and tech enthusiast dedicated to creating seamless digital experiences.' },
    avatarUrl: String,
    email: { type: String, default: 'victor@yidanahostels.com' },
    social: {
        github: { type: String, default: '#' },
        linkedin: { type: String, default: '#' },
        twitter: { type: String, default: '#' },
        dev: { type: String, default: '#' }
    },
    stats: {
        yearsExperience: { type: Number, default: 5 },
        projectsCompleted: { type: Number, default: 20 },
        certifications: { type: Number, default: 10 }
    },
    certifications: [{ type: String }],
    achievements: [{ type: String }],
    updatedAt: { type: Date, default: Date.now }
});

// ==================== AI CONVERSATION MODEL ====================
const conversationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userRole: { type: String, enum: ['student', 'owner', 'admin'] },
    sessionId: { type: String, required: true },
    
    messages: [{
        sender: { type: String, enum: ['user', 'assistant'], required: true },
        message: { type: String, required: true },
        intent: { type: String },
        timestamp: { type: Date, default: Date.now },
        
        feedback: {
            helpful: { type: Boolean },
            comment: { type: String },
            timestamp: { type: Date }
        }
    }],
    
    context: {
        currentPage: { type: String },
        lastAction: { type: String },
        relevantData: mongoose.Schema.Types.Mixed
    },
    
    status: { type: String, enum: ['active', 'resolved', 'escalated'], default: 'active' },
    escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    escalatedAt: { type: Date },
    resolvedAt: { type: Date },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

conversationSchema.index({ user: 1, status: 1 });
conversationSchema.index({ sessionId: 1 });

// ==================== COMPILE MODELS ====================
const User = mongoose.model('User', userSchema);
const Announcement = mongoose.model('Announcement', announcementSchema);
const Message = mongoose.model('Message', messageSchema);
const Complaint = mongoose.model('Complaint', complaintSchema);
const Hostel = mongoose.model('Hostel', hostelSchema);
const Room = mongoose.model('Room', roomSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Occupancy = mongoose.model('Occupancy', occupancySchema);
const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
const Maintenance = mongoose.model('Maintenance', maintenanceSchema);
const RoommateRequest = mongoose.model('RoommateRequest', roommateRequestSchema);
const RoommateGroup = mongoose.model('RoommateGroup', roommateGroupSchema);
const TransferRequest = mongoose.model('TransferRequest', transferRequestSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const ResetRequest = mongoose.model('ResetRequest', resetRequestSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Developer = mongoose.model('Developer', developerSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

// ==================== HELPER FUNCTIONS ====================

function generateCredentials(prefix = 'YID') {
    const id = prefix + crypto.randomBytes(3).toString('hex').toUpperCase();
    const pin = crypto.randomBytes(4).toString('hex').toUpperCase();
    return { id, pin };
}

async function deleteUserAndData(userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = await User.findById(userId);
        if (!user) return false;

        if (user.role === 'owner') {
            const hostels = await Hostel.find({ owner: userId });
            const hostelIds = hostels.map(h => h._id);

            await Room.deleteMany({ hostel: { $in: hostelIds } }, { session });
            await Occupancy.deleteMany({ hostel: { $in: hostelIds } }, { session });
            await Maintenance.deleteMany({ hostel: { $in: hostelIds } }, { session });
            await LeaveRequest.deleteMany({ hostel: { $in: hostelIds } }, { session });
            await TransferRequest.deleteMany({ 
                $or: [
                    { currentHostel: { $in: hostelIds } },
                    { targetHostel: { $in: hostelIds } }
                ]
            }, { session });
            await Payment.deleteMany({ hostel: { $in: hostelIds } }, { session });
            await Hostel.deleteMany({ owner: userId }, { session });
            await Booking.deleteMany({ hostel: { $in: hostelIds } }, { session });
        } else if (user.role === 'student') {
            await Booking.deleteMany({ student: userId }, { session });
            await Occupancy.deleteMany({ student: userId }, { session });
            await LeaveRequest.deleteMany({ student: userId }, { session });
            await Maintenance.deleteMany({ student: userId }, { session });
            await TransferRequest.deleteMany({ student: userId }, { session });
            await Payment.deleteMany({ student: userId }, { session });
            await RoommateRequest.deleteMany({ 
                $or: [{ requester: userId }, { recipient: userId }] 
            }, { session });
            
            // NEW: Delete AI conversations
            await Conversation.deleteMany({ user: userId }, { session });
        }

        await Complaint.deleteMany({ $or: [{ complainant: userId }, { accused: userId }] }, { session });
        await ResetRequest.deleteMany({ user: userId }, { session });
        await Announcement.deleteMany({ $or: [{ sender: userId }, { targetedStudents: userId }] }, { session });
        await Message.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] }, { session });
        await User.findByIdAndDelete(userId, { session });

        await session.commitTransaction();
        return true;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

function generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `RCP-${year}${month}-${random}`;
}

function calculateCompatibility(user1, user2) {
    let score = 0;
    let maxScore = 0;
    
    const prefs1 = user1.roommatePreferences || {};
    const prefs2 = user2.roommatePreferences || {};
    
    maxScore += 3;
    if (prefs1.smoking === prefs2.smoking) score += 3;
    else if (prefs1.smoking === 'indifferent' || prefs2.smoking === 'indifferent') score += 1;
    
    maxScore += 2;
    if (prefs1.pets === prefs2.pets) score += 2;
    else if (prefs1.pets === 'indifferent' || prefs2.pets === 'indifferent') score += 1;
    
    maxScore += 2;
    if (prefs1.studyHabits === prefs2.studyHabits) score += 2;
    else if (prefs1.studyHabits === 'flexible' || prefs2.studyHabits === 'flexible') score += 1;
    
    maxScore += 2;
    if (prefs1.sleepSchedule === prefs2.sleepSchedule) score += 2;
    else if (prefs1.sleepSchedule === 'flexible' || prefs2.sleepSchedule === 'flexible') score += 1;
    
    maxScore += 3;
    const cleanlinessDiff = Math.abs((prefs1.cleanliness || 3) - (prefs2.cleanliness || 3));
    if (cleanlinessDiff <= 1) score += 3;
    else if (cleanlinessDiff <= 2) score += 1;
    
    maxScore += 2;
    const noiseDiff = Math.abs((prefs1.noiseLevel || 3) - (prefs2.noiseLevel || 3));
    if (noiseDiff <= 1) score += 2;
    else if (noiseDiff <= 2) score += 1;
    
    maxScore += 1;
    if (prefs1.budget && prefs2.budget) {
        const budgetDiff = Math.abs(prefs1.budget - prefs2.budget);
        if (budgetDiff <= 100) score += 1;
    } else {
        score += 0.5;
    }
    
    return Math.round((score / maxScore) * 100);
}

async function initializeDeveloperProfile() {
    try {
        const developerExists = await Developer.findOne();
        if (!developerExists) {
            const defaultDeveloper = new Developer({
                name: 'Victor Yidana',
                title: 'Full Stack Developer & Tech Innovator',
                bio: 'Victor Yidana is a passionate software developer and tech enthusiast dedicated to creating seamless digital experiences.',
                stats: {
                    yearsExperience: 5,
                    projectsCompleted: 20,
                    certifications: 10
                },
                certifications: [
                    'Web Development',
                    'Cloud Computing',
                    'Data Management',
                    'Node.js',
                    'MongoDB',
                    'React',
                    'Express.js'
                ],
                achievements: [
                    'Built YIDANA HOSTELS from scratch',
                    'Served 500+ students',
                    'Partnered with 50+ hostels'
                ]
            });
            await defaultDeveloper.save();
            console.log('✅ Default developer profile created');
        }
    } catch (error) {
        console.error('Error creating default developer profile:', error);
    }
}

function calculateExpectedCheckOut(moveInDate, duration) {
    const date = new Date(moveInDate);
    if (duration === 'monthly') {
        date.setMonth(date.getMonth() + 1);
    } else if (duration === 'semester') {
        date.setMonth(date.getMonth() + 4);
    } else if (duration === 'academic year') {
        date.setMonth(date.getMonth() + 9);
    }
    return date;
}

mongoose.connection.once('open', initializeDeveloperProfile);

// ==================== DEEPSEEK AI CLIENT ====================
class DeepSeekClient {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.baseUrl = 'https://api.deepseek.com/v1/chat/completions';
        
        if (!this.apiKey) {
            console.error('❌ DEEPSEEK_API_KEY not found in .env file!');
            console.error('Please add: DEEPSEEK_API_KEY=sk-a2ea71ddab08484a9d95d26c1e382e2e');
        } else {
            console.log('✅ DeepSeek AI client initialized');
        }
    }

    async chat(messages) {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1000,
                    top_p: 0.95,
                    frequency_penalty: 0,
                    presence_penalty: 0
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('DeepSeek API Error Response:', error);
                throw new Error(`API returned ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
            
        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            return "I'm having trouble connecting right now. Please try again in a moment or contact support at 0594433667.";
        }
    }

    buildSystemPrompt(user) {
        return `You are Yidana, the helpful AI assistant for YIDANA HOSTELS platform.

CURRENT USER:
- Name: ${user.name}
- Role: ${user.role}
- Email: ${user.email}

YOUR CAPABILITIES:
1. Answer questions about hostel bookings, payments, maintenance
2. Guide users through processes (booking, leave requests, transfers)
3. Explain roommate matching features
4. Help with account issues (PIN reset, login)
5. Provide information about hostels and amenities

RESPONSE GUIDELINES:
- Be friendly and professional
- Use the user's name
- Give specific, actionable answers
- If unsure, suggest contacting admin at 0594433667
- Keep responses concise but helpful

PLATFORM CONTEXT:
YIDANA HOSTELS helps students find and manage hostel accommodations in Ghana. Students can book rooms, make payments, submit maintenance requests, find roommates, and more.`;
    }
}

const deepseekClient = new DeepSeekClient();

// ==================== SCHEDULED TASKS ====================

cron.schedule('0 * * * *', async () => {
    try {
        const now = new Date();
        const result = await Announcement.deleteMany({ 
            expiresAt: { $lte: now } 
        });
        if (result.deletedCount > 0) {
            console.log(`🗑️ Deleted ${result.deletedCount} expired announcements`);
        }
    } catch (error) {
        console.error('Error deleting expired announcements:', error);
    }
});

cron.schedule('0 0 * * *', async () => {
    try {
        console.log('🔔 Running daily payment reminder check...');
        
        const occupancies = await Occupancy.find({ 
            status: 'active',
            expectedCheckOutDate: { $gt: new Date() }
        }).populate('student').populate('hostel');
        
        for (const occ of occupancies) {
            const lastPayment = await Payment.findOne({
                student: occ.student._id,
                paymentType: 'rent',
                status: 'completed'
            }).sort('-paymentDate');
            
            if (!lastPayment || 
                (new Date() - lastPayment.paymentDate) > 30 * 24 * 60 * 60 * 1000) {
                
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: occ.student.email,
                    subject: '🔔 Rent Payment Reminder',
                    html: `
                        <h2>Payment Reminder</h2>
                        <p>Dear ${occ.student.name},</p>
                        <p>This is a reminder that your rent payment for ${occ.hostel.name} is due.</p>
                        <p>Please log in to your account to make a payment or contact your hostel owner.</p>
                    `
                };
                transporter.sendMail(mailOptions, (err) => { 
                    if (err) console.log('Payment reminder email error:', err); 
                });
                
                console.log(`📧 Sent payment reminder to ${occ.student.email}`);
            }
        }
    } catch (error) {
        console.error('Error in payment reminder cron job:', error);
    }
});

// ==================== MIDDLEWARE ====================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access token required' });

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

// ==================== AI ASSISTANT ROUTES ====================

// Start or continue AI conversation
app.post('/api/ai/chat', authenticateToken, async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        let conversation = await Conversation.findOne({
            user: user._id,
            sessionId: sessionId || 'default',
            status: 'active'
        });
        
        if (!conversation) {
            conversation = new Conversation({
                user: user._id,
                userRole: user.role,
                sessionId: sessionId || `session_${Date.now()}`,
                messages: []
            });
        }
        
        conversation.messages.push({
            sender: 'user',
            message: message,
            timestamp: new Date()
        });
        
        const systemPrompt = deepseekClient.buildSystemPrompt(user);
        
        const recentMessages = conversation.messages.slice(-10).map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.message
        }));
        
        const aiMessages = [
            { role: 'system', content: systemPrompt },
            ...recentMessages
        ];
        
        const aiResponse = await deepseekClient.chat(aiMessages);
        
        conversation.messages.push({
            sender: 'assistant',
            message: aiResponse,
            timestamp: new Date()
        });
        
        conversation.updatedAt = new Date();
        await conversation.save();
        
        res.json({
            success: true,
            message: aiResponse,
            sessionId: conversation.sessionId,
            conversationId: conversation._id
        });
        
    } catch (error) {
        console.error('AI Chat Error:', error);
        res.status(500).json({
            success: false,
            message: 'AI service unavailable. Please try again or contact support at 0594433667.'
        });
    }
});

// Get conversation history
app.get('/api/ai/conversations', authenticateToken, async (req, res) => {
    try {
        const conversations = await Conversation.find({
            user: req.user.id
        })
        .sort('-updatedAt')
        .limit(10)
        .select('sessionId messages createdAt updatedAt');
        
        res.json(conversations);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Provide feedback on AI response
app.post('/api/ai/feedback/:messageId', authenticateToken, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { helpful, comment } = req.body;
        
        const conversation = await Conversation.findOne({
            'user': req.user.id,
            'messages._id': messageId
        });
        
        if (conversation) {
            const message = conversation.messages.id(messageId);
            if (message) {
                message.feedback = {
                    helpful: helpful === 'true',
                    comment: comment,
                    timestamp: new Date()
                };
                await conversation.save();
                return res.json({ success: true, message: 'Feedback recorded' });
            }
        }
        
        res.status(404).json({ message: 'Message not found' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Delete conversation
app.delete('/api/ai/conversations/:conversationId', authenticateToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const conversation = await Conversation.findOne({
            _id: conversationId,
            user: req.user.id
        });
        
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }
        
        await Conversation.findByIdAndDelete(conversationId);
        
        res.json({ success: true, message: 'Conversation deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== EXISTING API ROUTES ====================
// (All your existing routes remain exactly as they were - I'm keeping them all)

// --------------- 1. ADMIN AUTH & MANAGEMENT ---------------
app.post('/api/admin/login', (req, res) => {
    const { id, pin } = req.body;
    if (id === 'YIDA1844@' && pin === 'y19760594*') {
        const token = jwt.sign(
            { id, isAdmin: true, role: 'admin' },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        return res.json({ success: true, message: 'Admin login successful', token });
    }
    res.status(401).json({ success: false, message: 'Invalid admin credentials' });
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find().sort('-createdAt');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/users/role/:role', async (req, res) => {
    try {
        const { role } = req.params;
        const users = await User.find({ role }).sort('-createdAt');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/admin/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        await deleteUserAndData(userId);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'YIDANA HOSTELS - Account Deleted',
            html: `<h2>Account Deletion Notification</h2><p>Dear ${user.name},</p><p>Your YIDANA HOSTELS account has been deleted by the administrator.</p><p>Contact: ${process.env.ADMIN_EMAIL} or 0594433667</p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Deletion email error:', err); });

        res.json({ success: true, message: `User ${user.name} (${user.role}) deleted successfully.` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------- 2. PUBLIC REGISTRATION & LOGIN ---------------
app.post('/api/students/register', async (req, res) => {
    try {
        const { name, email, mobile } = req.body;
        console.log('Student registration:', { name, email, mobile });

        if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'Email already registered' });
        if (await User.findOne({ mobile })) return res.status(400).json({ success: false, message: 'Mobile number already registered' });

        const { id: userId, pin: userPin } = generateCredentials('STU');
        const newUser = new User({ name, email, mobile, userId, userPin, role: 'student', phone: mobile });
        await newUser.save();

        const token = jwt.sign({ userId, id: newUser._id, role: 'student' }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Welcome to YIDANA HOSTELS!',
            html: `<h2>Hello ${name}</h2><p>Your student account is ready.</p><p><strong>User ID:</strong> ${userId}</p><p><strong>PIN:</strong> ${userPin}</p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Email error:', err); });

        res.status(201).json({ success: true, message: 'Registration successful. Check your email.', token, user: { id: newUser._id, name, email, userId, role: 'student' } });
    } catch (err) {
        console.error('Student registration error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

app.post('/api/owners/register', async (req, res) => {
    try {
        const { name, email, mobile } = req.body;
        console.log('Owner registration:', { name, email, mobile });

        if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'Email already registered' });
        if (await User.findOne({ mobile })) return res.status(400).json({ success: false, message: 'Mobile number already registered' });

        const newOwner = new User({ name, email, mobile, phone: mobile, role: 'owner', isApproved: false });
        await newOwner.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: 'New Owner Pending Approval',
            html: `<h2>New Owner Registration</h2><p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Mobile:</strong> ${mobile}</p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Admin email error:', err); });

        res.status(201).json({ success: true, message: 'Registration submitted. Await admin approval.' });
    } catch (err) {
        console.error('Owner registration error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { userId, userPin } = req.body;
        const user = await User.findOne({ userId, userPin, status: 'active' });

        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
        if (user.role === 'owner' && !user.isApproved) return res.status(403).json({ success: false, message: 'Owner account not yet approved' });

        const token = jwt.sign({ userId, id: user._id, role: user.role }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role, isApproved: user.isApproved, status: user.status } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --------------- 3. PASSWORD RESET FLOW ---------------
app.post('/api/users/request-reset', async (req, res) => {
    try {
        const { email, mobile } = req.body;
        const user = await User.findOne({ email, mobile });
        if (!user) return res.status(404).json({ message: 'No user found with that email and phone' });

        const existing = await ResetRequest.findOne({ user: user._id, status: 'pending' });
        if (existing) return res.status(400).json({ message: 'Reset request already pending' });

        const request = new ResetRequest({ user: user._id, email, mobile });
        await request.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: 'New Password Reset Request',
            html: `<h2>Password Reset Request</h2><p><strong>User:</strong> ${user.name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Mobile:</strong> ${mobile}</p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Admin email error:', err); });

        res.json({ success: true, message: 'Reset request submitted. Admin will review.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/reset-requests', async (req, res) => {
    try {
        const requests = await ResetRequest.find({ status: 'pending' }).populate('user', 'name email role');
        res.json(requests);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/reset-requests/:requestId/approve', async (req, res) => {
    try {
        const request = await ResetRequest.findById(req.params.requestId).populate('user');
        if (!request) return res.status(404).json({ message: 'Request not found' });

        const newPin = crypto.randomBytes(4).toString('hex').toUpperCase();
        request.user.userPin = newPin;
        await request.user.save();

        request.status = 'approved';
        await request.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: request.user.email,
            subject: 'Password Reset Approved',
            html: `<p>Your new PIN is: <strong>${newPin}</strong></p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Reset email error:', err); });

        res.json({ success: true, message: 'Password reset approved and new PIN sent.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/reset-requests/:requestId/reject', async (req, res) => {
    try {
        await ResetRequest.findByIdAndUpdate(req.params.requestId, { status: 'rejected' });
        res.json({ success: true, message: 'Request rejected.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------- 4. OWNER MANAGEMENT (Admin) ---------------
app.get('/api/admin/pending-owners', async (req, res) => {
    try {
        const owners = await User.find({ role: 'owner', isApproved: false });
        res.json(owners);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/owners', async (req, res) => {
    try {
        const owners = await User.find({ role: 'owner' });
        res.json(owners);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/owners/:ownerId/approve', async (req, res) => {
    try {
        const owner = await User.findById(req.params.ownerId);
        if (!owner || owner.role !== 'owner') return res.status(404).json({ message: 'Owner not found' });

        const { action, message: adminMsg } = req.body;

        if (action === 'approve') {
            const { id: userId, pin: userPin } = generateCredentials('OWN');
            owner.userId = userId;
            owner.userPin = userPin;
            owner.isApproved = true;
            await owner.save();

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: owner.email,
                subject: 'Owner Account Approved',
                html: `<h2>Congratulations!</h2><p>Your owner account is approved.</p><p><strong>User ID:</strong> ${userId}</p><p><strong>PIN:</strong> ${userPin}</p>`
            };
            transporter.sendMail(mailOptions, err => { if (err) console.log('Approval email error:', err); });

            res.json({ success: true, message: 'Owner approved and credentials sent.' });
        } else if (action === 'reject') {
            await User.findByIdAndDelete(req.params.ownerId);
            res.json({ success: true, message: 'Owner rejected.' });
        } else {
            res.status(400).json({ message: 'Invalid action' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/owners/:ownerId/suspend', async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.ownerId, { status: 'suspended' });
        res.json({ success: true, message: 'Owner suspended' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/owners/:ownerId/unsuspend', async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.ownerId, { status: 'active' });
        res.json({ success: true, message: 'Owner unsuspended' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/admin/owners/:ownerId', async (req, res) => {
    try {
        await deleteUserAndData(req.params.ownerId);
        res.json({ success: true, message: 'Owner deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------- 5. COMPLAINT SYSTEM ---------------
app.post('/api/complaints', authenticateToken, async (req, res) => {
    try {
        const { accusedId, reason, details } = req.body;
        const complainant = await User.findById(req.user.id);
        const accused = await User.findById(accusedId);
        if (!complainant || !accused) return res.status(404).json({ message: 'User not found' });
        if (complainant._id.toString() === accused._id.toString()) return res.status(400).json({ message: 'Cannot complain about yourself' });

        const complaint = new Complaint({
            complainant: complainant._id, complainantName: complainant.name, complainantEmail: complainant.email, complainantRole: complainant.role,
            accused: accused._id, accusedName: accused.name, accusedEmail: accused.email, accusedRole: accused.role,
            reason, details, status: 'pending'
        });
        await complaint.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: 'New Complaint Filed',
            html: `<h2>New Complaint</h2><p><strong>From:</strong> ${complainant.name}</p><p><strong>Against:</strong> ${accused.name}</p><p><strong>Reason:</strong> ${reason}</p>`
        };
        transporter.sendMail(mailOptions, (err) => { if (err) console.log('Admin email error:', err); });

        res.status(201).json({ success: true, message: 'Complaint filed.', complaint });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/user/complaints', authenticateToken, async (req, res) => {
    try {
        const complaints = await Complaint.find({ $or: [{ complainant: req.user.id }, { accused: req.user.id }] }).sort('-createdAt');
        res.json(complaints);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/complaints', async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status;
        const complaints = await Complaint.find(query).populate('complainant', 'name email').populate('accused', 'name email').sort('-createdAt');
        res.json(complaints);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/complaints/:complaintId', async (req, res) => {
    try {
        const { action, adminResponse } = req.body;
        const complaint = await Complaint.findById(req.params.complaintId).populate('complainant').populate('accused');
        if (!complaint) return res.status(404).json({ message: 'Complaint not found' });

        if (action === 'resolve') {
            complaint.status = 'resolved';
        } else if (action === 'dismiss') {
            complaint.status = 'dismissed';
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }
        complaint.adminResponse = adminResponse || `Complaint ${action}d`;
        complaint.resolvedAt = new Date();
        await complaint.save();

        const parties = [
            { email: complaint.complainant.email, name: complaint.complainant.name },
            { email: complaint.accused.email, name: complaint.accused.name }
        ];
        parties.forEach(party => {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: party.email,
                subject: `Complaint ${complaint.status}`,
                html: `<p>Dear ${party.name},</p><p>A complaint has been ${complaint.status}.</p><p><strong>Admin Response:</strong> ${complaint.adminResponse}</p>`
            };
            transporter.sendMail(mailOptions, (err) => { if (err) console.log('Email error:', err); });
        });

        res.json({ success: true, message: `Complaint ${action}d.` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/admin/complaints/:complaintId', async (req, res) => {
    try {
        await Complaint.findByIdAndDelete(req.params.complaintId);
        res.json({ success: true, message: 'Complaint deleted.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------- 6. ANNOUNCEMENT SYSTEM ---------------
app.post('/api/admin/announcements', authenticateToken, upload.array('attachments', 5), async (req, res) => {
    try {
        const { title, content, targetAudience, scheduledFor, expiresAt, isImportant, targetedStudents } = req.body;
        
        const expiryDate = new Date(expiresAt);
        if (expiryDate <= new Date()) {
            return res.status(400).json({ message: 'Expiration date must be in the future' });
        }

        const announcement = new Announcement({
            title,
            content,
            sender: req.user.isAdmin ? null : req.user.id,
            senderRole: 'admin',
            senderName: 'System Administrator',
            targetAudience,
            scheduledFor: scheduledFor || new Date(),
            expiresAt: expiryDate,
            isImportant: isImportant === 'true',
            attachments: req.files ? req.files.map(f => `/uploads/${f.filename}`) : []
        });

        if (targetAudience === 'specific_students' && targetedStudents) {
            const studentIds = targetedStudents.split(',').map(id => id.trim());
            announcement.targetedStudents = studentIds;
        }

        await announcement.save();

        let recipients = [];
        if (targetAudience === 'everyone') {
            recipients = await User.find({ status: 'active' }).select('email name');
        } else if (targetAudience === 'students') {
            recipients = await User.find({ role: 'student', status: 'active' }).select('email name');
        } else if (targetAudience === 'owners') {
            recipients = await User.find({ role: 'owner', isApproved: true, status: 'active' }).select('email name');
        } else if (targetAudience === 'specific_students' && announcement.targetedStudents.length) {
            recipients = await User.find({ 
                _id: { $in: announcement.targetedStudents },
                status: 'active' 
            }).select('email name');
        }

        recipients.forEach(recipient => {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: recipient.email,
                subject: `📢 ANNOUNCEMENT: ${title}`,
                html: `
                    <h2>${title}</h2>
                    <p><strong>From:</strong> System Administrator</p>
                    <p><strong>${isImportant === 'true' ? '🔴 IMPORTANT' : '📢 Announcement'}</strong></p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                        ${content}
                    </div>
                    <p><small>This announcement will expire on ${new Date(expiresAt).toLocaleString()}</small></p>
                    <p>Login to your YIDANA HOSTELS account to view more details.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Announcement email error:', err); 
            });
        });

        res.status(201).json({ 
            success: true, 
            message: `Announcement created and scheduled for ${new Date(scheduledFor).toLocaleString()}`,
            announcement 
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/owner/announcements', authenticateToken, upload.array('attachments', 5), async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Owners only' });

    try {
        const { title, content, targetAudience, hostelId, scheduledFor, expiresAt, isImportant, targetedStudents } = req.body;
        
        if (targetAudience === 'specific_hostel' && hostelId) {
            const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
            if (!hostel) {
                return res.status(403).json({ message: 'You do not own this hostel' });
            }
        }

        const expiryDate = new Date(expiresAt);
        if (expiryDate <= new Date()) {
            return res.status(400).json({ message: 'Expiration date must be in the future' });
        }

        const owner = await User.findById(req.user.id);
        const announcement = new Announcement({
            title,
            content,
            sender: req.user.id,
            senderRole: 'owner',
            senderName: owner.name,
            targetAudience,
            hostel: hostelId,
            scheduledFor: scheduledFor || new Date(),
            expiresAt: expiryDate,
            isImportant: isImportant === 'true',
            attachments: req.files ? req.files.map(f => `/uploads/${f.filename}`) : []
        });

        if (targetAudience === 'specific_students' && targetedStudents) {
            const studentIds = targetedStudents.split(',').map(id => id.trim());
            announcement.targetedStudents = studentIds;
        }

        await announcement.save();

        let recipients = [];
        if (targetAudience === 'specific_hostel' && hostelId) {
            const occupancies = await Occupancy.find({ 
                hostel: hostelId,
                status: 'active'
            }).populate('student');
            
            recipients = occupancies.map(o => ({
                email: o.student.email,
                name: o.student.name
            }));
        } else if (targetAudience === 'specific_students' && announcement.targetedStudents.length) {
            recipients = await User.find({ 
                _id: { $in: announcement.targetedStudents },
                status: 'active' 
            }).select('email name');
        }

        recipients.forEach(recipient => {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: recipient.email,
                subject: `🏠 Hostel Announcement: ${title}`,
                html: `
                    <h2>${title}</h2>
                    <p><strong>From:</strong> ${owner.name} (Hostel Owner)</p>
                    <p><strong>${isImportant === 'true' ? '🔴 IMPORTANT' : '📢 Announcement'}</strong></p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                        ${content}
                    </div>
                    <p><small>This announcement will expire on ${new Date(expiresAt).toLocaleString()}</small></p>
                    <p>Login to your YIDANA HOSTELS account to view more details.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Owner announcement email error:', err); 
            });
        });

        res.status(201).json({ 
            success: true, 
            message: `Announcement created successfully`,
            announcement 
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/announcements', authenticateToken, async (req, res) => {
    try {
        const now = new Date();
        const user = await User.findById(req.user.id);
        
        const query = {
            scheduledFor: { $lte: now },
            expiresAt: { $gt: now },
            isActive: true
        };

        if (user.role === 'student') {
            query.$or = [
                { targetAudience: 'everyone' },
                { targetAudience: 'students' },
                { targetedStudents: user._id }
            ];

            const studentOccupancy = await Occupancy.findOne({ 
                student: user._id,
                status: 'active'
            }).select('hostel');
            
            if (studentOccupancy) {
                query.$or.push({
                    targetAudience: 'specific_hostel',
                    hostel: studentOccupancy.hostel
                });
            }
        } else if (user.role === 'owner') {
            query.$or = [
                { targetAudience: 'everyone' },
                { targetAudience: 'owners' }
            ];

            const ownerHostels = await Hostel.find({ owner: user._id }).select('_id');
            if (ownerHostels.length > 0) {
                query.$or.push({
                    targetAudience: 'specific_hostel',
                    hostel: { $in: ownerHostels.map(h => h._id) }
                });
            }
        }

        const announcements = await Announcement.find(query)
            .populate('sender', 'name')
            .populate('hostel', 'name')
            .sort('-isImportant -createdAt');

        const updatePromises = announcements.map(async (ann) => {
            if (!ann.isRead.includes(user._id)) {
                ann.isRead.push(user._id);
                await ann.save();
            }
        });
        await Promise.all(updatePromises);

        res.json(announcements);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/announcements', async (req, res) => {
    try {
        const { status, targetAudience } = req.query;
        const now = new Date();
        
        let query = {};
        
        if (status === 'active') {
            query.expiresAt = { $gt: now };
        } else if (status === 'expired') {
            query.expiresAt = { $lte: now };
        }
        
        if (targetAudience) {
            query.targetAudience = targetAudience;
        }

        const announcements = await Announcement.find(query)
            .populate('sender', 'name')
            .populate('hostel', 'name')
            .populate('targetedStudents', 'name email')
            .sort('-createdAt');

        res.json(announcements);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/announcements', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Owners only' });

    try {
        const announcements = await Announcement.find({
            sender: req.user.id,
            senderRole: 'owner'
        })
        .populate('hostel', 'name')
        .populate('targetedStudents', 'name email')
        .sort('-createdAt');

        res.json(announcements);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/announcements/:announcementId', authenticateToken, async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.announcementId);
        
        if (!announcement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        const isAdmin = req.user.isAdmin;
        const isOwner = announcement.senderRole === 'owner' && 
                        announcement.sender && announcement.sender.toString() === req.user.id;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'Not authorized to delete this announcement' });
        }

        await Announcement.findByIdAndDelete(req.params.announcementId);
        res.json({ success: true, message: 'Announcement deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------- 7. PRIVATE MESSAGING SYSTEM ---------------
app.post('/api/messages', authenticateToken, upload.array('attachments', 3), async (req, res) => {
    try {
        const { recipientId, subject, content } = req.body;
        
        const recipient = await User.findById(recipientId);
        if (!recipient) {
            return res.status(404).json({ message: 'Recipient not found' });
        }

        let senderName = 'System Administrator';
        let senderRole = 'admin';
        let senderId = null;

        if (!req.user.isAdmin) {
            const sender = await User.findById(req.user.id);
            if (sender) {
                senderName = sender.name;
                senderRole = sender.role;
                senderId = sender._id;
            }
        }
        
        const message = new Message({
            sender: senderId,
            senderRole: senderRole,
            senderName: senderName,
            recipient: recipientId,
            recipientRole: recipient.role,
            subject,
            content,
            attachments: req.files ? req.files.map(f => `/uploads/${f.filename}`) : []
        });

        await message.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: recipient.email,
            subject: `💬 New Message from ${senderName}`,
            html: `
                <h3>You have a new message from ${senderName}</h3>
                ${subject ? `<p><strong>Subject:</strong> ${subject}</p>` : ''}
                <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                    ${content}
                </div>
                <p>Login to your YIDANA HOSTELS account to reply.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Message email error:', err); 
        });

        res.status(201).json({ success: true, message: 'Message sent', messageData: message });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/messages/inbox', authenticateToken, async (req, res) => {
    try {
        let query = { recipient: req.user.id };
        
        const messages = await Message.find(query)
            .populate('sender', 'name email role')
            .sort('-createdAt');
        
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/messages/sent', authenticateToken, async (req, res) => {
    try {
        let query = {};
        
        if (req.user.isAdmin) {
            query.sender = null;
        } else {
            query.sender = req.user.id;
        }
        
        const messages = await Message.find(query)
            .populate('recipient', 'name email role')
            .sort('-createdAt');
        
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/messages/:messageId/read', authenticateToken, async (req, res) => {
    try {
        const message = await Message.findOneAndUpdate(
            { _id: req.params.messageId, recipient: req.user.id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );
        
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        res.json({ success: true, message: 'Marked as read' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);
        
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const isAdmin = req.user.isAdmin;
        const isSender = message.sender && message.sender.toString() === req.user.id;
        const isRecipient = message.recipient.toString() === req.user.id;

        if (!isAdmin && !isSender && !isRecipient) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        await Message.findByIdAndDelete(req.params.messageId);
        res.json({ success: true, message: 'Message deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/messages', async (req, res) => {
    try {
        const messages = await Message.find()
            .populate('sender', 'name email role')
            .populate('recipient', 'name email role')
            .sort('-createdAt')
            .limit(100);
        
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==================== HOSTEL & ROOM MANAGEMENT (Owner) ====================
app.post('/api/owner/hostels', authenticateToken, upload.array('images', 10), async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        console.log('Creating hostel for owner:', req.user.id);
        console.log('Request body:', req.body);
        console.log('Files received:', req.files ? req.files.length : 0);
        
        const { name, location, address, description, contactPhone, amenities } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Hostel name is required' });
        }
        
        if (!location || !location.trim()) {
            return res.status(400).json({ message: 'Hostel location is required' });
        }
        
        const imageUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
        
        const hostelData = {
            owner: req.user.id,
            name: name.trim(),
            location: location.trim(),
            address: address ? address.trim() : '',
            description: description ? description.trim() : '',
            contactPhone: contactPhone ? contactPhone.trim() : '',
            amenities: amenities ? amenities.split(',').map(a => a.trim()).filter(a => a) : [],
            images: imageUrls
        };
        
        console.log('Creating hostel with data:', hostelData);
        
        const hostel = new Hostel(hostelData);
        await hostel.save();
        
        console.log('Hostel created successfully:', hostel._id);
        
        res.status(201).json({ 
            success: true, 
            message: 'Hostel created successfully',
            hostel 
        });
    } catch (err) {
        console.error('Error creating hostel:', err);
        res.status(400).json({ message: err.message });
    }
});

app.put('/api/owner/hostels/:hostelId', authenticateToken, upload.array('images', 10), async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        const { name, location, address, description, contactPhone, amenities } = req.body;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        if (name) hostel.name = name.trim();
        if (location) hostel.location = location.trim();
        if (address !== undefined) hostel.address = address.trim();
        if (description !== undefined) hostel.description = description.trim();
        if (contactPhone !== undefined) hostel.contactPhone = contactPhone.trim();
        if (amenities) {
            hostel.amenities = amenities.split(',').map(a => a.trim()).filter(a => a);
        }
        
        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(f => `/uploads/${f.filename}`);
            hostel.images = [...(hostel.images || []), ...newImages];
        }
        
        await hostel.save();
        
        res.json({ 
            success: true, 
            message: 'Hostel updated successfully',
            hostel 
        });
    } catch (err) {
        console.error('Error updating hostel:', err);
        res.status(400).json({ message: err.message });
    }
});

app.get('/api/owner/hostels', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const hostels = await Hostel.find({ owner: req.user.id })
            .sort('-createdAt');
        res.json(hostels);
    } catch (err) {
        console.error('Error fetching hostels:', err);
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/owner/hostels/:hostelId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        await Room.deleteMany({ hostel: hostelId });
        await Hostel.findByIdAndDelete(hostelId);
        
        res.json({ 
            success: true, 
            message: 'Hostel and rooms deleted successfully' 
        });
    } catch (err) {
        console.error('Error deleting hostel:', err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/owner/hostels/:hostelId/rooms', authenticateToken, upload.array('images', 5), async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        const { name, roomNumber, floor, roomType, pricePerBed, totalBeds, amenities } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Room name is required' });
        }
        if (!pricePerBed) {
            return res.status(400).json({ message: 'Price per bed is required' });
        }
        if (!totalBeds) {
            return res.status(400).json({ message: 'Total beds is required' });
        }
        
        const totalBedsNum = parseInt(totalBeds);
        const imageUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
        
        const bedAssignments = [];
        for (let i = 1; i <= totalBedsNum; i++) {
            bedAssignments.push({
                bedNumber: i,
                student: null,
                checkInDate: null,
                status: 'vacant'
            });
        }
        
        const room = new Room({
            hostel: hostelId,
            name: name.trim(),
            roomNumber: roomNumber || '',
            floor: floor ? parseInt(floor) : null,
            roomType: roomType || 'double',
            pricePerBed: parseFloat(pricePerBed),
            totalBeds: totalBedsNum,
            availableBeds: totalBedsNum,
            bedAssignments: bedAssignments,
            amenities: amenities ? amenities.split(',').map(a => a.trim()).filter(a => a) : [],
            images: imageUrls
        });
        
        await room.save();
        
        res.status(201).json({ 
            success: true, 
            message: 'Room created successfully',
            room 
        });
    } catch (err) {
        console.error('Error creating room:', err);
        res.status(400).json({ message: err.message });
    }
});

app.get('/api/owner/hostels/:hostelId/rooms', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        const rooms = await Room.find({ hostel: hostelId }).populate('bedAssignments.student', 'name email mobile');
        res.json(rooms);
    } catch (err) {
        console.error('Error fetching rooms:', err);
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/owner/rooms/:roomId', authenticateToken, upload.array('images', 5), async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { roomId } = req.params;
        const { name, roomNumber, floor, roomType, pricePerBed, totalBeds, amenities } = req.body;
        
        const room = await Room.findById(roomId).populate('hostel');
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        
        if (room.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        
        if (totalBeds && parseInt(totalBeds) < room.totalBeds) {
            const occupiedBeds = room.bedAssignments.filter(b => b.status === 'occupied').length;
            if (parseInt(totalBeds) < occupiedBeds) {
                return res.status(400).json({ 
                    message: `Cannot reduce total beds below currently occupied beds (${occupiedBeds})` 
                });
            }
        }
        
        if (name) room.name = name.trim();
        if (roomNumber !== undefined) room.roomNumber = roomNumber;
        if (floor) room.floor = parseInt(floor);
        if (roomType) room.roomType = roomType;
        if (pricePerBed) room.pricePerBed = parseFloat(pricePerBed);
        
        if (totalBeds) {
            const newTotal = parseInt(totalBeds);
            const currentAssignments = room.bedAssignments || [];
            const occupiedCount = currentAssignments.filter(b => b.status === 'occupied').length;
            
            if (newTotal > room.totalBeds) {
                for (let i = room.totalBeds + 1; i <= newTotal; i++) {
                    currentAssignments.push({
                        bedNumber: i,
                        student: null,
                        checkInDate: null,
                        status: 'vacant'
                    });
                }
            } else if (newTotal < room.totalBeds) {
                const newAssignments = currentAssignments.slice(0, newTotal);
                room.bedAssignments = newAssignments;
            }
            
            room.totalBeds = newTotal;
            room.availableBeds = room.bedAssignments.filter(b => b.status === 'vacant').length;
        }
        
        if (amenities) {
            room.amenities = amenities.split(',').map(a => a.trim()).filter(a => a);
        }
        
        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(f => `/uploads/${f.filename}`);
            room.images = [...(room.images || []), ...newImages];
        }
        
        await room.save();
        
        res.json({ 
            success: true, 
            message: 'Room updated successfully',
            room 
        });
    } catch (err) {
        console.error('Error updating room:', err);
        res.status(400).json({ message: err.message });
    }
});

app.delete('/api/owner/rooms/:roomId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { roomId } = req.params;
        
        const room = await Room.findById(roomId).populate('hostel');
        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }
        
        if (room.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        
        const occupiedBeds = room.bedAssignments.filter(b => b.status === 'occupied').length;
        if (occupiedBeds > 0) {
            return res.status(400).json({ 
                message: `Cannot delete room with ${occupiedBeds} active residents. Please evict them first.` 
            });
        }
        
        await Room.findByIdAndDelete(roomId);
        
        res.json({ 
            success: true, 
            message: 'Room deleted successfully' 
        });
    } catch (err) {
        console.error('Error deleting room:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 8. STREAMLINED RESIDENT MANAGEMENT ====================
app.get('/api/owner/occupancies', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const hostelIds = hostels.map(h => h._id);
        
        const occupancies = await Occupancy.find({ 
            hostel: { $in: hostelIds },
            status: 'active'
        })
        .populate('student', 'name email mobile profilePicture')
        .populate('hostel', 'name location')
        .populate('room', 'name roomNumber')
        .sort('-checkInDate');
        
        res.json(occupancies);
    } catch (err) {
        console.error('Error fetching occupancies:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/hostels/:hostelId/occupancies', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        const occupancies = await Occupancy.find({ 
            hostel: hostelId,
            status: 'active'
        })
        .populate('student', 'name email mobile profilePicture')
        .populate('room', 'name roomNumber')
        .sort('-checkInDate');
        
        res.json(occupancies);
    } catch (err) {
        console.error('Error fetching occupancies:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/hostels/:hostelId/residents-by-room', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { hostelId } = req.params;
        
        const hostel = await Hostel.findOne({ _id: hostelId, owner: req.user.id });
        if (!hostel) {
            return res.status(404).json({ message: 'Hostel not found' });
        }
        
        const rooms = await Room.find({ hostel: hostelId })
            .populate('bedAssignments.student', 'name email mobile profilePicture');
        
        const result = rooms.map(room => ({
            roomId: room._id,
            roomName: room.name,
            roomNumber: room.roomNumber,
            totalBeds: room.totalBeds,
            occupiedBeds: room.bedAssignments.filter(b => b.status === 'occupied').length,
            availableBeds: room.availableBeds,
            residents: room.bedAssignments
                .filter(b => b.status === 'occupied' && b.student)
                .map(b => ({
                    bedNumber: b.bedNumber,
                    student: b.student,
                    checkInDate: b.checkInDate
                }))
        }));
        
        res.json(result);
    } catch (err) {
        console.error('Error fetching residents by room:', err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/owner/evict', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { occupancyId, reason, refundDeposit } = req.body;
        
        const occupancy = await Occupancy.findById(occupancyId)
            .populate('student')
            .populate('hostel')
            .populate('room');
        
        if (!occupancy) {
            return res.status(404).json({ message: 'Occupancy not found' });
        }
        
        if (occupancy.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not your hostel' });
        }
        
        occupancy.status = 'evicted';
        occupancy.checkOutDate = new Date();
        occupancy.evictionReason = reason;
        
        if (refundDeposit === 'true' && occupancy.depositPaid) {
            occupancy.depositRefunded = true;
            occupancy.refundDate = new Date();
            
            const refundPayment = new Payment({
                student: occupancy.student._id,
                occupancy: occupancy._id,
                hostel: occupancy.hostel._id,
                paymentType: 'other',
                amount: -occupancy.depositAmount,
                paymentMethod: 'cash',
                status: 'refunded',
                notes: `Deposit refund for eviction: ${reason}`
            });
            await refundPayment.save();
        }
        
        await occupancy.save();
        
        const room = await Room.findById(occupancy.room._id);
        const bedIndex = room.bedAssignments.findIndex(
            b => b.student && b.student.toString() === occupancy.student._id.toString()
        );
        
        if (bedIndex !== -1) {
            room.bedAssignments[bedIndex].student = null;
            room.bedAssignments[bedIndex].checkInDate = null;
            room.bedAssignments[bedIndex].status = 'vacant';
            room.availableBeds += 1;
            await room.save();
        }
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: occupancy.student.email,
            subject: '⚠️ Eviction Notice',
            html: `
                <h2>Important Notice</h2>
                <p>Dear ${occupancy.student.name},</p>
                <p>You have been evicted from ${occupancy.hostel.name}.</p>
                <p><strong>Reason:</strong> ${reason}</p>
                ${refundDeposit === 'true' ? '<p>Your deposit has been refunded.</p>' : ''}
                <p>Please contact the hostel owner for more information.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Eviction email error:', err); 
        });
        
        res.json({ 
            success: true, 
            message: 'Student evicted successfully',
            occupancy
        });
        
    } catch (err) {
        console.error('Eviction error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 9. STUDENT LEAVE SYSTEM ====================
app.post('/api/student/leave-request', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { reason, details, requestedLeaveDate, depositRefundRequested } = req.body;
        
        const occupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        if (!occupancy) {
            return res.status(404).json({ message: 'No active occupancy found' });
        }
        
        const existingRequest = await LeaveRequest.findOne({
            student: req.user.id,
            status: 'pending'
        });
        
        if (existingRequest) {
            return res.status(400).json({ message: 'You already have a pending leave request' });
        }
        
        const leaveRequest = new LeaveRequest({
            student: req.user.id,
            occupancy: occupancy._id,
            hostel: occupancy.hostel._id,
            room: occupancy.room._id,
            reason,
            details,
            requestedLeaveDate: new Date(requestedLeaveDate),
            depositRefundRequested: depositRefundRequested === 'true',
            status: 'pending'
        });
        
        await leaveRequest.save();
        
        const owner = await User.findById(occupancy.hostel.owner);
        const student = await User.findById(req.user.id);
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: owner.email,
            subject: '📝 New Leave Request',
            html: `
                <h2>Student Leave Request</h2>
                <p><strong>Student:</strong> ${student.name}</p>
                <p><strong>Hostel:</strong> ${occupancy.hostel.name}</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p><strong>Requested Leave Date:</strong> ${new Date(requestedLeaveDate).toLocaleDateString()}</p>
                <p><strong>Deposit Refund Requested:</strong> ${depositRefundRequested === 'true' ? 'Yes' : 'No'}</p>
                <p>Please log in to your account to review this request.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Leave request email error:', err); 
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Leave request submitted successfully',
            leaveRequest
        });
        
    } catch (err) {
        console.error('Leave request error:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/leave-requests', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const leaveRequests = await LeaveRequest.find({ student: req.user.id })
            .populate('hostel', 'name')
            .populate('room', 'name')
            .sort('-createdAt');
        
        res.json(leaveRequests);
    } catch (err) {
        console.error('Error fetching leave requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/leave-requests', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const hostelIds = hostels.map(h => h._id);
        
        const leaveRequests = await LeaveRequest.find({ 
            hostel: { $in: hostelIds },
            status: 'pending'
        })
        .populate('student', 'name email mobile')
        .populate('hostel', 'name')
        .populate('room', 'name')
        .sort('-createdAt');
        
        res.json(leaveRequests);
    } catch (err) {
        console.error('Error fetching leave requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/owner/leave-requests/:requestId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { requestId } = req.params;
        const { action, ownerResponse, refundAmount } = req.body;
        
        const leaveRequest = await LeaveRequest.findById(requestId)
            .populate('student')
            .populate('hostel')
            .populate('occupancy');
        
        if (!leaveRequest) {
            return res.status(404).json({ message: 'Leave request not found' });
        }
        
        if (leaveRequest.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not your hostel' });
        }
        
        if (action === 'approve') {
            leaveRequest.status = 'approved';
            leaveRequest.ownerResponse = ownerResponse || 'Request approved';
            leaveRequest.processedAt = new Date();
            
            const occupancy = await Occupancy.findById(leaveRequest.occupancy._id);
            occupancy.status = 'checked_out';
            occupancy.checkOutDate = new Date();
            
            if (leaveRequest.depositRefundRequested) {
                occupancy.depositRefunded = true;
                occupancy.refundDate = new Date();
                
                if (refundAmount) {
                    occupancy.depositRefunded = true;
                    
                    const refundPayment = new Payment({
                        student: leaveRequest.student._id,
                        occupancy: occupancy._id,
                        hostel: leaveRequest.hostel._id,
                        paymentType: 'other',
                        amount: -parseFloat(refundAmount),
                        paymentMethod: 'cash',
                        status: 'refunded',
                        notes: `Deposit refund for leave request`
                    });
                    await refundPayment.save();
                }
            }
            
            await occupancy.save();
            
            const room = await Room.findById(leaveRequest.room);
            const bedIndex = room.bedAssignments.findIndex(
                b => b.student && b.student.toString() === leaveRequest.student._id.toString()
            );
            
            if (bedIndex !== -1) {
                room.bedAssignments[bedIndex].student = null;
                room.bedAssignments[bedIndex].checkInDate = null;
                room.bedAssignments[bedIndex].status = 'vacant';
                room.availableBeds += 1;
                await room.save();
            }
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: leaveRequest.student.email,
                subject: '✅ Leave Request Approved',
                html: `
                    <h2>Leave Request Approved</h2>
                    <p>Dear ${leaveRequest.student.name},</p>
                    <p>Your request to leave ${leaveRequest.hostel.name} has been approved.</p>
                    <p><strong>Owner Response:</strong> ${ownerResponse || 'Approved'}</p>
                    ${leaveRequest.depositRefundRequested ? 
                        `<p>Your deposit refund of GHS ${refundAmount || 'the full amount'} has been processed.</p>` : 
                        ''}
                    <p>Please ensure you have cleared your room and returned all keys before your check-out date.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Leave approval email error:', err); 
            });
            
        } else if (action === 'reject') {
            leaveRequest.status = 'rejected';
            leaveRequest.ownerResponse = ownerResponse || 'Request rejected';
            leaveRequest.processedAt = new Date();
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: leaveRequest.student.email,
                subject: '❌ Leave Request Rejected',
                html: `
                    <h2>Leave Request Rejected</h2>
                    <p>Dear ${leaveRequest.student.name},</p>
                    <p>Your request to leave ${leaveRequest.hostel.name} has been rejected.</p>
                    <p><strong>Owner Response:</strong> ${ownerResponse || 'Rejected'}</p>
                    <p>Please contact the hostel owner for more information.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Leave rejection email error:', err); 
            });
            
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }
        
        await leaveRequest.save();
        
        res.json({ 
            success: true, 
            message: `Leave request ${action}d successfully`,
            leaveRequest
        });
        
    } catch (err) {
        console.error('Error processing leave request:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 10. MAINTENANCE REQUESTS ====================
app.post('/api/student/maintenance', authenticateToken, upload.array('attachments', 5), async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { title, description, category, priority } = req.body;
        
        const occupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        if (!occupancy) {
            return res.status(404).json({ message: 'No active occupancy found' });
        }
        
        const attachments = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
        
        const maintenance = new Maintenance({
            student: req.user.id,
            hostel: occupancy.hostel._id,
            room: occupancy.room._id,
            title,
            description,
            category,
            priority: priority || 'medium',
            status: 'pending',
            attachments,
            createdAt: new Date()
        });
        
        await maintenance.save();
        
        const owner = await User.findById(occupancy.hostel.owner);
        const student = await User.findById(req.user.id);
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: owner.email,
            subject: `🔧 New Maintenance Request: ${title}`,
            html: `
                <h2>New Maintenance Request</h2>
                <p><strong>Student:</strong> ${student.name}</p>
                <p><strong>Room:</strong> ${occupancy.room.name}</p>
                <p><strong>Category:</strong> ${category}</p>
                <p><strong>Priority:</strong> ${priority || 'medium'}</p>
                <p><strong>Description:</strong> ${description}</p>
                <p>Please log in to your account to view and respond to this request.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Maintenance email error:', err); 
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Maintenance request submitted successfully',
            maintenance
        });
        
    } catch (err) {
        console.error('Maintenance request error:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/maintenance', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const maintenance = await Maintenance.find({ student: req.user.id })
            .populate('hostel', 'name')
            .populate('room', 'name')
            .sort('-createdAt');
        
        res.json(maintenance);
    } catch (err) {
        console.error('Error fetching maintenance requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/maintenance', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { status, priority, category } = req.query;
        
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const hostelIds = hostels.map(h => h._id);
        
        let query = { hostel: { $in: hostelIds } };
        
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (category) query.category = category;
        
        const maintenance = await Maintenance.find(query)
            .populate('student', 'name email mobile')
            .populate('hostel', 'name')
            .populate('room', 'name')
            .sort('-createdAt');
        
        res.json(maintenance);
    } catch (err) {
        console.error('Error fetching maintenance requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/owner/maintenance/:requestId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { requestId } = req.params;
        const { status, ownerNotes, assignedTo, estimatedCompletion } = req.body;
        
        const maintenance = await Maintenance.findById(requestId)
            .populate('student')
            .populate('hostel');
        
        if (!maintenance) {
            return res.status(404).json({ message: 'Maintenance request not found' });
        }
        
        if (maintenance.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not your hostel' });
        }
        
        if (status) maintenance.status = status;
        if (ownerNotes) maintenance.ownerNotes = ownerNotes;
        if (assignedTo) maintenance.assignedTo = assignedTo;
        if (estimatedCompletion) maintenance.estimatedCompletion = new Date(estimatedCompletion);
        
        if (status === 'completed') {
            maintenance.completedAt = new Date();
        }
        
        await maintenance.save();
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: maintenance.student.email,
            subject: `🔧 Maintenance Request Updated: ${maintenance.title}`,
            html: `
                <h2>Maintenance Request Update</h2>
                <p>Dear ${maintenance.student.name},</p>
                <p>Your maintenance request has been updated.</p>
                <p><strong>Title:</strong> ${maintenance.title}</p>
                <p><strong>New Status:</strong> ${status || maintenance.status}</p>
                ${ownerNotes ? `<p><strong>Owner Notes:</strong> ${ownerNotes}</p>` : ''}
                ${estimatedCompletion ? `<p><strong>Estimated Completion:</strong> ${new Date(estimatedCompletion).toLocaleDateString()}</p>` : ''}
                <p>Please log in to your account for more details.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Maintenance update email error:', err); 
        });
        
        res.json({ 
            success: true, 
            message: 'Maintenance request updated successfully',
            maintenance
        });
        
    } catch (err) {
        console.error('Error updating maintenance request:', err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/student/maintenance/:requestId/feedback', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { requestId } = req.params;
        const { rating, comment } = req.body;
        
        const maintenance = await Maintenance.findOne({ 
            _id: requestId, 
            student: req.user.id,
            status: 'completed'
        });
        
        if (!maintenance) {
            return res.status(404).json({ message: 'Maintenance request not found or not completed' });
        }
        
        maintenance.studentFeedback = {
            rating: parseInt(rating),
            comment,
            submittedAt: new Date()
        };
        
        await maintenance.save();
        
        res.json({ 
            success: true, 
            message: 'Feedback submitted successfully',
            maintenance
        });
        
    } catch (err) {
        console.error('Error submitting feedback:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 11. ROOMMATE MATCHING SYSTEM ====================
app.put('/api/student/roommate-preferences', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { smoking, pets, studyHabits, sleepSchedule, cleanliness, noiseLevel, budget, preferredGender } = req.body;
        
        const student = await User.findById(req.user.id);
        
        student.roommatePreferences = {
            smoking: smoking || student.roommatePreferences?.smoking || 'indifferent',
            pets: pets || student.roommatePreferences?.pets || 'indifferent',
            studyHabits: studyHabits || student.roommatePreferences?.studyHabits || 'flexible',
            sleepSchedule: sleepSchedule || student.roommatePreferences?.sleepSchedule || 'flexible',
            cleanliness: cleanliness ? parseInt(cleanliness) : student.roommatePreferences?.cleanliness || 3,
            noiseLevel: noiseLevel ? parseInt(noiseLevel) : student.roommatePreferences?.noiseLevel || 3,
            budget: budget ? parseFloat(budget) : student.roommatePreferences?.budget,
            preferredGender: preferredGender || student.roommatePreferences?.preferredGender || 'any'
        };
        
        await student.save();
        
        res.json({ 
            success: true, 
            message: 'Roommate preferences updated successfully',
            preferences: student.roommatePreferences
        });
        
    } catch (err) {
        console.error('Error updating preferences:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/potential-roommates', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const student = await User.findById(req.user.id);
        
        const occupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel');
        
        let query = {
            role: 'student',
            _id: { $ne: req.user.id },
            status: 'active'
        };
        
        if (occupancy) {
            const sameHostelOccupancies = await Occupancy.find({ 
                hostel: occupancy.hostel._id,
                status: 'active',
                student: { $ne: req.user.id }
            }).populate('student');
            
            const sameHostelStudents = sameHostelOccupancies.map(o => o.student._id);
            query._id = { $in: sameHostelStudents };
        }
        
        const candidates = await User.find(query).select('-userPin');
        
        const results = candidates.map(candidate => ({
            student: {
                _id: candidate._id,
                name: candidate.name,
                email: candidate.email,
                profilePicture: candidate.profilePicture,
                roommatePreferences: candidate.roommatePreferences || {}
            },
            compatibilityScore: calculateCompatibility(student, candidate)
        }));
        
        results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
        
        res.json(results);
        
    } catch (err) {
        console.error('Error finding potential roommates:', err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/student/roommate-request', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { recipientId, message } = req.body;
        
        const recipient = await User.findById(recipientId);
        if (!recipient || recipient.role !== 'student') {
            return res.status(404).json({ message: 'Student not found' });
        }
        
        const existingRequest = await RoommateRequest.findOne({
            $or: [
                { requester: req.user.id, recipient: recipientId },
                { requester: recipientId, recipient: req.user.id }
            ],
            status: { $in: ['pending', 'accepted'] }
        });
        
        if (existingRequest) {
            return res.status(400).json({ message: 'A roommate request already exists with this student' });
        }
        
        const roommateRequest = new RoommateRequest({
            requester: req.user.id,
            recipient: recipientId,
            message,
            status: 'pending'
        });
        
        await roommateRequest.save();
        
        const requester = await User.findById(req.user.id);
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: recipient.email,
            subject: '👥 Roommate Request',
            html: `
                <h2>You have a new roommate request!</h2>
                <p><strong>From:</strong> ${requester.name}</p>
                <p><strong>Message:</strong> ${message || 'No message'}</p>
                <p>Log in to your account to accept or decline this request.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Roommate request email error:', err); 
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Roommate request sent successfully',
            roommateRequest
        });
        
    } catch (err) {
        console.error('Error sending roommate request:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/roommate-requests', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const sent = await RoommateRequest.find({ 
            requester: req.user.id 
        }).populate('recipient', 'name email profilePicture');
        
        const received = await RoommateRequest.find({ 
            recipient: req.user.id 
        }).populate('requester', 'name email profilePicture');
        
        res.json({
            sent,
            received
        });
        
    } catch (err) {
        console.error('Error fetching roommate requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/student/roommate-requests/:requestId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { requestId } = req.params;
        const { action } = req.body;
        
        const roommateRequest = await RoommateRequest.findOne({
            _id: requestId,
            recipient: req.user.id,
            status: 'pending'
        }).populate('requester');
        
        if (!roommateRequest) {
            return res.status(404).json({ message: 'Roommate request not found' });
        }
        
        if (action === 'accept') {
            roommateRequest.status = 'accepted';
            
            const requesterOccupancy = await Occupancy.findOne({ 
                student: roommateRequest.requester._id,
                status: 'active'
            });
            
            const recipientOccupancy = await Occupancy.findOne({ 
                student: req.user.id,
                status: 'active'
            });
            
            if (requesterOccupancy && recipientOccupancy && 
                requesterOccupancy.hostel.toString() === recipientOccupancy.hostel.toString()) {
                
                let group = await RoommateGroup.findOne({
                    hostel: requesterOccupancy.hostel,
                    room: requesterOccupancy.room
                });
                
                if (!group) {
                    group = new RoommateGroup({
                        name: `Roommates in ${requesterOccupancy.room}`,
                        members: [roommateRequest.requester._id, req.user.id],
                        hostel: requesterOccupancy.hostel,
                        room: requesterOccupancy.room,
                        createdBy: roommateRequest.requester._id
                    });
                } else {
                    if (!group.members.includes(req.user.id)) {
                        group.members.push(req.user.id);
                    }
                }
                
                await group.save();
            }
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: roommateRequest.requester.email,
                subject: '✅ Roommate Request Accepted',
                html: `
                    <h2>Roommate Request Accepted!</h2>
                    <p>${req.user.name} has accepted your roommate request.</p>
                    <p>You can now contact each other through the messaging system.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Roommate accept email error:', err); 
            });
            
        } else if (action === 'reject') {
            roommateRequest.status = 'rejected';
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: roommateRequest.requester.email,
                subject: '❌ Roommate Request Declined',
                html: `
                    <h2>Roommate Request Declined</h2>
                    <p>${req.user.name} has declined your roommate request.</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Roommate reject email error:', err); 
            });
            
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }
        
        roommateRequest.respondedAt = new Date();
        await roommateRequest.save();
        
        res.json({ 
            success: true, 
            message: `Roommate request ${action}ed`,
            roommateRequest
        });
        
    } catch (err) {
        console.error('Error responding to roommate request:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/current-roommates', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const occupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('room').populate('hostel');
        
        if (!occupancy) {
            return res.json([]);
        }
        
        const roommates = await Occupancy.find({
            hostel: occupancy.hostel._id,
            room: occupancy.room._id,
            status: 'active',
            student: { $ne: req.user.id }
        }).populate('student', 'name email mobile profilePicture');
        
        const result = roommates.map(r => ({
            student: r.student,
            bedNumber: r.bedNumber,
            checkInDate: r.checkInDate
        }));
        
        res.json(result);
        
    } catch (err) {
        console.error('Error fetching roommates:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 12. ROOM TRANSFER SYSTEM ====================
app.post('/api/student/transfer-request', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const { targetHostelId, targetRoomId, reason, transferType } = req.body;
        
        const currentOccupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        if (!currentOccupancy) {
            return res.status(404).json({ message: 'No active occupancy found' });
        }
        
        let targetHostel, targetRoom;
        
        if (transferType === 'same_hostel') {
            targetHostel = currentOccupancy.hostel;
            targetRoom = await Room.findById(targetRoomId);
            
            if (!targetRoom || targetRoom.hostel.toString() !== currentOccupancy.hostel._id.toString()) {
                return res.status(404).json({ message: 'Target room not found in current hostel' });
            }
            
            if (targetRoom.availableBeds < 1) {
                return res.status(400).json({ message: 'Target room has no available beds' });
            }
            
        } else if (transferType === 'different_hostel') {
            targetHostel = await Hostel.findById(targetHostelId);
            if (!targetHostel) {
                return res.status(404).json({ message: 'Target hostel not found' });
            }
            
            targetRoom = await Room.findById(targetRoomId);
            if (!targetRoom || targetRoom.hostel.toString() !== targetHostel._id.toString()) {
                return res.status(404).json({ message: 'Target room not found in target hostel' });
            }
            
            if (targetRoom.availableBeds < 1) {
                return res.status(400).json({ message: 'Target room has no available beds' });
            }
        } else {
            return res.status(400).json({ message: 'Invalid transfer type' });
        }
        
        const existingRequest = await TransferRequest.findOne({
            student: req.user.id,
            status: 'pending'
        });
        
        if (existingRequest) {
            return res.status(400).json({ message: 'You already have a pending transfer request' });
        }
        
        const transferRequest = new TransferRequest({
            student: req.user.id,
            currentOccupancy: currentOccupancy._id,
            currentHostel: currentOccupancy.hostel._id,
            currentRoom: currentOccupancy.room._id,
            targetHostel: targetHostel._id,
            targetRoom: targetRoom._id,
            transferType,
            reason,
            status: 'pending'
        });
        
        await transferRequest.save();
        
        const currentOwner = await User.findById(currentOccupancy.hostel.owner);
        const student = await User.findById(req.user.id);
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: currentOwner.email,
            subject: '🔄 New Room Transfer Request',
            html: `
                <h2>Room Transfer Request</h2>
                <p><strong>Student:</strong> ${student.name}</p>
                <p><strong>Current Room:</strong> ${currentOccupancy.room.name}</p>
                <p><strong>Transfer Type:</strong> ${transferType === 'same_hostel' ? 'Same Hostel' : 'Different Hostel'}</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p>Please log in to review this request.</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Transfer request email error:', err); 
        });
        
        if (transferType === 'different_hostel') {
            const targetOwner = await User.findById(targetHostel.owner);
            
            const targetMailOptions = {
                from: process.env.EMAIL_USER,
                to: targetOwner.email,
                subject: '🔄 New Room Transfer Request (Target Hostel)',
                html: `
                    <h2>Room Transfer Request to Your Hostel</h2>
                    <p><strong>Student:</strong> ${student.name}</p>
                    <p><strong>Current Hostel:</strong> ${currentOccupancy.hostel.name}</p>
                    <p><strong>Requesting to transfer to:</strong> ${targetHostel.name} - ${targetRoom.name}</p>
                    <p><strong>Reason:</strong> ${reason}</p>
                    <p>Please log in to review this request. Your approval will be required.</p>
                `
            };
            transporter.sendMail(targetMailOptions, (err) => { 
                if (err) console.log('Target transfer email error:', err); 
            });
        }
        
        res.status(201).json({ 
            success: true, 
            message: 'Transfer request submitted successfully',
            transferRequest
        });
        
    } catch (err) {
        console.error('Error creating transfer request:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/transfer-requests', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const transfers = await TransferRequest.find({ student: req.user.id })
            .populate('currentHostel', 'name')
            .populate('currentRoom', 'name')
            .populate('targetHostel', 'name')
            .populate('targetRoom', 'name')
            .sort('-createdAt');
        
        res.json(transfers);
    } catch (err) {
        console.error('Error fetching transfer requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/transfer-requests', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const hostelIds = hostels.map(h => h._id);
        
        const transfers = await TransferRequest.find({
            $or: [
                { currentHostel: { $in: hostelIds } },
                { targetHostel: { $in: hostelIds } }
            ]
        })
        .populate('student', 'name email mobile')
        .populate('currentHostel', 'name')
        .populate('currentRoom', 'name')
        .populate('targetHostel', 'name')
        .populate('targetRoom', 'name')
        .sort('-createdAt');
        
        res.json(transfers);
    } catch (err) {
        console.error('Error fetching transfer requests:', err);
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/owner/transfer-requests/:requestId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { requestId } = req.params;
        const { action, ownerResponse } = req.body;
        
        const transferRequest = await TransferRequest.findById(requestId)
            .populate('student')
            .populate('currentHostel')
            .populate('currentRoom')
            .populate('targetHostel')
            .populate('targetRoom')
            .populate('currentOccupancy');
        
        if (!transferRequest) {
            return res.status(404).json({ message: 'Transfer request not found' });
        }
        
        const isCurrentOwner = transferRequest.currentHostel.owner.toString() === req.user.id;
        const isTargetOwner = transferRequest.targetHostel.owner.toString() === req.user.id;
        
        if (!isCurrentOwner && !isTargetOwner) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        
        if (action === 'approve_current' && isCurrentOwner) {
            transferRequest.currentOwnerApproval = true;
            transferRequest.currentOwnerResponse = ownerResponse || 'Approved';
            
            if (transferRequest.transferType === 'same_hostel') {
                transferRequest.status = 'completed';
                await completeTransfer(transferRequest);
            } else {
                if (transferRequest.targetOwnerApproval) {
                    transferRequest.status = 'completed';
                    await completeTransfer(transferRequest);
                } else {
                    transferRequest.status = 'approved_by_owner';
                }
            }
            
        } else if (action === 'approve_target' && isTargetOwner) {
            transferRequest.targetOwnerApproval = true;
            transferRequest.targetOwnerResponse = ownerResponse || 'Approved';
            
            if (transferRequest.currentOwnerApproval) {
                transferRequest.status = 'completed';
                await completeTransfer(transferRequest);
            } else {
                transferRequest.status = 'approved_by_target_owner';
            }
            
        } else if (action === 'reject') {
            transferRequest.status = 'rejected';
            if (isCurrentOwner) {
                transferRequest.currentOwnerResponse = ownerResponse || 'Rejected';
            } else if (isTargetOwner) {
                transferRequest.targetOwnerResponse = ownerResponse || 'Rejected';
            }
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: transferRequest.student.email,
                subject: '❌ Transfer Request Rejected',
                html: `
                    <h2>Transfer Request Rejected</h2>
                    <p>Dear ${transferRequest.student.name},</p>
                    <p>Your request to transfer rooms has been rejected.</p>
                    <p><strong>Response:</strong> ${ownerResponse || 'No details provided'}</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Transfer reject email error:', err); 
            });
            
        } else if (action === 'complete' && isCurrentOwner) {
            transferRequest.status = 'completed';
            await completeTransfer(transferRequest);
            
        } else {
            return res.status(400).json({ message: 'Invalid action or unauthorized' });
        }
        
        transferRequest.processedAt = new Date();
        await transferRequest.save();
        
        res.json({ 
            success: true, 
            message: `Transfer request updated successfully`,
            transferRequest
        });
        
    } catch (err) {
        console.error('Error processing transfer request:', err);
        res.status(500).json({ message: err.message });
    }
});

async function completeTransfer(transferRequest) {
    const currentOccupancy = await Occupancy.findById(transferRequest.currentOccupancy._id);
    const currentRoom = await Room.findById(transferRequest.currentRoom._id);
    const targetRoom = await Room.findById(transferRequest.targetRoom._id);
    
    const currentBedIndex = currentRoom.bedAssignments.findIndex(
        b => b.student && b.student.toString() === transferRequest.student._id.toString()
    );
    
    if (currentBedIndex !== -1) {
        currentRoom.bedAssignments[currentBedIndex].student = null;
        currentRoom.bedAssignments[currentBedIndex].checkInDate = null;
        currentRoom.bedAssignments[currentBedIndex].status = 'vacant';
        currentRoom.availableBeds += 1;
        await currentRoom.save();
    }
    
    const targetBedIndex = targetRoom.bedAssignments.findIndex(b => b.status === 'vacant');
    
    if (targetBedIndex !== -1) {
        targetRoom.bedAssignments[targetBedIndex].student = transferRequest.student._id;
        targetRoom.bedAssignments[targetBedIndex].checkInDate = new Date();
        targetRoom.bedAssignments[targetBedIndex].status = 'occupied';
        targetRoom.availableBeds -= 1;
        await targetRoom.save();
        
        currentOccupancy.status = 'transferred';
        currentOccupancy.checkOutDate = new Date();
        await currentOccupancy.save();
        
        const newOccupancy = new Occupancy({
            student: transferRequest.student._id,
            hostel: transferRequest.targetHostel._id,
            room: transferRequest.targetRoom._id,
            bedNumber: targetRoom.bedAssignments[targetBedIndex].bedNumber,
            checkInDate: new Date(),
            expectedCheckOutDate: currentOccupancy.expectedCheckOutDate,
            status: 'active',
            depositPaid: currentOccupancy.depositPaid,
            depositAmount: currentOccupancy.depositAmount,
            notes: `Transferred from ${currentRoom.name}`
        });
        
        await newOccupancy.save();
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: transferRequest.student.email,
            subject: '✅ Transfer Completed',
            html: `
                <h2>Room Transfer Completed</h2>
                <p>Dear ${transferRequest.student.name},</p>
                <p>Your room transfer has been completed successfully.</p>
                <p><strong>New Room:</strong> ${targetRoom.name}</p>
                <p><strong>Bed Number:</strong> ${targetRoom.bedAssignments[targetBedIndex].bedNumber}</p>
                <p>Enjoy your new room!</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Transfer completion email error:', err); 
        });
    }
    
    transferRequest.completedAt = new Date();
}

// ==================== 13. PAYMENT TRACKING SYSTEM ====================
app.post('/api/owner/payments', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { 
            studentId, 
            paymentType, 
            amount, 
            paymentMethod, 
            transactionId,
            periodFrom,
            periodTo,
            notes,
            occupancyId
        } = req.body;
        
        const student = await User.findById(studentId);
        if (!student || student.role !== 'student') {
            return res.status(404).json({ message: 'Student not found' });
        }
        
        let occupancy = null;
        if (occupancyId) {
            occupancy = await Occupancy.findById(occupancyId).populate('hostel');
        } else {
            occupancy = await Occupancy.findOne({ 
                student: studentId, 
                status: 'active' 
            }).populate('hostel');
        }
        
        if (!occupancy) {
            return res.status(404).json({ message: 'No active occupancy found for this student' });
        }
        
        if (occupancy.hostel.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not your hostel' });
        }
        
        const receiptNumber = generateReceiptNumber();
        
        const payment = new Payment({
            student: studentId,
            occupancy: occupancy._id,
            hostel: occupancy.hostel._id,
            paymentType,
            amount: parseFloat(amount),
            paymentMethod,
            transactionId,
            receiptNumber,
            period: {
                from: periodFrom ? new Date(periodFrom) : null,
                to: periodTo ? new Date(periodTo) : null
            },
            notes,
            recordedBy: req.user.id,
            status: 'completed'
        });
        
        await payment.save();
        
        if (paymentType === 'deposit') {
            occupancy.depositPaid = true;
            occupancy.depositAmount = parseFloat(amount);
            await occupancy.save();
        }
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: student.email,
            subject: `🧾 Payment Receipt - ${receiptNumber}`,
            html: `
                <h2>Payment Receipt</h2>
                <p>Dear ${student.name},</p>
                <p>We have received your payment.</p>
                
                <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                    <p><strong>Receipt Number:</strong> ${receiptNumber}</p>
                    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                    <p><strong>Payment Type:</strong> ${paymentType}</p>
                    <p><strong>Amount:</strong> GHS ${amount}</p>
                    <p><strong>Payment Method:</strong> ${paymentMethod}</p>
                    ${transactionId ? `<p><strong>Transaction ID:</strong> ${transactionId}</p>` : ''}
                    ${periodFrom && periodTo ? 
                        `<p><strong>Period:</strong> ${new Date(periodFrom).toLocaleDateString()} to ${new Date(periodTo).toLocaleDateString()}</p>` : 
                        ''}
                    ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
                </div>
                
                <p>Thank you for your payment!</p>
            `
        };
        transporter.sendMail(mailOptions, (err) => { 
            if (err) console.log('Payment receipt email error:', err); 
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Payment recorded successfully',
            payment
        });
        
    } catch (err) {
        console.error('Error recording payment:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/payments', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const payments = await Payment.find({ student: req.user.id })
            .populate('hostel', 'name')
            .sort('-paymentDate');
        
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const deposits = payments.filter(p => p.paymentType === 'deposit');
        const rent = payments.filter(p => p.paymentType === 'rent');
        
        res.json({
            payments,
            summary: {
                totalPaid,
                totalDeposits: deposits.reduce((sum, p) => sum + p.amount, 0),
                totalRent: rent.reduce((sum, p) => sum + p.amount, 0),
                paymentCount: payments.length
            }
        });
    } catch (err) {
        console.error('Error fetching payments:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/payments', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const { studentId, fromDate, toDate, paymentType } = req.query;
        
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const hostelIds = hostels.map(h => h._id);
        
        let query = { hostel: { $in: hostelIds } };
        
        if (studentId) query.student = studentId;
        if (paymentType) query.paymentType = paymentType;
        
        if (fromDate || toDate) {
            query.paymentDate = {};
            if (fromDate) query.paymentDate.$gte = new Date(fromDate);
            if (toDate) query.paymentDate.$lte = new Date(toDate);
        }
        
        const payments = await Payment.find(query)
            .populate('student', 'name email mobile')
            .populate('hostel', 'name')
            .sort('-paymentDate');
        
        const summary = {
            totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
            byType: {
                deposit: payments.filter(p => p.paymentType === 'deposit').reduce((sum, p) => sum + p.amount, 0),
                rent: payments.filter(p => p.paymentType === 'rent').reduce((sum, p) => sum + p.amount, 0),
                maintenance: payments.filter(p => p.paymentType === 'maintenance_fee').reduce((sum, p) => sum + p.amount, 0),
                late: payments.filter(p => p.paymentType === 'late_fee').reduce((sum, p) => sum + p.amount, 0)
            },
            byMethod: {}
        };
        
        payments.forEach(p => {
            if (!summary.byMethod[p.paymentMethod]) {
                summary.byMethod[p.paymentMethod] = 0;
            }
            summary.byMethod[p.paymentMethod] += p.amount;
        });
        
        res.json({
            payments,
            summary
        });
    } catch (err) {
        console.error('Error fetching payments:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/payments/:paymentId/receipt', authenticateToken, async (req, res) => {
    try {
        const { paymentId } = req.params;
        
        const payment = await Payment.findById(paymentId)
            .populate('student', 'name email')
            .populate('hostel', 'name location contactPhone')
            .populate('recordedBy', 'name');
        
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }
        
        const isStudent = payment.student._id.toString() === req.user.id;
        const isOwner = payment.hostel.owner.toString() === req.user.id;
        const isAdmin = req.user.isAdmin;
        
        if (!isStudent && !isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        
        res.json(payment);
    } catch (err) {
        console.error('Error fetching receipt:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 14. STUDENT: BROWSE & BOOK ====================
app.get('/api/hostels', async (req, res) => {
    try {
        const { location } = req.query;
        let query = {};
        if (location) query.location = { $regex: location, $options: 'i' };
        const hostels = await Hostel.find(query).populate('owner', 'name contactPhone');
        res.json(hostels);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/hostels/:hostelId', async (req, res) => {
    try {
        const hostel = await Hostel.findById(req.params.hostelId).populate('owner', 'name contactPhone');
        if (!hostel) return res.status(404).json({ message: 'Hostel not found' });
        const rooms = await Room.find({ hostel: hostel._id, availableBeds: { $gt: 0 } });
        res.json({ hostel, rooms });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/hostels/:hostelId/rooms', async (req, res) => {
    try {
        const rooms = await Room.find({ hostel: req.params.hostelId, availableBeds: { $gt: 0 } });
        res.json(rooms);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/bookings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Only students can book' });
    try {
        const { roomId, moveInDate, duration } = req.body;
        const room = await Room.findById(roomId).populate('hostel');
        if (!room) return res.status(404).json({ message: 'Room not found' });
        if (room.availableBeds < 1) return res.status(400).json({ message: 'No available beds' });

        const booking = new Booking({
            student: req.user.id, room: room._id, hostel: room.hostel._id,
            moveInDate: new Date(moveInDate), duration, status: 'pending'
        });
        await booking.save();

        const student = await User.findById(req.user.id);
        const owner = await User.findById(room.hostel.owner);

        transporter.sendMail({
            from: process.env.EMAIL_USER, to: student.email,
            subject: 'Booking Request Received',
            html: `<p>Your booking for ${room.name} at ${room.hostel.name} is pending owner confirmation.</p>`
        }, err => { if (err) console.log('Email error:', err); });

        transporter.sendMail({
            from: process.env.EMAIL_USER, to: owner.email,
            subject: 'New Booking Request',
            html: `<p>A student has requested to book ${room.name}.</p><p>Student: ${student.name} (${student.mobile})</p><p>Please log in to confirm or cancel this booking.</p>`
        }, err => { if (err) console.log('Email error:', err); });

        res.status(201).json({ success: true, message: 'Booking request sent.', booking });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.get('/api/student/bookings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Access denied' });
    try {
        const bookings = await Booking.find({ student: req.user.id })
            .populate('hostel', 'name')
            .populate('room', 'name pricePerBed')
            .populate('occupancy')
            .sort('-createdAt');
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/student/bookings/:bookingId/cancel', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Access denied' });
    try {
        const booking = await Booking.findOne({ _id: req.params.bookingId, student: req.user.id });
        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        
        if (booking.status === 'cancelled') return res.status(400).json({ message: 'Already cancelled' });
        if (booking.status === 'confirmed' || booking.status === 'checked_in') {
            return res.status(400).json({ message: 'Cannot cancel after owner confirmation. Please submit a leave request instead.' });
        }

        booking.status = 'cancelled';
        await booking.save();

        res.json({ success: true, message: 'Booking cancelled.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==================== 15. OWNER: VIEW & MANAGE BOOKINGS ====================
app.get('/api/owner/bookings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Access denied' });
    try {
        const hostels = await Hostel.find({ owner: req.user.id }).select('_id');
        const bookings = await Booking.find({ hostel: { $in: hostels.map(h => h._id) } })
            .populate('student', 'name email mobile')
            .populate('room', 'name totalBeds availableBeds bedAssignments')
            .populate('hostel', 'name')
            .sort('-createdAt');
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/owner/bookings/:bookingId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Access denied' });
    
    try {
        const booking = await Booking.findById(req.params.bookingId)
            .populate('hostel')
            .populate('student')
            .populate('room');
        
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const hostel = await Hostel.findOne({ _id: booking.hostel._id, owner: req.user.id });
        if (!hostel) return res.status(403).json({ message: 'Not your hostel' });

        const { action, depositPaid, depositAmount, bedNumber } = req.body;
        
        if (action === 'confirm') {
            booking.status = 'confirmed';
            
            const room = await Room.findById(booking.room._id);
            
            let bedIndex = -1;
            if (bedNumber) {
                bedIndex = room.bedAssignments.findIndex(
                    b => b.bedNumber === parseInt(bedNumber) && b.status === 'vacant'
                );
            } else {
                bedIndex = room.bedAssignments.findIndex(b => b.status === 'vacant');
            }
            
            if (bedIndex === -1) {
                return res.status(400).json({ message: 'No available beds in this room' });
            }
            
            room.bedAssignments[bedIndex].student = booking.student._id;
            room.bedAssignments[bedIndex].checkInDate = new Date();
            room.bedAssignments[bedIndex].status = 'occupied';
            room.availableBeds = room.bedAssignments.filter(b => b.status === 'vacant').length;
            await room.save();
            
            const occupancy = new Occupancy({
                student: booking.student._id,
                hostel: booking.hostel._id,
                room: booking.room._id,
                bedNumber: room.bedAssignments[bedIndex].bedNumber,
                booking: booking._id,
                checkInDate: new Date(),
                expectedCheckOutDate: calculateExpectedCheckOut(booking.moveInDate, booking.duration),
                status: 'active',
                depositPaid: depositPaid === 'true',
                depositAmount: depositAmount ? parseFloat(depositAmount) : 0,
                notes: `Auto checked-in upon booking confirmation`
            });
            
            await occupancy.save();
            
            booking.occupancy = occupancy._id;
            
            if (depositPaid === 'true' && depositAmount) {
                const payment = new Payment({
                    student: booking.student._id,
                    occupancy: occupancy._id,
                    booking: booking._id,
                    hostel: booking.hostel._id,
                    paymentType: 'deposit',
                    amount: parseFloat(depositAmount),
                    paymentMethod: 'cash',
                    status: 'completed',
                    notes: 'Deposit paid at booking confirmation'
                });
                await payment.save();
                
                occupancy.depositPaid = true;
                await occupancy.save();
            }
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: booking.student.email,
                subject: '✅ Booking Confirmed - You are now a resident!',
                html: `
                    <h2>Welcome to ${booking.hostel.name}!</h2>
                    <p>Dear ${booking.student.name},</p>
                    <p>Your booking has been confirmed and you are now officially a resident!</p>
                    
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
                        <h3>Your Accommodation Details:</h3>
                        <p><strong>Hostel:</strong> ${booking.hostel.name}</p>
                        <p><strong>Location:</strong> ${booking.hostel.location}</p>
                        <p><strong>Room:</strong> ${room.name} (Bed #${room.bedAssignments[bedIndex].bedNumber})</p>
                        <p><strong>Check-in Date:</strong> ${new Date().toLocaleDateString()}</p>
                        ${depositPaid === 'true' ? `<p><strong>Deposit Paid:</strong> GHS ${depositAmount}</p>` : ''}
                    </div>
                    
                    <h3>What you can do now:</h3>
                    <ul>
                        <li>View your roommates in the dashboard</li>
                        <li>Submit maintenance requests if needed</li>
                        <li>Make payments for rent</li>
                        <li>Request to leave when you're ready to check out</li>
                        <li>Request room transfers if needed</li>
                    </ul>
                    
                    <p>We wish you a pleasant stay!</p>
                `
            };
            transporter.sendMail(mailOptions, (err) => { 
                if (err) console.log('Confirmation email error:', err); 
            });
            
        } else if (action === 'cancel') {
            booking.status = 'cancelled';
            
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: booking.student.email,
                subject: '❌ Booking Cancelled',
                html: `
                    <p>Your booking for ${booking.hostel.name} has been cancelled by the owner.</p>
                    <p>Please contact the hostel owner for more information.</p>
                `
            }, err => { if (err) console.log('Email error:', err); });
            
        } else {
            return res.status(400).json({ message: 'Invalid action' });
        }
        
        await booking.save();

        res.json({ 
            success: true, 
            message: action === 'confirm' 
                ? 'Booking confirmed and student automatically became a resident!' 
                : 'Booking cancelled.'
        });
        
    } catch (err) {
        console.error('Error processing booking:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 16. SETTINGS & LOGO UPLOAD ====================
app.get('/api/settings', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings({ contactEmail: process.env.ADMIN_EMAIL, contactPhone: process.env.ADMIN_PHONE });
            await settings.save();
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/settings/logo', authenticateToken, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No logo uploaded' });

        const logoUrl = `/uploads/${req.file.filename}`;
        let settings = await Settings.findOne();
        if (!settings) settings = new Settings({ logoUrl });
        else settings.logoUrl = logoUrl;
        await settings.save();

        res.json({ success: true, logoUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==================== 17. DEVELOPER PROFILE MANAGEMENT ====================
app.get('/api/developer', async (req, res) => {
    try {
        let developer = await Developer.findOne();
        if (!developer) {
            developer = new Developer({
                name: 'Victor Yidana',
                title: 'Full Stack Developer & Tech Innovator',
                bio: 'YIDANA VICTOR is the Founder and Chief Executive Officer of YIDANA HOSTELS, a forward-thinking digital accommodation platform built to modernize and simplify hostel management in Ghana. As a Computer Science student at the University of Ghana, he combines academic excellence with entrepreneurial vision, leveraging his expertise in full-stack development (HTML, CSS, JavaScript, Node.js, Express, MongoDB, and PHP), system architecture, and UI/UX design to build scalable, efficient, and user-centered solutions. Certified through multiple professional programs on Coursera and actively engaged in innovation initiatives and hackathons, Victor is driven by a mission to transform student accommodation through technology, leadership, and strategic digital innovation, positioning YIDANA HOSTELS as a model for smart hostel management systems in Ghana and beyond.',
                stats: {
                    yearsExperience: 5,
                    projectsCompleted: 20,
                    certifications: 10
                },
                certifications: [
                    'Web Development',
                    'Cloud Computing',
                    'Data Management',
                    'Node.js',
                    'MongoDB',
                    'React',
                    'Express.js'
                ],
                achievements: [
                    'Built YIDANA HOSTELS from scratch',
                    'Served 500+ students',
                    'Partnered with 50+ hostels'
                ]
            });
            await developer.save();
        }
        res.json(developer);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/developer/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No image uploaded' });

        const avatarUrl = `/uploads/${req.file.filename}`;
        let developer = await Developer.findOne();
        
        if (!developer) {
            developer = new Developer({ avatarUrl });
        } else {
            developer.avatarUrl = avatarUrl;
        }
        
        await developer.save();
        res.json({ success: true, avatarUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/developer', authenticateToken, async (req, res) => {
    try {
        const { name, title, bio, email, social, stats, certifications, achievements } = req.body;
        let developer = await Developer.findOne();
        
        if (!developer) {
            developer = new Developer(req.body);
        } else {
            if (name) developer.name = name;
            if (title) developer.title = title;
            if (bio) developer.bio = bio;
            if (email) developer.email = email;
            if (social) {
                developer.social = {
                    ...developer.social,
                    ...social
                };
            }
            if (stats) {
                developer.stats = {
                    ...developer.stats,
                    ...stats
                };
            }
            if (certifications) developer.certifications = certifications;
            if (achievements) developer.achievements = achievements;
        }
        
        developer.updatedAt = new Date();
        await developer.save();
        res.json({ success: true, developer });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/developer', authenticateToken, async (req, res) => {
    try {
        let developer = await Developer.findOne();
        if (!developer) {
            developer = new Developer();
            await developer.save();
        }
        res.json(developer);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==================== 18. ENHANCED DASHBOARDS ====================
app.get('/api/admin/stats', async (req, res) => {
    try {
        const now = new Date();
        
        const totalStudents = await User.countDocuments({ role: 'student' });
        const totalOwners = await User.countDocuments({ role: 'owner' });
        const pendingOwners = await User.countDocuments({ role: 'owner', isApproved: false });
        
        const totalHostels = await Hostel.countDocuments();
        const totalRooms = await Room.countDocuments();
        const totalBeds = await Room.aggregate([{ $group: { _id: null, total: { $sum: "$totalBeds" } } }]);
        const occupiedBeds = await Room.aggregate([{ $group: { _id: null, total: { $sum: { $subtract: ["$totalBeds", "$availableBeds"] } } } }]);
        
        const totalBookings = await Booking.countDocuments();
        const pendingBookings = await Booking.countDocuments({ status: 'pending' });
        const confirmedBookings = await Booking.countDocuments({ status: 'confirmed' });
        
        const activeResidents = await Occupancy.countDocuments({ status: 'active' });
        const totalOccupancies = await Occupancy.countDocuments();
        
        const pendingMaintenance = await Maintenance.countDocuments({ status: 'pending' });
        const inProgressMaintenance = await Maintenance.countDocuments({ status: 'in_progress' });
        const emergencyMaintenance = await Maintenance.countDocuments({ priority: 'emergency', status: { $ne: 'completed' } });
        
        const totalPayments = await Payment.countDocuments();
        const totalRevenue = await Payment.aggregate([
            { $match: { status: 'completed', amount: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        
        const pendingLeaveRequests = await LeaveRequest.countDocuments({ status: 'pending' });
        
        const pendingTransfers = await TransferRequest.countDocuments({ 
            status: { $in: ['pending', 'approved_by_owner', 'approved_by_target_owner'] } 
        });
        
        const pendingComplaints = await Complaint.countDocuments({ status: 'pending' });
        const totalComplaints = await Complaint.countDocuments();
        
        const activeAnnouncements = await Announcement.countDocuments({ expiresAt: { $gt: now } });
        const totalAnnouncements = await Announcement.countDocuments();
        
        const unreadMessages = await Message.countDocuments({ isRead: false });
        
        res.json({
            users: {
                totalStudents,
                totalOwners,
                pendingOwners,
                totalUsers: totalStudents + totalOwners
            },
            hostels: {
                totalHostels,
                totalRooms,
                totalBeds: totalBeds.length > 0 ? totalBeds[0].total : 0,
                occupiedBeds: occupiedBeds.length > 0 ? occupiedBeds[0].total : 0,
                occupancyRate: totalBeds.length > 0 && totalBeds[0].total > 0 
                    ? Math.round((occupiedBeds[0].total / totalBeds[0].total) * 100) 
                    : 0
            },
            bookings: {
                totalBookings,
                pendingBookings,
                confirmedBookings
            },
            residents: {
                activeResidents,
                totalOccupancies
            },
            maintenance: {
                pendingMaintenance,
                inProgressMaintenance,
                emergencyMaintenance,
                totalMaintenance: await Maintenance.countDocuments()
            },
            payments: {
                totalPayments,
                totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0
            },
            requests: {
                pendingLeaveRequests,
                pendingTransfers,
                pendingResets: await ResetRequest.countDocuments({ status: 'pending' })
            },
            complaints: {
                pendingComplaints,
                totalComplaints
            },
            announcements: {
                activeAnnouncements,
                totalAnnouncements
            },
            messages: {
                unreadMessages
            }
        });
    } catch (err) {
        console.error('Error fetching admin stats:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/owner/dashboard', authenticateToken, async (req, res) => {
    if (req.user.role !== 'owner') {
        return res.status(403).json({ message: 'Owners only' });
    }
    
    try {
        const hostels = await Hostel.find({ owner: req.user.id });
        const hostelIds = hostels.map(h => h._id);
        
        if (hostelIds.length === 0) {
            return res.json({
                message: 'No hostels found',
                stats: {
                    totalHostels: 0,
                    totalRooms: 0,
                    totalBeds: 0,
                    occupiedBeds: 0,
                    occupancyRate: 0,
                    activeResidents: 0
                },
                hostels: []
            });
        }
        
        const rooms = await Room.find({ hostel: { $in: hostelIds } });
        const totalRooms = rooms.length;
        const totalBeds = rooms.reduce((sum, r) => sum + r.totalBeds, 0);
        const occupiedBeds = rooms.reduce((sum, r) => sum + (r.totalBeds - r.availableBeds), 0);
        const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
        
        const activeResidents = await Occupancy.countDocuments({ 
            hostel: { $in: hostelIds }, 
            status: 'active' 
        });
        
        const pendingBookings = await Booking.countDocuments({ 
            hostel: { $in: hostelIds }, 
            status: 'pending' 
        });
        
        const confirmedBookings = await Booking.countDocuments({ 
            hostel: { $in: hostelIds }, 
            status: 'confirmed' 
        });
        
        const pendingMaintenance = await Maintenance.countDocuments({ 
            hostel: { $in: hostelIds }, 
            status: 'pending' 
        });
        
        const emergencyMaintenance = await Maintenance.countDocuments({ 
            hostel: { $in: hostelIds }, 
            priority: 'emergency',
            status: { $ne: 'completed' }
        });
        
        const pendingLeaveRequests = await LeaveRequest.countDocuments({ 
            hostel: { $in: hostelIds }, 
            status: 'pending' 
        });
        
        const pendingTransfers = await TransferRequest.countDocuments({
            $or: [
                { currentHostel: { $in: hostelIds }, status: 'pending' },
                { targetHostel: { $in: hostelIds }, status: { $in: ['pending', 'approved_by_owner'] } }
            ]
        });
        
        const payments = await Payment.find({ hostel: { $in: hostelIds } });
        const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
        
        const monthlyRevenue = await Payment.aggregate([
            { $match: { hostel: { $in: hostelIds }, status: 'completed' } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$paymentDate" } },
                    total: { $sum: "$amount" }
                }
            },
            { $sort: { _id: -1 } },
            { $limit: 6 }
        ]);
        
        const residentsByHostel = await Promise.all(hostels.map(async (hostel) => {
            const hostelRooms = await Room.find({ hostel: hostel._id });
            const totalBedsInHostel = hostelRooms.reduce((sum, r) => sum + r.totalBeds, 0);
            const occupiedBedsInHostel = hostelRooms.reduce((sum, r) => sum + (r.totalBeds - r.availableBeds), 0);
            
            return {
                hostelId: hostel._id,
                hostelName: hostel.name,
                totalBeds: totalBedsInHostel,
                occupiedBeds: occupiedBedsInHostel,
                occupancyRate: totalBedsInHostel > 0 ? Math.round((occupiedBedsInHostel / totalBedsInHostel) * 100) : 0
            };
        }));
        
        res.json({
            stats: {
                totalHostels: hostels.length,
                totalRooms,
                totalBeds,
                occupiedBeds,
                occupancyRate,
                activeResidents,
                pendingBookings,
                confirmedBookings,
                pendingMaintenance,
                emergencyMaintenance,
                pendingLeaveRequests,
                pendingTransfers,
                totalRevenue
            },
            monthlyRevenue,
            residentsByHostel,
            hostels
        });
        
    } catch (err) {
        console.error('Error fetching owner dashboard:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/dashboard', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const currentOccupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        const bookings = await Booking.find({ student: req.user.id })
            .populate('hostel', 'name')
            .populate('room', 'name')
            .sort('-createdAt');
        
        const pendingBookings = bookings.filter(b => b.status === 'pending').length;
        const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
        
        const maintenanceRequests = await Maintenance.find({ student: req.user.id })
            .sort('-createdAt');
        
        const pendingMaintenance = maintenanceRequests.filter(m => 
            m.status === 'pending' || m.status === 'in_progress'
        ).length;
        
        const leaveRequests = await LeaveRequest.find({ student: req.user.id })
            .sort('-createdAt');
        
        const pendingLeave = leaveRequests.filter(l => l.status === 'pending').length;
        
        const transferRequests = await TransferRequest.find({ student: req.user.id })
            .sort('-createdAt');
        
        const pendingTransfers = transferRequests.filter(t => 
            t.status === 'pending' || t.status === 'approved_by_owner' || t.status === 'approved_by_target_owner'
        ).length;
        
        const payments = await Payment.find({ student: req.user.id })
            .sort('-paymentDate');
        
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        
        let roommates = [];
        let allHostelResidents = [];
        
        if (currentOccupancy) {
            const roommatesList = await Occupancy.find({
                hostel: currentOccupancy.hostel._id,
                room: currentOccupancy.room._id,
                status: 'active',
                student: { $ne: req.user.id }
            }).populate('student', 'name email mobile profilePicture roommatePreferences');
            
            roommates = roommatesList.map(r => ({
                student: r.student,
                bedNumber: r.bedNumber,
                checkInDate: r.checkInDate,
                compatibilityScore: r.student.roommatePreferences ? 
                    calculateCompatibility(req.user, r.student) : null
            }));
            
            const allHostelOccupants = await Occupancy.find({
                hostel: currentOccupancy.hostel._id,
                status: 'active',
                student: { $ne: req.user.id }
            }).populate('student', 'name email mobile profilePicture')
              .populate('room', 'name roomNumber');
            
            const residentsByRoom = {};
            allHostelOccupants.forEach(occ => {
                const roomId = occ.room._id.toString();
                if (!residentsByRoom[roomId]) {
                    residentsByRoom[roomId] = {
                        roomId: occ.room._id,
                        roomName: occ.room.name,
                        roomNumber: occ.room.roomNumber,
                        residents: []
                    };
                }
                residentsByRoom[roomId].residents.push({
                    student: occ.student,
                    bedNumber: occ.bedNumber
                });
            });
            
            allHostelResidents = Object.values(residentsByRoom);
        }
        
        const now = new Date();
        const announcements = await Announcement.find({
            $or: [
                { targetAudience: 'everyone' },
                { targetAudience: 'students' },
                { targetedStudents: req.user.id }
            ],
            scheduledFor: { $lte: now },
            expiresAt: { $gt: now },
            isActive: true
        })
        .sort('-isImportant -createdAt')
        .limit(5);
        
        const unreadMessages = await Message.countDocuments({ 
            recipient: req.user.id, 
            isRead: false 
        });
        
        // NEW: Get AI conversation count
        const aiConversations = await Conversation.countDocuments({
            user: req.user.id,
            status: 'active'
        });
        
        res.json({
            currentResidence: currentOccupancy ? {
                hostel: currentOccupancy.hostel,
                room: currentOccupancy.room,
                bedNumber: currentOccupancy.bedNumber,
                checkInDate: currentOccupancy.checkInDate,
                expectedCheckOut: currentOccupancy.expectedCheckOutDate,
                depositPaid: currentOccupancy.depositPaid,
                status: 'Active Resident',
                totalRoommates: roommates.length,
                totalHostelResidents: allHostelResidents.reduce((acc, room) => acc + room.residents.length, 0)
            } : null,
            roommates,
            hostelResidents: allHostelResidents,
            stats: {
                totalBookings: bookings.length,
                pendingBookings,
                confirmedBookings,
                pendingMaintenance,
                pendingLeave,
                pendingTransfers,
                totalPaid,
                unreadMessages,
                aiConversations // NEW
            },
            recentAnnouncements: announcements,
            recentMaintenance: maintenanceRequests.slice(0, 3),
            recentPayments: payments.slice(0, 3)
        });
        
    } catch (err) {
        console.error('Error fetching student dashboard:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 19. STUDENT VISIBILITY FEATURES ====================
app.get('/api/student/hostel-mates', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const currentOccupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel');
        
        if (!currentOccupancy) {
            return res.status(404).json({ message: 'You are not currently a resident in any hostel' });
        }
        
        const hostelOccupants = await Occupancy.find({
            hostel: currentOccupancy.hostel._id,
            status: 'active',
            student: { $ne: req.user.id }
        })
        .populate('student', 'name email mobile profilePicture roommatePreferences')
        .populate('room', 'name roomNumber');
        
        const residentsByRoom = {};
        hostelOccupants.forEach(occ => {
            const roomId = occ.room._id.toString();
            if (!residentsByRoom[roomId]) {
                residentsByRoom[roomId] = {
                    roomId: occ.room._id,
                    roomName: occ.room.name,
                    roomNumber: occ.room.roomNumber,
                    residents: []
                };
            }
            
            const compatibility = occ.student.roommatePreferences ? 
                calculateCompatibility(req.user, occ.student) : null;
            
            residentsByRoom[roomId].residents.push({
                student: occ.student,
                bedNumber: occ.bedNumber,
                checkInDate: occ.checkInDate,
                compatibilityScore: compatibility
            });
        });
        
        const roommateRequests = await RoommateRequest.find({
            $or: [
                { requester: req.user.id },
                { recipient: req.user.id }
            ],
            status: { $in: ['pending', 'accepted'] }
        });
        
        const requestMap = {};
        roommateRequests.forEach(req => {
            const otherId = req.requester.toString() === req.user.id.toString() ? 
                req.recipient.toString() : req.requester.toString();
            requestMap[otherId] = {
                status: req.status,
                direction: req.requester.toString() === req.user.id.toString() ? 'sent' : 'received'
            };
        });
        
        Object.values(residentsByRoom).forEach(room => {
            room.residents.forEach(s => {
                const studentId = s.student._id.toString();
                if (requestMap[studentId]) {
                    s.roommateRequest = requestMap[studentId];
                }
            });
        });
        
        res.json({
            hostel: {
                id: currentOccupancy.hostel._id,
                name: currentOccupancy.hostel.name,
                location: currentOccupancy.hostel.location
            },
            totalResidents: hostelOccupants.length,
            rooms: Object.values(residentsByRoom)
        });
        
    } catch (err) {
        console.error('Error fetching hostel mates:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/room-mates', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Students only' });
    }
    
    try {
        const currentOccupancy = await Occupancy.findOne({ 
            student: req.user.id, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        if (!currentOccupancy) {
            return res.status(404).json({ message: 'You are not currently a resident in any room' });
        }
        
        const roommates = await Occupancy.find({
            hostel: currentOccupancy.hostel._id,
            room: currentOccupancy.room._id,
            status: 'active',
            student: { $ne: req.user.id }
        }).populate('student', 'name email mobile profilePicture roommatePreferences');
        
        const result = roommates.map(r => {
            const compatibility = r.student.roommatePreferences ? 
                calculateCompatibility(req.user, r.student) : null;
            
            return {
                student: r.student,
                bedNumber: r.bedNumber,
                checkInDate: r.checkInDate,
                compatibilityScore: compatibility
            };
        });
        
        result.sort((a, b) => a.bedNumber - b.bedNumber);
        
        res.json({
            hostel: {
                id: currentOccupancy.hostel._id,
                name: currentOccupancy.hostel.name
            },
            room: {
                id: currentOccupancy.room._id,
                name: currentOccupancy.room.name,
                roomNumber: currentOccupancy.room.roomNumber,
                totalBeds: currentOccupancy.room.totalBeds,
                yourBed: currentOccupancy.bedNumber
            },
            roommates: result
        });
        
    } catch (err) {
        console.error('Error fetching roommates:', err);
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/student/profile/:studentId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student' && req.user.role !== 'owner' && !req.user.isAdmin) {
        return res.status(403).json({ message: 'Access denied' });
    }
    
    try {
        const { studentId } = req.params;
        
        const student = await User.findOne({ 
            _id: studentId, 
            role: 'student' 
        }).select('-userPin');
        
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        
        const currentOccupancy = await Occupancy.findOne({ 
            student: studentId, 
            status: 'active' 
        }).populate('hostel').populate('room');
        
        let compatibility = null;
        if (req.user.role === 'student' && req.user.id !== studentId) {
            const currentUser = await User.findById(req.user.id);
            compatibility = calculateCompatibility(currentUser, student);
        }
        
        res.json({
            student: {
                _id: student._id,
                name: student.name,
                email: student.email,
                mobile: student.mobile,
                profilePicture: student.profilePicture,
                roommatePreferences: student.roommatePreferences
            },
            currentResidence: currentOccupancy ? {
                hostel: currentOccupancy.hostel,
                room: currentOccupancy.room,
                bedNumber: currentOccupancy.bedNumber,
                checkInDate: currentOccupancy.checkInDate
            } : null,
            compatibility
        });
        
    } catch (err) {
        console.error('Error fetching student profile:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 20. SEARCH & FILTER ====================
app.get('/api/admin/search/users', async (req, res) => {
    try {
        const { q, role } = req.query;
        let query = {};
        
        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
                { mobile: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }
        
        if (role) {
            query.role = role;
        }
        
        const users = await User.find(query).limit(50);
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/search/hostels', async (req, res) => {
    try {
        const { location, minPrice, maxPrice } = req.query;
        
        let query = {};
        
        if (location) {
            query.location = { $regex: location, $options: 'i' };
        }
        
        let roomQuery = {};
        if (minPrice || maxPrice) {
            roomQuery.pricePerBed = {};
            if (minPrice) roomQuery.pricePerBed.$gte = parseFloat(minPrice);
            if (maxPrice) roomQuery.pricePerBed.$lte = parseFloat(maxPrice);
        }
        
        const rooms = await Room.find(roomQuery).distinct('hostel');
        if (rooms.length > 0) {
            query._id = { $in: rooms };
        }
        
        const hostels = await Hostel.find(query)
            .populate('owner', 'name')
            .limit(50);
        
        res.json(hostels);
    } catch (err) {
        console.error('Error searching hostels:', err);
        res.status(500).json({ message: err.message });
    }
});

// ==================== 21. TEST ROUTE ====================
app.get('/api', (req, res) => {
    res.json({ 
        message: 'YIDANA HOSTELS API is running', 
        version: '5.0.0',
        features: [
            'User Management',
            'Hostel & Room Management',
            'Booking System',
            'Complaint System',
            'Announcement System',
            'Private Messaging',
            'Developer Profile',
            'Logo Upload',
            '✅ STREAMLINED RESIDENT MANAGEMENT',
            '✅ MAINTENANCE REQUESTS',
            '✅ ROOMMATE MATCHING',
            '✅ ROOM TRANSFER SYSTEM',
            '✅ PAYMENT TRACKING',
            '✅ ENHANCED DASHBOARDS',
            '✅ STUDENT VISIBILITY',
            '🤖 AI ASSISTANT (DeepSeek Integration) - NEW!'
        ]
    });
});

// ==================== ERROR HANDLING & 404 ====================
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ success: false, message: 'Something went wrong!' });
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📧 Admin Email: ${process.env.ADMIN_EMAIL}`);
    console.log(`📞 Admin Phone: ${process.env.ADMIN_PHONE}`);
    console.log(`🖼️  Uploads directory: /uploads/`);
    console.log(`👨‍💻 Developer profile management enabled`);
    console.log(`📢 Announcement system enabled`);
    console.log(`💬 Private messaging system enabled`);
    console.log(`🤖 DeepSeek AI Assistant: ${process.env.DEEPSEEK_API_KEY ? '✅ Enabled' : '❌ Disabled (API key missing)'}`);
    console.log(`✅ STREAMLINED RESIDENT MANAGEMENT ENABLED`);
    console.log(`   - Students become residents immediately upon owner approval`);
    console.log(`   - No separate check-in step needed`);
    console.log(`   - Students can request to leave`);
    console.log(`   - Owners can evict students`);
    console.log(`   - Room change requests supported`);
    console.log(`   - Student visibility (see who's in your hostel and room)`);
    console.log(`   - 🤖 AI Assistant ready to answer questions!`);
});