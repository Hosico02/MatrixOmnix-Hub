import json
import os
from flask import Flask, jsonify, request

QUEUE_PATH = os.environ.get("QUEUE_PATH", "queue.jsonl")

app = Flask(__name__)


@app.post("/jobs")
def enqueue():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "")
    job = {"text": text}
    with open(QUEUE_PATH, "a", encoding="utf-8") as fp:
        fp.write(json.dumps(job) + "\n")
    return jsonify({"queued": True, "job": job})


if __name__ == "__main__":
    app.run(debug=True)
