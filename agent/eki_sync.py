#!/usr/bin/env python3
"""
STT Logistika agent for the office PC (Windows, macOS or Linux; Python 3.8+, no extra packages).

Every minute it:
  1. (optional) runs your existing PDF → CSV scraper on every new invoice PDF in PDF_DIR,
  2. takes the newest CSV in WATCH_DIR and, if it is different from the last one sent, uploads it to the app
     (Zalihe shows what changed since the previous export),
  3. (optional) reads new emails from the company mailbox (IMAP) and sends them to the app's Prijem, where they are
     sorted into orders, customers' emails and the rest. Newsletters and automatic mail are skipped.

Nothing is uploaded when nothing changed, so checking every minute costs nothing.
Settings live in config.ini next to this file (copy config.example.ini). Run:  python eki_sync.py
Test once and exit:                                                          python eki_sync.py --once
"""
import configparser
import email
import email.header
import email.utils
import hashlib
import imaplib
import json
import logging
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from html import unescape
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / ".eki_sync_state.json"
LOG_FILE = HERE / "eki_sync.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
log = logging.getLogger("eki_sync")


def load_config():
    cfg = configparser.ConfigParser()
    path = HERE / "config.ini"
    if not path.exists():
        sys.exit(f"Nema {path}. Kopiraj config.example.ini u config.ini i popuni ga.")
    cfg.read(path, encoding="utf-8")
    return cfg


def load_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def post(url, data, headers):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"message": body[:300]}


# ---------------------------------------------------------------- 1. PDF → CSV with your own script
def run_scraper(cfg, state):
    sec = cfg["zalihe"]
    pdf_dir = sec.get("pdf_dir", "").strip()
    cmd = sec.get("scraper_cmd", "").strip()
    if not pdf_dir or not cmd:
        return
    done = set(state.get("scraped_pdfs", []))
    out_dir = Path(sec.get("watch_dir"))
    for pdf in sorted(Path(pdf_dir).glob("*.pdf"), key=lambda p: p.stat().st_mtime):
        key = f"{pdf.name}|{pdf.stat().st_size}|{int(pdf.stat().st_mtime)}"
        if key in done or not stable(pdf):
            continue
        csv_path = out_dir / (pdf.stem + ".csv")
        full = cmd.replace("{pdf}", str(pdf)).replace("{csv}", str(csv_path))
        log.info("Skripta: %s", full)
        try:
            subprocess.run(full if os.name == "nt" else shlex.split(full), shell=(os.name == "nt"), check=True, timeout=300, cwd=str(out_dir))
            done.add(key)
        except Exception as e:
            log.error("Skripta nije uspjela za %s: %s", pdf.name, e)
    state["scraped_pdfs"] = sorted(done)[-2000:]


def stable(path, wait=2.0):
    """A file that is still being written changes size; wait until it stops."""
    try:
        a = path.stat().st_size
        time.sleep(wait)
        return a == path.stat().st_size and a > 0
    except FileNotFoundError:
        return False


def decode(raw):
    for enc in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


# ---------------------------------------------------------------- 2. newest CSV → the app
def sync_stock(cfg, state):
    sec = cfg["zalihe"]
    watch = Path(sec.get("watch_dir", "")).expanduser()
    if not watch.is_dir():
        log.warning("Folder s izvozima ne postoji: %s", watch)
        return
    files = [p for p in watch.glob(sec.get("pattern", "*.csv")) if p.is_file()]
    if not files:
        return
    newest = max(files, key=lambda p: p.stat().st_mtime)
    if not stable(newest):
        return
    raw = newest.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest == state.get("last_csv_hash"):
        return
    text = decode(raw)
    url = cfg["app"]["url"].rstrip("/") + "/api/integrations/stock"
    status, body = post(url, text.encode("utf-8"), {
        "Authorization": "Bearer " + cfg["app"]["stock_token"],
        "Content-Type": "text/csv; charset=utf-8",
        "X-Filename": urllib.parse.quote(newest.name),
    })
    if status == 200:
        state["last_csv_hash"] = digest
        if body.get("unchanged"):
            log.info("%s: isto kao prethodni izvoz", newest.name)
        elif body.get("baseline"):
            log.info("%s: poslano kao prvi (osnovni) izvoz", newest.name)
        else:
            log.info("%s: poslano, %s promjena", newest.name, body.get("changes"))
    else:
        log.error("Slanje %s nije uspjelo (%s): %s", newest.name, status, body.get("message") or body.get("error"))


# ---------------------------------------------------------------- 3. order emails over IMAP → Prijem
def header(msg, name):
    v = msg.get(name, "")
    parts = []
    for text, enc in email.header.decode_header(v):
        parts.append(text.decode(enc or "utf-8", "replace") if isinstance(text, bytes) else text)
    return "".join(parts).strip()


def body_parts(msg):
    """The plain-text and the HTML part of an email (either may be None)."""
    plain, html = None, None
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == "multipart" or part.get("Content-Disposition", "").startswith("attachment"):
            continue
        try:
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            text = payload.decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:
            continue
        if part.get_content_type() == "text/plain" and plain is None:
            plain = text
        elif part.get_content_type() == "text/html" and html is None:
            html = text
    return plain, html


