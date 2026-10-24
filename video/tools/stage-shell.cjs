// A 1440×810 Chromium window for recording a stage page (terminal, phone) with the director.
const { createHash, X509Certificate } = require("node:crypto");
const { app, BrowserWindow, session } = require("electron");

if (process.env.STAGE_USER_DATA) app.setPath("userData", process.env.STAGE_USER_DATA);
// The phone frame embeds the app from another origin; keep that frame in this process so the
// relaxed web security below reaches it too.
if (process.env.STAGE_INSECURE) app.commandLine.appendSwitch("disable-site-isolation-trials");

app.whenReady().then(() => {
  // The phone's web build cannot pin; trust the one daemon certificate the take names, as a browser would once accepted.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const fingerprint = createHash("sha256").update(new X509Certificate(request.certificate.data).raw).digest("base64url");
    callback(fingerprint === process.env.STAGE_TRUST ? 0 : -3);
  });
  // The phone's web build talks straight to the host, which sends no CORS headers; a phone has no such rule.
  if (process.env.STAGE_INSECURE) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      headers["Access-Control-Allow-Origin"] = ["*"];
      headers["Access-Control-Allow-Headers"] = ["Authorization, Content-Type, Accept"];
      headers["Access-Control-Allow-Methods"] = ["GET, POST, OPTIONS"];
      callback({ responseHeaders: headers, statusLine: details.method === "OPTIONS" ? "HTTP/1.1 204 No Content" : undefined });
    });
  }
  const webPreferences = process.env.STAGE_INSECURE ? { webSecurity: false } : {};
  const window = new BrowserWindow({ useContentSize: true, width: 1440, height: 810, backgroundColor: "#0d1117", webPreferences });
  window.loadURL(process.env.STAGE_URL);
});
