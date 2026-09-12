const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const selfsigned = require('selfsigned');
const serveStatic = require('./mini-static');
const { WebSocketServer } = require('ws');

const HTTPS_PORT = process.env.PORT || 8443;
const HTTP_PORT = process.env.HTTP_PORT || 8080;
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CAMERAS_PATH = path.join(__dirname, 'cameras.json');

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {

      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function ensureCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return {
      cert: fs.readFileSync(CERT_PATH),
      key: fs.readFileSync(KEY_PATH),
    };
  }
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  const ips = getLanIPs();
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];

  console.log('Generando certificado autofirmado para:', ['localhost', '127.0.0.1', ...ips].join(', '));

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'obs-dual-iphone-cam.local' }],
    {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        {
          name: 'keyUsage',
          keyCertSign: true,
          digitalSignature: true,
          nonRepudiation: true,
          keyEncipherment: true,
          dataEncipherment: true,
        },
        { name: 'subjectAltName', altNames },
      ],
    }
  );

  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  return { cert: pems.cert, key: pems.private };
}

function requestHandler(req, res) {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/cameras' && req.method === 'GET') return handleListCameras(req, res);
  if (urlPath === '/api/cameras/rename' && req.method === 'POST') return handleRenameCamera(req, res);
  if (urlPath === '/api/cameras/add' && req.method === 'POST') return handleAddCamera(req, res);
  if (urlPath === '/api/cameras/resolve-pin' && req.method === 'POST') return handleResolvePin(req, res);
  if (urlPath === '/api/cameras/settings' && req.method === 'POST') return handleUpdateSettings(req, res);
  if (urlPath === '/api/tunnel/start' && req.method === 'POST') return handleTunnelStart(req, res);
  if (urlPath === '/api/tunnel/stop' && req.method === 'POST') return handleTunnelStop(req, res);
  if (urlPath === '/api/tunnel/status' && req.method === 'GET') return handleTunnelStatus(req, res);
  serveStatic(req, res, PUBLIC_DIR);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function loadCameras() {
  try {
    return JSON.parse(fs.readFileSync(CAMERAS_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}
let cameras = loadCameras();
function saveCameras() {
  try { fs.writeFileSync(CAMERAS_PATH, JSON.stringify(cameras, null, 2)); } catch (e) {
    console.error('No se pudo guardar cameras.json:', e.message);
  }
}

function proximoIdLibre() {

  const usados = new Set([...rooms.keys(), ...Object.keys(cameras), ...claimedIds]);
  let n = 1;
  while (usados.has(`cam${n}`)) n++;
  return `cam${n}`;
}
const claimedIds = new Set();

function generarPin() {
  const pinsUsados = new Set(Object.values(cameras).map((c) => c.pin).filter(Boolean));
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pinsUsados.has(pin));
  return pin;
}

function handleListCameras(req, res) {
  const allIds = new Set(Object.keys(cameras));
  for (const [id, room] of rooms) {
    if (room.sender) allIds.add(id);
  }
  const lista = [...allIds].map((id) => {
    const info = cameras[id] || {};
    return {
      id,
      name: info.name || id,
      pin: info.pin || null,
      connected: Boolean(rooms.get(id) && rooms.get(id).sender),

      settings: info.settings || null,
    };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  sendJson(res, 200, { cameras: lista });
}

async function handleRenameCamera(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!id) return sendJson(res, 400, { error: 'falta id' });
  if (name) {

    const previo = cameras[id];
    cameras[id] = { name, pin: previo ? previo.pin : null, settings: previo ? previo.settings : undefined };
  } else {
    delete cameras[id];
  }
  saveCameras();
  sendJson(res, 200, { ok: true, id, name: (cameras[id] && cameras[id].name) || id });
}

function handleAddCamera(req, res) {
  const id = proximoIdLibre();
  claimedIds.add(id);
  const n = (id.match(/\d+$/) || ['?'])[0];
  const pin = generarPin();
  cameras[id] = { name: `Cámara ${n}`, pin };
  saveCameras();
  sendJson(res, 200, { id, name: cameras[id].name, pin });
}

async function handleResolvePin(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!pin) return sendJson(res, 400, { error: 'falta pin' });
  const encontrado = Object.entries(cameras).find(([, info]) => info.pin === pin);
  if (!encontrado) return sendJson(res, 404, { error: 'PIN no encontrado' });
  const [id, info] = encontrado;
  sendJson(res, 200, { id, name: info.name });
}

async function handleUpdateSettings(req, res) {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : null;
  if (!id || !settings) return sendJson(res, 400, { error: 'falta id o settings' });
  if (!cameras[id]) return sendJson(res, 200, { ok: false });
  cameras[id].settings = { ...(cameras[id].settings || {}), ...settings };
  saveCameras();
  sendJson(res, 200, { ok: true });
}

let tunnelProcess = null;
let tunnelUrl = null;
let tunnelStarting = false;
let tunnelError = null;

function handleTunnelStart(req, res) {
  if (tunnelProcess) return sendJson(res, 200, { running: true, url: tunnelUrl, starting: tunnelStarting });
  tunnelStarting = true;
  tunnelUrl = null;
  tunnelError = null;
  tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${HTTP_PORT}`, '--no-autoupdate']);

  const buscarUrl = (chunk) => {
    const texto = chunk.toString();
    const m = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) {
      tunnelUrl = m[0];
      tunnelStarting = false;
      console.log(`[tunnel] URL pública lista: ${tunnelUrl}`);
    }
  };
  tunnelProcess.stdout.on('data', buscarUrl);
  tunnelProcess.stderr.on('data', buscarUrl);

  tunnelProcess.on('exit', (code) => {
    console.log(`[tunnel] cloudflared terminó (code=${code})`);
    tunnelProcess = null;
    tunnelUrl = null;
    tunnelStarting = false;
  });
  tunnelProcess.on('error', (err) => {

    console.error('[tunnel] no se pudo lanzar cloudflared:', err.message);
    tunnelError = err.code === 'ENOENT'
      ? 'cloudflared no está instalado en este Mac (o no está en el PATH). Instalar con: brew install cloudflared'
      : `No se pudo iniciar cloudflared: ${err.message}`;
    tunnelProcess = null;
    tunnelUrl = null;
    tunnelStarting = false;
  });

  sendJson(res, 200, { running: true, url: null, starting: true });
}

function handleTunnelStop(req, res) {
  if (tunnelProcess) tunnelProcess.kill();
  tunnelProcess = null;
  tunnelUrl = null;
  tunnelStarting = false;
  tunnelError = null;
  sendJson(res, 200, { running: false, url: null, starting: false });
}

function handleTunnelStatus(req, res) {
  sendJson(res, 200, { running: Boolean(tunnelProcess), url: tunnelUrl, starting: tunnelStarting, error: tunnelError });
}

const { cert, key } = ensureCert();
const httpsServer = https.createServer({ cert, key }, requestHandler);
const httpServer = http.createServer(requestHandler);

const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { sender: null, receivers: new Map() });
  return rooms.get(id);
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function attachSignaling(server, label) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.meta = { role: null, ids: new Set() };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }

      if (msg.type === 'register') {

        if (typeof msg.id !== 'string' || !msg.id) return;
        ws.meta.role = msg.role;
        ws.meta.ids.add(msg.id);
        const room = getRoom(msg.id);
        if (msg.role === 'sender') {
          room.sender = ws;
          console.log(`[${label}] sender conectado -> id="${msg.id}"`);

          for (const receiverId of room.receivers.keys()) {
            safeSend(ws, { type: 'request-offer', id: msg.id, receiverId });
          }
        } else if (msg.role === 'receiver') {
          if (typeof msg.receiverId !== 'string' || !msg.receiverId) return;
          ws.meta.receiverId = msg.receiverId;
          room.receivers.set(msg.receiverId, ws);
          console.log(`[${label}] receiver conectado -> id="${msg.id}" (total: ${room.receivers.size})`);
          if (room.sender) safeSend(room.sender, { type: 'request-offer', id: msg.id, receiverId: msg.receiverId });
        }
        return;
      }

      const room = rooms.get(msg.id);
      if (!room) return;

      if (msg.type === 'offer') {

        safeSend(room.receivers.get(msg.receiverId), msg);
      } else if (msg.type === 'answer') {
        safeSend(room.sender, msg);
      } else if (msg.type === 'ice') {
        if (msg.from === 'sender') {
          safeSend(room.receivers.get(msg.receiverId), msg);
        } else {
          safeSend(room.sender, msg);
        }
      } else if (msg.type === 'control') {

        console.log(`[control] id="${msg.id}" settings=${JSON.stringify(msg.settings)} sender_conectado=${Boolean(room.sender)}`);
        safeSend(room.sender, msg);
      }
    });

    ws.on('close', () => {
      const { role, ids, receiverId } = ws.meta;
      ids.forEach((id) => {
        const room = rooms.get(id);
        if (!room) return;
        if (role === 'sender' && room.sender === ws) {
          room.sender = null;
          room.receivers.forEach((r) => safeSend(r, { type: 'sender-gone', id }));
          console.log(`[${label}] desconexion sender id="${id}"`);
        } else if (role === 'receiver' && receiverId) {
          room.receivers.delete(receiverId);
          console.log(`[${label}] desconexion receiver id="${id}" (quedan: ${room.receivers.size})`);
        }

        if (!room.sender && room.receivers.size === 0) rooms.delete(id);
      });
    });
  });
}

attachSignaling(httpsServer, 'https');
attachSignaling(httpServer, 'http');

httpsServer.listen(HTTPS_PORT, () => {
  const ips = getLanIPs();
  console.log('');
  console.log('=== OBS Dual iPhone Cam ===');
  console.log('');
  console.log(`HTTPS (para los iPhones) escuchando en el puerto ${HTTPS_PORT}`);
  console.log(`HTTP (para OBS/estudio, sin certificado) escuchando en el puerto ${HTTP_PORT}`);
  console.log('');
  if (ips.length === 0) {
    console.log('(no se detectó ninguna IP de red local; conecta el Mac a la WiFi)');
  } else {
    console.log('1. Estudio (crear cámaras, ver su PIN, controlar todo a distancia):');
    ips.forEach((ip) => console.log(`   http://${ip}:${HTTP_PORT}/studio.html`));
    console.log('');
    console.log('2. En cada iPhone (Safari) — misma URL para todos, cada uno mete su PIN:');
    ips.forEach((ip) => console.log(`   https://${ip}:${HTTPS_PORT}/sender.html`));
    console.log('   Safari avisará "conexión no privada" (certificado autofirmado):');
    console.log('   toca "Mostrar detalles" -> "visitar este sitio web" -> "Visitar sitio web".');
    console.log('');
    console.log('3. En OBS, fuente "Navegador" apuntando a:');
    ips.forEach((ip) => console.log(`   http://${ip}:${HTTP_PORT}/receiver.html`));
  }
  console.log('');
});

httpServer.listen(HTTP_PORT, () => {});
