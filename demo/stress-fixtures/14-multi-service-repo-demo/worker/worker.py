import json
import os

QUEUE_PATH = os.environ.get("QUEUE_PATH", "queue.jsonl")
RESULT_PATH = os.environ.get("RESULT_PATH", "results.jsonl")


def drain_once():
    if not os.path.exists(QUEUE_PATH):
        return 0
    with open(QUEUE_PATH, "r", encoding="utf-8") as fp:
        jobs = [json.loads(line) for line in fp if line.strip()]
    if not jobs:
        return 0
    with open(RESULT_PATH, "a", encoding="utf-8") as fp:
        for job in jobs:
            fp.write(json.dumps({"text": job.get("text", ""), "length": len(job.get("text", ""))}) + "\n")
    open(QUEUE_PATH, "w").close()
    return len(jobs)


if __name__ == "__main__":
    print(f"processed {drain_once()} jobs")
