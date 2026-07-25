const express = require('express');
const session = require('express-session');
const path = require('path');
const { Client, RichPresence } = require('discord.js-selfbot-v13');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('views'));

app.use(session({
    secret: 'phamlongrpc_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

let rpcClients = {};
let rpcConfigs = {};

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/dashboard', (req, res) => {
    if (!req.session.token) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});
app.get('/dashboard/rpc', (req, res) => {
    if (!req.session.token) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views', 'rpc.html'));
});

app.post('/api/login', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    try {
        const client = new Client();
        await client.login(token);
        req.session.token = token;
        req.session.user = client.user;
        client.destroy();
        res.json({ success: true, user: client.user });
    } catch (error) {
        res.status(401).json({ error: 'Token không hợp lệ' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    const tokens = Object.keys(rpcClients);
    const running = tokens.filter(t => rpcClients[t]?.isReady());
    res.json({
        total: tokens.length,
        running: running.length,
        rpcs: tokens.map(token => ({
            token: token.slice(0, 10) + '...',
            name: rpcConfigs[token]?.name || 'Chưa đặt tên',
            status: rpcClients[token]?.isReady() ? 'running' : 'stopped'
        }))
    });
});

app.post('/api/start', async (req, res) => {
    const { token, config } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    if (!config?.name) return res.status(400).json({ error: 'Thiếu tên game' });

    if (rpcClients[token] && rpcClients[token].isReady()) {
        return res.json({ success: true, message: 'RPC đang chạy' });
    }

    try {
        const client = new Client();
        rpcClients[token] = client;
        rpcConfigs[token] = config;

        client.on('ready', () => {
            console.log(`✅ RPC: ${client.user.tag}`);
            setRPC(client, config);
        });

        client.on('error', () => {});
        await client.login(token);
        res.json({ success: true, message: 'RPC đã khởi động' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/stop', (req, res) => {
    const { token } = req.body;
    if (rpcClients[token]) {
        rpcClients[token].destroy();
        delete rpcClients[token];
        delete rpcConfigs[token];
    }
    res.json({ success: true });
});

function setRPC(client, config) {
    try {
        const APP_ID = '1527891272868692169';
        
        // ===== FIX: XỬ LÝ URL ẢNH =====
        let largeImage = config.largeImage || '';
        let smallImage = config.smallImage || '';
        
        // Nếu là URL và KHÔNG có https://, tự động thêm vào
        if (largeImage && !largeImage.startsWith('http://') && !largeImage.startsWith('https://')) {
            // Nếu không có http:// -> coi là Asset Key (tên ảnh), giữ nguyên
            // Không làm gì cả
        }
        
        // Nếu là URL, giữ nguyên
        // Nếu là Asset Key, giữ nguyên
        
        const rpc = new RichPresence(client)
            .setApplicationId(APP_ID)
            .setType(config.type || 'PLAYING')
            .setName(config.name)
            .setDetails(config.details || '')
            .setState(config.state || '')
            .setAssetsLargeImage(largeImage)
            .setAssetsLargeText(config.largeText || '')
            .setAssetsSmallImage(smallImage)
            .setAssetsSmallText(config.smallText || '')
            .setStartTimestamp(config.startTimestamp || Date.now());

        // ===== FIX: XỬ LÝ BUTTON URL =====
        if (config.buttons && config.buttons.length > 0) {
            config.buttons.forEach(btn => {
                if (btn.label && btn.label.trim() !== '' && btn.url && btn.url.trim() !== '') {
                    let url = btn.url.trim();
                    // Tự động thêm https:// nếu thiếu
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                    }
                    rpc.addButton(btn.label, url);
                }
            });
        }

        client.user.setPresence({
            activities: [rpc],
            status: config.status || 'online'
        });
        console.log('✅ RPC đã cập nhật');
    } catch (error) {
        console.log('❌ Lỗi RPC:', error.message);
        // Log chi tiết lỗi để debug
        console.log('Config gây lỗi:', JSON.stringify(config, null, 2));
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Pham Long RPC đang chạy tại: http://localhost:${PORT}`);
});
