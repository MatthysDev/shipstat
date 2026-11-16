package expo.modules.shipstat

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Persistent FIFO of serialized events. Only used from ShipstatCore's executor. */
internal class EventStore(context: Context) :
  SQLiteOpenHelper(context, "shipstat_events.db", null, 1) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  override fun onConfigure(db: SQLiteDatabase) {
    db.enableWriteAheadLogging()
  }

  fun insert(body: String) {
    writableDatabase.insert("events", null, ContentValues().apply { put("body", body) })
  }

  fun count(): Int =
    readableDatabase.rawQuery("SELECT COUNT(*) FROM events", null).use { c ->
      if (c.moveToFirst()) c.getInt(0) else 0
    }

  fun peek(limit: Int): List<Pair<Long, String>> =
    readableDatabase.rawQuery("SELECT seq, body FROM events ORDER BY seq LIMIT ?", arrayOf(limit.toString())).use { c ->
      val rows = ArrayList<Pair<Long, String>>(c.count)
      while (c.moveToNext()) rows.add(c.getLong(0) to c.getString(1))
      rows
    }

  fun deleteUpTo(seq: Long) {
    writableDatabase.delete("events", "seq <= ?", arrayOf(seq.toString()))
  }

  fun clear() {
    writableDatabase.delete("events", null, null)
  }

  /** Keeps only the newest `max` events. Uses the primary key index, no full scan. */
  fun trimTo(max: Int) {
    writableDatabase.execSQL(
      "DELETE FROM events WHERE seq < (SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?)",
      arrayOf<Any>(max - 1)
    )
  }
}
