const express = require('express');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { makeid } = require('./gen-id');
const { upload } = require('./mega');

const router = express.Router();

// Utility to safely delete temp files
function removeFile(path) {
  if (fs.existsSync(path)) {
    fs.rmSync(path, { recursive: true, force: true });
  }
}

// === MAIN PAIRING HANDLER ===
router.get('/', async (req, res) => {
  const id = makeid();
  const num = (req.query.number || '').replace(/[^0-9]/g, '');

  async function startPairing() {
    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);

    try {
      const browsers = ['Safari', 'Chrome', 'Firefox'];
      const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'silent' }).child({ level: 'silent' })
          )
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS(randomBrowser),
      });

      // If the user is not registered, request a pair code
      if (!sock.authState.creds.registered) {
        await delay(1500);
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) res.send({ code });
      }

      // Save credentials on update
      sock.ev.on('creds.update', saveCreds);

      // Connection handler
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          console.log(`👤 ${sock.user.id} connected successfully`);

          await delay(4000);
          const credsPath = `./temp/${id}/creds.json`;
          const credsData = fs.readFileSync(credsPath);

          // Generate random session ID prefix
          const prefix = '3EB';
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let randomSession = prefix;
          for (let i = prefix.length; i < 22; i++) {
            randomSession += chars.charAt(Math.floor(Math.random() * chars.length));
          }

          try {
            const megaURL = await upload(fs.createReadStream(credsPath), `${sock.user.id}.json`);
            const sessionId = megaURL.replace('https://mega.nz/file/', '');
            const sessionText = `BRAVO~${sessionId}`;

            const codeMsg = await sock.sendMessage(sock.user.id, { text: sessionText });

            const infoMsg = `
👋🏻 *Hey there, NAPPIER-XMD User!*

✅ Your session has been successfully created!

🔐 *Session ID:* Sent above  
⚠️ *Keep it safe!* Do NOT share it with anyone.

———
*📢 Stay Updated:*  
Join our official WhatsApp Channel  
🔗 https://whatsapp.com/channel/0029Vb7PDezLdQefWzPPIq1Z

*💻 Source Code:*  
GitHub Repository  
🔗 https://github.com/micha-l-dev/NAPPIER-XMD

———
> *© Powered by Kathara*  
Stay cool and hack smart ✌🏻
`;

            await sock.sendMessage(
              sock.user.id,
              {
                text: infoMsg,
                contextInfo: {
                  externalAdReply: {
                    title: 'NAPPIER-XMD',
                    thumbnailUrl: 'https://files.catbox.moe/25lh7r.png',
                    sourceUrl: 'https://whatsapp.com/channel/0029Vb7PDezLdQefWzPPIq1Z',
                    mediaType: 1,
                    renderLargerThumbnail: true
                  }
                }
              },
              { quoted: codeMsg }
            );
          } catch (err) {
            console.error('Error sending session:', err);
            await sock.sendMessage(sock.user.id, { text: `⚠️ Error: ${err.message}` });
          }

          await delay(10);
          await sock.ws.close();
          removeFile(`./temp/${id}`);
          console.log('✅ Session closed and cleaned up.');
          process.exit();

        } else if (
          connection === 'close' &&
          lastDisconnect?.error?.output?.statusCode !== 401
        ) {
          console.log('🔁 Connection closed, retrying...');
          removeFile(`./temp/${id}`);
          await delay(2000);
          startPairing();
        }
      });
    } catch (err) {
      console.error('⚠️ Error restarting service:', err);
      removeFile(`./temp/${id}`);
      if (!res.headersSent) res.send({ code: '❗ Service Unavailable' });
    }
  }

  await startPairing();
});

module.exports = router;
