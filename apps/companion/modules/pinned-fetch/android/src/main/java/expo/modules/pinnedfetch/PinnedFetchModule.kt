package expo.modules.pinnedfetch

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.X509TrustManager

// Certificate-pinned HTTP for Git Gud hosts. A custom TrustManager accepts
// the chain iff SHA-256(leaf DER) == pinned fingerprint; hostname
// verification is replaced by the same pin (self-signed certs carry no
// usable SAN and the client may reach the host by IP, name or relay).
class PinnedFetchModule : Module() {
  private val streams = ConcurrentHashMap<String, Call>()

  override fun definition() = ModuleDefinition {
    Name("PinnedFetch")
    Events("chunk", "close")

    AsyncFunction("request") { url: String, method: String, headers: Map<String, String>, body: String?, fingerprintHex: String, timeoutMs: Double, promise: Promise ->
      Thread {
        try {
          val client = pinnedClient(fingerprintHex, timeoutMs.toLong())
          val b = Request.Builder().url(url)
          headers.forEach { (k, v) -> b.header(k, v) }
          val rb = if (method == "POST") (body ?: "").toRequestBody("application/json; charset=utf-8".toMediaType()) else null
          b.method(method, rb)
          client.newCall(b.build()).execute().use { resp ->
            promise.resolve(mapOf("status" to resp.code, "body" to (resp.body?.string() ?: "")))
          }
        } catch (e: SSLPeerUnverifiedException) {
          promise.reject("pin", "Certificate pin mismatch (expected ${fingerprintHex.take(16)}…)", e)
        } catch (e: Exception) {
          promise.reject("network", e.message ?: e.toString(), e)
        }
      }.start()
    }

    AsyncFunction("openStream") { id: String, url: String, headers: Map<String, String>, fingerprintHex: String, promise: Promise ->
      val client = pinnedClient(fingerprintHex, 0)
      val b = Request.Builder().url(url)
      headers.forEach { (k, v) -> b.header(k, v) }
      val call = client.newCall(b.build())
      streams[id] = call
      promise.resolve(null)
      Thread {
        try {
          call.execute().use { resp ->
            val src = resp.body?.source() ?: throw IllegalStateException("no body")
            val buf = ByteArray(8192)
            while (!src.exhausted()) {
              val n = src.read(buf)
              if (n > 0) sendEvent("chunk", mapOf("id" to id, "text" to String(buf, 0, n, Charsets.UTF_8)))
            }
            sendEvent("close", mapOf("id" to id))
          }
        } catch (e: SSLPeerUnverifiedException) {
          sendEvent("close", mapOf("id" to id, "error" to "Certificate pin mismatch"))
        } catch (e: Exception) {
          sendEvent("close", mapOf("id" to id, "error" to (e.message ?: e.toString())))
        } finally { streams.remove(id) }
      }.start()
    }

    Function("closeStream") { id: String -> streams.remove(id)?.cancel() }
  }

  private fun pinnedClient(fingerprintHex: String, timeoutMs: Long): OkHttpClient {
    val expected = fingerprintHex.uppercase()
    val tm = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw SSLPeerUnverifiedException("no certificate")
        val hex = MessageDigest.getInstance("SHA-256").digest(leaf.encoded).joinToString("") { "%02X".format(it) }
        if (hex != expected) throw SSLPeerUnverifiedException("Certificate pin mismatch")
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, arrayOf(tm), null)
    val b = OkHttpClient.Builder()
      .sslSocketFactory(ctx.socketFactory, tm)
      .hostnameVerifier { _, _ -> true } // identity is the pin, not the name
    if (timeoutMs > 0) b.callTimeout(timeoutMs, TimeUnit.MILLISECONDS) else b.readTimeout(0, TimeUnit.MILLISECONDS)
    return b.build()
  }
}
