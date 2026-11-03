package com.questline.mobile

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.Window
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import java.io.File

@InvokeArg
class HapticArgs {
  var kind: String = "tap"
}

@InvokeArg
class BarsArgs {
  var color: String = "#FFFDF4"
  var dark: Boolean = false
}

@InvokeArg
class OrientationArgs {
  var mode: String = "auto"
}

@InvokeArg
class AuthArgs {
  var scopes: List<String> = listOf()
  var interactive: Boolean = true
}

@InvokeArg
class TokenArgs {
  var token: String = ""
}

@InvokeArg
class ApkArgs {
  var path: String = ""
}

/** What Rust gets back from a sign-in. */
@InvokeArg
class Grant(val accessToken: String, val grantedScopes: List<String>)

/** FileProvider under our own name, so it never clashes with another library's. */
class QlFileProvider : FileProvider()

@TauriPlugin
class QuestlinePlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private var backAdded = false

  override fun load(webView: WebView) {
    this.webView = webView
    activity.runOnUiThread {
      fitSystemBars()
      addBackHandler()
    }
  }

  // ------------------------------------------------------------ layout

  /** Keep the page clear of the status bar, navigation bar, notch and keyboard. */
  private fun fitSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(activity.window, false)
    val content = activity.findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val types = WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout() or
        WindowInsetsCompat.Type.ime()
      val i = insets.getInsets(types)
      v.setPadding(i.left, i.top, i.right, i.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  /** Back button: let the page close a dialog or go back a page first; otherwise leave the app running. */
  private fun addBackHandler() {
    if (backAdded) return
    val act = activity as? AppCompatActivity ?: return
    backAdded = true
    act.onBackPressedDispatcher.addCallback(act, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView
        if (wv == null) {
          act.moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript(
          "(function(){try{return !!(window.Q&&Q.mobile&&Q.mobile.back())}catch(e){return false}})()"
        ) { handled ->
          if (handled != "true") act.moveTaskToBack(true)
        }
      }
    })
  }

  @Command
  fun haptic(invoke: Invoke) {
    val args = invoke.parseArgs(HapticArgs::class.java)
    activity.runOnUiThread {
      val kind = when (args.kind) {
        "success" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS
        "error" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        "heavy" -> HapticFeedbackConstants.LONG_PRESS
        else -> HapticFeedbackConstants.VIRTUAL_KEY
      }
      val target: View = webView ?: activity.window.decorView
      target.performHapticFeedback(kind)
      invoke.resolve()
    }
  }

  @Command
  fun setBars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    activity.runOnUiThread {
      try {
        val color = Color.parseColor(args.color)
        activity.findViewById<View>(android.R.id.content)?.setBackgroundColor(color)
        activity.window.decorView.setBackgroundColor(color)
        paintLegacyBars(activity.window, color)
        val ctl = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        ctl.isAppearanceLightStatusBars = !args.dark
        ctl.isAppearanceLightNavigationBars = !args.dark
      } catch (e: Exception) {
        // A colour Android can't parse: keep the current bars.
      }
      invoke.resolve()
    }
  }

  /** Focus mode: hold the screen in portrait or landscape; "auto" follows the phone again. */
  @Command
  fun setOrientation(invoke: Invoke) {
    val args = invoke.parseArgs(OrientationArgs::class.java)
    activity.runOnUiThread {
      activity.requestedOrientation = when (args.mode) {
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
      invoke.resolve()
    }
  }

  /** Before Android 15 the bars have their own colour; from 15 on they show the view behind them. */
  @Suppress("DEPRECATION")
  private fun paintLegacyBars(window: Window, color: Int) {
    window.statusBarColor = color
    window.navigationBarColor = color
  }

  // ------------------------------------------------------------ Google sign-in

  /**
   * Gets a Google access token for the given scopes. With interactive = false it never
   * shows anything: it only succeeds if access was granted before (used to renew tokens).
   */
  @Command
  fun authorize(invoke: Invoke) {
    val args = invoke.parseArgs(AuthArgs::class.java)
    val request = AuthorizationRequest.builder()
      .setRequestedScopes(args.scopes.map { Scope(it) })
      .build()
    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result ->
        if (result.hasResolution()) {
          val pending = result.pendingIntent
          if (!args.interactive || pending == null) {
            invoke.reject("Sign in to Google again in Settings.", "NEEDS_SIGN_IN")
          } else {
            activity.runOnUiThread {
              startIntentSenderForResult(
                invoke,
                IntentSenderRequest.Builder(pending.intentSender).build(),
                "authResult"
              )
            }
          }
        } else {
          finishAuth(invoke, result)
        }
      }
      .addOnFailureListener { e ->
        invoke.reject("Google sign-in failed: ${e.message}", e)
      }
  }

  @ActivityCallback
  private fun authResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.reject("Sign-in was cancelled.")
      return
    }
    try {
      val auth = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data)
      finishAuth(invoke, auth)
    } catch (e: Exception) {
      invoke.reject("Google sign-in failed: ${e.message}", e)
    }
  }

  private fun finishAuth(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrEmpty()) {
      invoke.reject("Google didn't return an access token.")
      return
    }
    invoke.resolveObject(Grant(token, result.grantedScopes))
  }

  /** Forget a cached token (after it was rejected, or on sign-out). */
  @Command
  fun clearToken(invoke: Invoke) {
    val args = invoke.parseArgs(TokenArgs::class.java)
    Thread {
      try {
        GoogleAuthUtil.clearToken(activity.applicationContext, args.token)
      } catch (e: Exception) {
        // Already gone.
      }
      invoke.resolve()
    }.start()
  }

  // ------------------------------------------------------------ updates

  /** Opens Android's installer for a downloaded update. */
  @Command
  fun installApk(invoke: Invoke) {
    val args = invoke.parseArgs(ApkArgs::class.java)
    activity.runOnUiThread {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          !activity.packageManager.canRequestPackageInstalls()
        ) {
          val settings = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + activity.packageName)
          )
          activity.startActivity(settings)
          invoke.reject(
            "Allow Questline to install updates on the screen that just opened, then tap Update again.",
            "NEEDS_PERMISSION"
          )
        } else {
          val uri = FileProvider.getUriForFile(activity, activity.packageName + ".ql.files", File(args.path))
          val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          activity.startActivity(intent)
          invoke.resolve()
        }
      } catch (e: Exception) {
        invoke.reject("Couldn't open the installer: ${e.message}", e)
      }
    }
  }
}
