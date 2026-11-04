package com.questline.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject

/*
 * Questline's home-screen widget: today's dailies and reminders.
 *
 * The app writes a snapshot of today (WidgetStore.save) whenever something
 * changes; the widget only draws that. Tapping a row ticks it right away in
 * the snapshot and adds it to a queue, which the app applies (with rewards)
 * the next time it opens. The + button opens the app's Quick add.
 */

/** Snapshot and tick queue, kept in the app's private preferences. */
object WidgetStore {
  private const val PREFS = "ql_widget"
  private const val SNAPSHOT = "snapshot"
  private const val QUEUE = "queue"
  private const val ACTION = "action"

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun snapshot(ctx: Context): JSONObject? =
    try {
      prefs(ctx).getString(SNAPSHOT, null)?.let { JSONObject(it) }
    } catch (e: Exception) {
      null
    }

  fun save(ctx: Context, json: String) {
    prefs(ctx).edit().putString(SNAPSHOT, json).apply()
    QlWidgetProvider.refreshAll(ctx)
  }

  /** Marks a row done/undone in the snapshot and remembers it for the app. */
  @Synchronized
  fun tick(ctx: Context, kind: String, id: String) {
    val snap = snapshot(ctx) ?: return
    val items = snap.optJSONArray("items") ?: return
    var newDone = true
    for (i in 0 until items.length()) {
      val it = items.getJSONObject(i)
      if (it.optString("kind") == kind && it.optString("id") == id) {
        newDone = !it.optBoolean("done")
        it.put("done", newDone)
        if (kind == "daily") snap.put("done", (snap.optInt("done") + if (newDone) 1 else -1).coerceAtLeast(0))
      }
    }
    val queue = try {
      JSONArray(prefs(ctx).getString(QUEUE, "[]"))
    } catch (e: Exception) {
      JSONArray()
    }
    // Only the latest tick per row matters.
    val kept = JSONArray()
    for (i in 0 until queue.length()) {
      val q = queue.getJSONObject(i)
      if (!(q.optString("kind") == kind && q.optString("id") == id)) kept.put(q)
    }
    kept.put(
      JSONObject()
        .put("kind", kind)
        .put("id", id)
        .put("done", newDone)
        .put("day", snap.optString("day"))
        .put("at", System.currentTimeMillis())
    )
    prefs(ctx).edit().putString(SNAPSHOT, snap.toString()).putString(QUEUE, kept.toString()).apply()
  }

  /** Hands the queued ticks (and a pending "quick add") to the app and clears them. */
  @Synchronized
  fun take(ctx: Context): Pair<JSONArray, String?> {
    val p = prefs(ctx)
    val queue = try {
      JSONArray(p.getString(QUEUE, "[]"))
    } catch (e: Exception) {
      JSONArray()
    }
    val action = p.getString(ACTION, null)
    p.edit().remove(QUEUE).remove(ACTION).apply()
    return Pair(queue, action)
  }

  fun setAction(ctx: Context, action: String) {
    prefs(ctx).edit().putString(ACTION, action).apply()
  }
}

