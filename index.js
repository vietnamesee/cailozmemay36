const express = require('express');
const session = require('express-session');
const path = require('path');
const { Client, RichPresence } = require('discord.js-selfbot-v13');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
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
let rpcIntervals = {};

// ===== ROUTES =====
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

// ===== API: LOGIN =====
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

// ===== API: LẤY DANH SÁCH TOKEN =====
app.get('/api/tokens', (req, res) => {
    const tokenList = Object.keys(rpcClients).map(token => ({
        token: token.slice(0, 15) + '...',
        fullToken: token,
        tag: rpcClients[token]?.user?.tag || 'Đang kết nối...',
        isReady: rpcClients[token]?.isReady() || false
    }));
    res.json({ tokens: tokenList, total: tokenList.length });
});

// ===== API: DỪNG TOKEN =====
app.post('/api/stop-token', (req, res) => {
    const { token } = req.body;
    if (rpcClients[token]) {
        if (rpcIntervals[token]) {
            clearInterval(rpcIntervals[token]);
            delete rpcIntervals[token];
        }
        rpcClients[token].destroy();
        delete rpcClients[token];
        delete rpcConfigs[token];
    }
    res.json({ success: true });
});

// ===== API: LẤY STATUS =====
app.get('/api/status', (req, res) => {
    const tokens = Object.keys(rpcClients);
    const running = tokens.filter(t => rpcClients[t]?.isReady());
    res.json({
        total: tokens.length,
        running: running.length,
        rpcs: tokens.map(token => ({
            token: token.slice(0, 10) + '...',
            fullToken: token,
            name: rpcConfigs[token]?.name || 'Chưa đặt tên',
            status: rpcClients[token]?.isReady() ? 'running' : 'stopped',
            isReady: rpcClients[token]?.isReady() || false
        }))
    });
});

// ===== API: BẬT RPC =====
app.post('/api/start', async (req, res) => {
    const { token, config } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    if (!config?.appId) return res.status(400).json({ error: 'Thiếu App ID' });
    if (!config?.name) return res.status(400).json({ error: 'Thiếu tên game' });

    if (rpcClients[token] && rpcClients[token].isReady()) {
        if (rpcIntervals[token]) {
            clearInterval(rpcIntervals[token]);
            delete rpcIntervals[token];
        }
        rpcClients[token].destroy();
        delete rpcClients[token];
        delete rpcConfigs[token];
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
        const client = new Client();
        rpcClients[token] = client;
        rpcConfigs[token] = config;

        client.on('ready', () => {
            console.log(`✅ RPC: ${client.user.tag}`);
            setRPC(client, token);
        });

        client.on('error', (err) => {
            console.log(`❌ Lỗi: ${err.message}`);
        });

        await client.login(token);
        res.json({ success: true, message: '✅ RPC đã khởi động!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== API: TẮT RPC =====
app.post('/api/stop', (req, res) => {
    const { token } = req.body;
    if (rpcClients[token]) {
        if (rpcIntervals[token]) {
            clearInterval(rpcIntervals[token]);
            delete rpcIntervals[token];
        }
        rpcClients[token].destroy();
        delete rpcClients[token];
        delete rpcConfigs[token];
    }
    res.json({ success: true, message: '✅ Đã tắt RPC' });
});

// ===== HÀM SET RPC (CHỈ SET ĐÚNG NHỮNG GÌ WEB GỬI LÊN) =====
function setRPC(client, token) {
    const config = rpcConfigs[token];

    if (rpcIntervals[token]) {
        clearInterval(rpcIntervals[token]);
        delete rpcIntervals[token];
    }

    const updatePresence = () => {
        try {
            if (!client || !client.isReady()) return;

            const rpc = new RichPresence(client)
                .setApplicationId(config.appId)
                .setType(config.type || 'PLAYING')
                .setName(config.name)
                .setDetails(config.details || '')
                .setState(config.state || '')
                .setAssetsLargeImage(config.largeImage || '')
                .setAssetsLargeText(config.largeText || '')
                .setAssetsSmallImage(config.smallImage || '')
                .setAssetsSmallText(config.smallText || '')
                .setStartTimestamp(config.startTimestamp || Date.now());

            if (config.buttons && config.buttons.length > 0) {
                config.buttons.forEach(btn => {
                    if (btn.label && btn.label.trim() !== '' && btn.url && btn.url.trim() !== '') {
                        let url = btn.url.trim();
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                        }
                        try {
                            rpc.addButton(btn.label, url);
                        } catch (e) {}
                    }
                });
            }

            client.user.setPresence({
                activities: [rpc],
                status: config.status || 'online'
            });
            
            console.log(`   📌 ${config.name}: ${config.details || 'No details'}`);
        } catch (error) {
            console.log(`   ❌ Lỗi RPC: ${error.message}`);
        }
    };

    setTimeout(updatePresence, 2000);
    rpcIntervals[token] = setInterval(updatePresence, 30000);
}

app.listen(PORT, () => {
    console.log(`🚀 Pham Long RPC đang chạy tại: http://localhost:${PORT}`);
});