def body_text(msg):
    plain, html = body_parts(msg)
    if plain:
        return plain.strip()
    if html:
        t = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
        t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", t)
        return unescape(re.sub(r"<[^>]+>", "", t)).strip()
    return ""


ORDER_WORDS = re.compile(r"(narud[zž]b|porud[zž]b|naru[cč]uj|naru[cč]i|\border\b|predra[cč]un)", re.I)


def is_bulk(msg):
    """Newsletters, mailing lists and automatic replies."""
    return bool(msg.get("List-Unsubscribe") or re.search(r"bulk|list|junk", msg.get("Precedence", ""), re.I)
                or (msg.get("Auto-Submitted") and msg.get("Auto-Submitted", "").lower() != "no"))


def sync_folder(box, sec, folder, state, inbound, ignore_from, skip_bulk):
    key = f"imap:{sec['imap_user']}@{sec['imap_host']}/{folder}"
    seen = state.get(key, {})
    typ, _ = box.select('"' + folder + '"', readonly=True)
    if typ != "OK":
        log.error("IMAP folder %s ne postoji", folder)
        return
    uidvalidity = box.response("UIDVALIDITY")[1][0]
    uidvalidity = uidvalidity.decode() if isinstance(uidvalidity, bytes) else str(uidvalidity)
    if seen.get("uidvalidity") != uidvalidity:
        seen = {"uidvalidity": uidvalidity, "last_uid": 0}
    since = (datetime.now() - timedelta(days=int(sec.get("since_days", "3")))).strftime("%d-%b-%Y")
    typ, data = box.uid("search", None, "SINCE", since)
    uids = [int(u) for u in (data[0] or b"").split()]
    new = [u for u in uids if u > int(seen.get("last_uid", 0))]
    if not seen.get("last_uid") and sec.get("skip_existing", "yes").lower() in ("yes", "da", "true", "1"):
        # First run: start from now, don't import the whole folder.
        seen["last_uid"] = max(uids) if uids else 0
        new = []
        log.info("IMAP: početak praćenja foldera %s (postojeći emailovi preskočeni)", folder)
    for uid in sorted(new):
        typ, msgdata = box.uid("fetch", str(uid), "(BODY.PEEK[])")
        if typ != "OK" or not msgdata or not isinstance(msgdata[0], tuple):
            continue
        msg = email.message_from_bytes(msgdata[0][1])
        sender = header(msg, "From")
        subject = header(msg, "Subject")
        seen["last_uid"] = uid
        if any(x and x in sender.lower() for x in ignore_from):
            log.info("Preskočeno (ignore_from): %s", subject[:80])
            continue
        if skip_bulk and is_bulk(msg) and not ORDER_WORDS.search(subject):
            log.info("Preskočeno (newsletter/automatski): %s", subject[:80])
            continue
        plain, html = body_parts(msg)
        payload = {
            "from": sender,
            "to": header(msg, "To"),
            "subject": subject,
            "date": header(msg, "Date"),
            "messageId": header(msg, "Message-ID") or f"imap-{uidvalidity}-{uid}",
            "text": body_text(msg)[:20000],
            # The app reads shop order emails (tables) best from the HTML.
            "html": (html or "")[:100000] if not plain else "",
            "bulk": is_bulk(msg),
        }
        status, body = post(inbound, json.dumps(payload).encode("utf-8"), {"Content-Type": "application/json"})
        if status == 200:
            log.info("Email poslan u prijem: %s", subject[:80])
        else:
            log.error("Email nije poslan (%s): %s", status, body)
            seen["last_uid"] = uid - 1  # try this one again next time
            break
    state[key] = seen


def sync_email(cfg, state):
    if not cfg.has_section("email") or not cfg["email"].get("imap_host", "").strip():
        return
    sec = cfg["email"]
    inbound = sec.get("inbound_url", "").strip()
    if not inbound:
        log.warning("email.inbound_url nije postavljen (kopiraj adresu iz Postavke → Integracije).")
        return
    folders = [f.strip() for f in (sec.get("folders") or sec.get("folder") or "INBOX").split(",") if f.strip()]
    ignore_from = [x.strip().lower() for x in sec.get("ignore_from", "").split(",") if x.strip()]
    skip_bulk = sec.get("skip_bulk", "no").lower() in ("yes", "da", "true", "1")
    try:
        box = imaplib.IMAP4_SSL(sec["imap_host"], int(sec.get("imap_port", "993")))
        box.login(sec["imap_user"], sec["imap_password"])
        for folder in folders:
            try:
                sync_folder(box, sec, folder, state, inbound, ignore_from, skip_bulk)
            except Exception as e:
                log.error("IMAP folder %s: %s", folder, e)
        box.logout()
    except Exception as e:
        log.error("IMAP greška: %s", e)


def main():
    cfg = load_config()
    once = "--once" in sys.argv
    interval = int(cfg["app"].get("interval_seconds", "60"))
    log.info("STT Logistika agent pokrenut. Provjera svakih %s s.", interval)
    while True:
        state = load_state()
        for step in (run_scraper, sync_stock, sync_email):
            try:
                step(cfg, state)
            except Exception as e:
                log.exception("Greška u %s: %s", step.__name__, e)
        save_state(state)
        if once:
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()
