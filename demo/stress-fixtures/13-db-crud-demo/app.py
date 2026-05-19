import sqlite3
from flask import Flask, jsonify, request

DB_PATH = "data.db"

app = Flask(__name__)


def get_conn():
    return sqlite3.connect(DB_PATH)


with get_conn() as _c:
    _c.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT)")
    _c.commit()


@app.get("/notes")
def list_notes():
    with get_conn() as conn:
        rows = conn.execute("SELECT id, title, body FROM notes ORDER BY id DESC").fetchall()
    return jsonify([{"id": r[0], "title": r[1], "body": r[2]} for r in rows])


@app.post("/notes")
def create_note():
    body = request.get_json(silent=True) or {}
    title = body.get("title", "")
    text = body.get("body", "")
    with get_conn() as conn:
        cur = conn.execute("INSERT INTO notes(title, body) VALUES (?, ?)", (title, text))
        conn.commit()
        new_id = cur.lastrowid
    return jsonify({"id": new_id, "title": title, "body": text})


@app.delete("/notes/<int:note_id>")
def delete_note(note_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
