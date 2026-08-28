import ExpoModulesCore
import CryptoKit
import Foundation

// Certificate-pinned HTTP for Git Gud hosts (self-signed certs). The trust
// decision ignores the system store entirely: the connection is accepted iff
// SHA-256(leaf certificate DER) == the pinned hex fingerprint.
public class PinnedFetchModule: Module {
  private var streams: [String: StreamTask] = [:]

  public func definition() -> ModuleDefinition {
    Name("PinnedFetch")
    Events("chunk", "close")

    // relayHost is accepted for API parity but not honoured: URLSession offers no way to
    // connect to one address while sending another SNI. iOS reaches hosts directly / via Tailscale.
    AsyncFunction("request") { (url: String, method: String, headers: [String: String], body: String?, fingerprintHex: String, timeoutMs: Double, relayHost: String?, promise: Promise) in
      if relayHost != nil { promise.reject("relay", "Relay connections are not supported on iOS yet"); return }
      guard let u = URL(string: url) else { promise.reject("bad_url", "Invalid URL"); return }
      var req = URLRequest(url: u)
      req.httpMethod = method
      req.timeoutInterval = timeoutMs / 1000
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
      if let b = body { req.httpBody = b.data(using: .utf8) }
      let delegate = PinDelegate(fingerprintHex: fingerprintHex)
      let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      let task = session.dataTask(with: req) { data, resp, err in
        defer { session.finishTasksAndInvalidate() }
        if let e = err {
          let ns = e as NSError
          let pinned = delegate.pinFailed
          promise.reject(pinned ? "pin" : "network", pinned ? "Certificate pin mismatch (expected \(fingerprintHex.prefix(16))…)" : ns.localizedDescription)
          return
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        promise.resolve(["status": status, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""])
      }
      task.resume()
    }

    AsyncFunction("openStream") { (id: String, url: String, headers: [String: String], fingerprintHex: String, relayHost: String?, promise: Promise) in
      if relayHost != nil { promise.reject("relay", "Relay connections are not supported on iOS yet"); return }
      guard let u = URL(string: url) else { promise.reject("bad_url", "Invalid URL"); return }
      var req = URLRequest(url: u)
      req.timeoutInterval = 60 * 60
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
      let st = StreamTask(fingerprintHex: fingerprintHex, onChunk: { [weak self] text in self?.sendEvent("chunk", ["id": id, "text": text]) },
                          onClose: { [weak self] err in self?.sendEvent("close", ["id": id, "error": err as Any]); self?.streams.removeValue(forKey: id) })
      self.streams[id] = st
      st.start(req)
      promise.resolve(nil)
    }

    Function("closeStream") { (id: String) in
      self.streams[id]?.cancel()
      self.streams.removeValue(forKey: id)
    }
  }
}

final class PinDelegate: NSObject, URLSessionDelegate {
  let fingerprintHex: String
  var pinFailed = false
  init(fingerprintHex: String) { self.fingerprintHex = fingerprintHex.uppercased() }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let leaf = leafCertificate(trust) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
    let der = SecCertificateCopyData(leaf) as Data
    let hex = SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined()
    if hex == fingerprintHex {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      pinFailed = true
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  private func leafCertificate(_ trust: SecTrust) -> SecCertificate? {
    if #available(iOS 15.0, *) { return (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first }
    return SecTrustGetCertificateAtIndex(trust, 0)
  }
}

// Streaming variant: forwards body chunks as they arrive (SSE).
final class StreamTask: NSObject, URLSessionDataDelegate {
  private let pin: PinDelegate
  private let onChunk: (String) -> Void
  private let onClose: (String?) -> Void
  private var session: URLSession?
  init(fingerprintHex: String, onChunk: @escaping (String) -> Void, onClose: @escaping (String?) -> Void) {
    self.pin = PinDelegate(fingerprintHex: fingerprintHex); self.onChunk = onChunk; self.onClose = onClose
  }
  func start(_ req: URLRequest) {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = 60 * 60
    session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    session?.dataTask(with: req).resume()
  }
  func cancel() { session?.invalidateAndCancel() }
  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    pin.urlSession(session, didReceive: challenge, completionHandler: completionHandler)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if let s = String(data: data, encoding: .utf8) { onChunk(s) }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    onClose(pin.pinFailed ? "Certificate pin mismatch" : error?.localizedDescription)
    session.finishTasksAndInvalidate()
  }
}