class QlWidgetProvider : AppWidgetProvider() {
  companion object {
    const val ACTION_TICK = "com.questline.mobile.WIDGET_TICK"
    const val EXTRA_KIND = "ql_kind"
    const val EXTRA_ID = "ql_id"
    const val EXTRA_LAUNCH = "ql_action"

    private fun mutableFlag(): Int = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
    private const val IMMUTABLE = PendingIntent.FLAG_IMMUTABLE

    fun refreshAll(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = mgr.getAppWidgetIds(ComponentName(ctx, QlWidgetProvider::class.java))
      if (ids.isEmpty()) return
      for (id in ids) render(ctx, mgr, id)
      @Suppress("DEPRECATION")
      mgr.notifyAppWidgetViewDataChanged(ids, R.id.ql_list)
    }

    /** Opens Questline; with an action ("quickadd") the app does that when it's in front. */
    private fun openApp(ctx: Context, action: String?, request: Int): PendingIntent? {
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      if (action != null) launch.putExtra(EXTRA_LAUNCH, action)
      return PendingIntent.getActivity(ctx, request, launch, PendingIntent.FLAG_UPDATE_CURRENT or IMMUTABLE)
    }

    fun render(ctx: Context, mgr: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(ctx.packageName, R.layout.ql_widget)
      val snap = WidgetStore.snapshot(ctx)
      val stale = snap == null || System.currentTimeMillis() >= snap.optLong("dayEnd", 0L)

      if (snap == null) {
        views.setTextViewText(R.id.ql_title, ctx.getString(R.string.ql_widget_today))
        views.setTextViewText(R.id.ql_sub, ctx.getString(R.string.ql_widget_open_app))
        views.setTextViewText(R.id.ql_count, "")
      } else {
        views.setTextViewText(R.id.ql_title, snap.optString("title", ctx.getString(R.string.ql_widget_today)))
        views.setTextViewText(
          R.id.ql_sub,
          if (stale) ctx.getString(R.string.ql_widget_new_day)
          else ctx.getString(R.string.ql_widget_stats, snap.optInt("level", 1), snap.optInt("hp"), snap.optInt("maxHp"), snap.optInt("gold"))
        )
        views.setTextViewText(R.id.ql_count, if (stale) "" else "${snap.optInt("done")}/${snap.optInt("total")}")
      }
      views.setTextViewText(R.id.ql_empty, ctx.getString(if (stale) R.string.ql_widget_new_day else R.string.ql_widget_empty))

      // The list rows come from QlWidgetService; the data URI keeps one adapter per widget.
      val svc = Intent(ctx, QlWidgetService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
      @Suppress("DEPRECATION")
      views.setRemoteAdapter(R.id.ql_list, svc)
      views.setEmptyView(R.id.ql_list, R.id.ql_empty)

      // Row taps: one template; each row fills in its kind and id.
      val tick = Intent(ctx, QlWidgetProvider::class.java).setAction(ACTION_TICK)
      views.setPendingIntentTemplate(
        R.id.ql_list,
        PendingIntent.getBroadcast(ctx, widgetId, tick, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag())
      )
      openApp(ctx, null, 1)?.let {
        views.setOnClickPendingIntent(R.id.ql_head, it)
        views.setOnClickPendingIntent(R.id.ql_empty, it)
      }
      openApp(ctx, "quickadd", 2)?.let { views.setOnClickPendingIntent(R.id.ql_add, it) }
      mgr.updateAppWidget(widgetId, views)
    }
  }

  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(ctx, mgr, id)
    @Suppress("DEPRECATION")
    mgr.notifyAppWidgetViewDataChanged(ids, R.id.ql_list)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action == ACTION_TICK) {
      val kind = intent.getStringExtra(EXTRA_KIND)
      val id = intent.getStringExtra(EXTRA_ID)
      if (kind != null && id != null) {
        WidgetStore.tick(ctx, kind, id)
        refreshAll(ctx)
      }
      return
    }
    super.onReceive(ctx, intent)
  }
}

/** Supplies the widget's list rows. */
class QlWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = QlWidgetFactory(applicationContext)
}

class QlWidgetFactory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<JSONObject> = emptyList()

  override fun onCreate() {}
  override fun onDestroy() {}

  override fun onDataSetChanged() {
    val snap = WidgetStore.snapshot(ctx)
    rows = if (snap == null || System.currentTimeMillis() >= snap.optLong("dayEnd", 0L)) {
      emptyList()
    } else {
      val items = snap.optJSONArray("items") ?: JSONArray()
      (0 until items.length()).map { items.getJSONObject(it) }
    }
  }

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val row = rows.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.ql_widget_row)
    val v = RemoteViews(ctx.packageName, R.layout.ql_widget_row)
    val done = row.optBoolean("done")
    val reminder = row.optString("kind") == "reminder"
    // Done rows are struck through (a span survives the trip to the launcher).
    val title = SpannableString(row.optString("title"))
    if (done) title.setSpan(StrikethroughSpan(), 0, title.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    v.setTextViewText(R.id.ql_row_title, title)
    v.setTextViewText(R.id.ql_row_time, row.optString("time"))
    v.setViewVisibility(R.id.ql_row_time, if (row.optString("time").isEmpty()) View.GONE else View.VISIBLE)
    v.setImageViewResource(
      R.id.ql_row_check,
      when {
        done -> R.drawable.ql_check_on
        reminder -> R.drawable.ql_bell
        else -> R.drawable.ql_check_off
      }
    )
    v.setTextColor(
      R.id.ql_row_title,
      ctx.getColor(if (done) R.color.ql_w_ink_soft else R.color.ql_w_ink)
    )
    v.setTextColor(
      R.id.ql_row_time,
      ctx.getColor(if (row.optBoolean("late") && !done) R.color.ql_w_late else R.color.ql_w_ink_soft)
    )
    val fill = Intent()
      .putExtra(QlWidgetProvider.EXTRA_KIND, row.optString("kind"))
      .putExtra(QlWidgetProvider.EXTRA_ID, row.optString("id"))
    v.setOnClickFillInIntent(R.id.ql_row, fill)
    return v
  }

  override fun getLoadingView(): RemoteViews? = null
  override fun getViewTypeCount(): Int = 1
  override fun getItemId(position: Int): Long = position.toLong()
  override fun hasStableIds(): Boolean = false
}
