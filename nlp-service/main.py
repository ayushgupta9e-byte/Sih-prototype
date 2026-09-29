import json, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Transparent prototype NLP lexicons. Replace/augment with a validated model
# (e.g. IndicBERT/transformer + speech model) for production deployment.
LEXICONS = {
    "distress": ["scared", "afraid", "fear", "frightened", "distress", "distressed",
                 "upset", "overwhelmed", "helpless", "panic", "worried", "worry",
                 "डर", "डरी", "डरा", "डर लग", "डर रहा", "डर रही", "darr", "dar", "darr lag", "dar lag", "scared", "fear", "चिंता", "परेशान", "घबराहट", "घबराया", "ghabra", "ghabrahat", "pareshan"],
    "anxiety": ["anxious", "anxiety", "nervous", "tension", "stress", "restless",
                "चिंतित", "तनाव", "बेचैनी", "chintit", "tension", "tanav", "bechain", "anxious", "anxiety"],
    "isolation": ["alone", "isolated", "no one", "nobody", "social boycott", "excluded",
                  "अकेला", "अकेली", "बहिष्कार"],
    "safety": ["unsafe", "danger", "threat", "threatened", "harassed", "intimidated",
               "सुरक्षित नहीं", "खतरा", "धमकी", "डराया", "उत्पीड़न", "khatra", "dhamki", "threat", "threatened", "violence", "violent", "maar", "marna", "unsafe", "safety"],
    "urgent": ["immediate", "urgent", "emergency", "right now", "help now",
               "तुरंत", "आपातकाल", "अभी मदद", "turant", "emergency", "urgent", "help now", "abhi madad"],
    "legal": ["police", "lawyer", "legal", "court", "complaint", "case", "एफआईआर", "पुलिस", "वकील", "कानूनी"],
    "support": ["support", "counselling", "counseling", "doctor", "medical", "family",
                "friend", "help", "सहायता", "परामर्श", "डॉक्टर", "मदद"],
}

NEGATIONS = {"not", "no", "never", "don't", "dont", "isn't", "isnt", "cannot",
             "can't", "cant", "नहीं", "मत"}

def normalize(text):
    text = text or ""
    text = re.sub(r"\s+", " ", text).strip()
    return text

def phrase_hits(text, phrases):
    lower = text.lower()
    hits = []
    for p in phrases:
        if p.lower() in lower:
            hits.append(p)
    return hits

def negation_near(text, phrase):
    lower = text.lower()
    pos = lower.find(phrase.lower())
    if pos < 0: return False
    window = lower[max(0, pos-45):pos]
    return any(n in window.split() for n in NEGATIONS)

def nlp_features(text):
    text = normalize(text)
    words = re.findall(r"[\w\u0900-\u097F']+", text.lower())
    word_count = len(words)
    sentences = max(1, len(re.findall(r"[.!?।]+", text))) if text else 0
    features = {}
    all_hits = []

    for category, lex in LEXICONS.items():
        raw = phrase_hits(text, lex)
        valid = [h for h in raw if not negation_near(text, h)]
        features[category] = {"count": len(valid), "signals": valid[:8]}
        all_hits += [(category, h) for h in valid]

    # Simple intent/entity cues: these are explainable NLP signals, not a diagnosis.
    requested = []
    if features["legal"]["count"] > 0: requested.append("legal_aid")
    if features["safety"]["count"] > 0: requested.append("safety_review")
    if features["support"]["count"] > 0 or features["distress"]["count"] > 0: requested.append("counselling")
    if "doctor" in text.lower() or "medical" in text.lower() or "डॉक्टर" in text: requested.append("medical_assistance")

    # Negation-aware distress signal density.
    # Category contributions are capped, so repeating the same word does not
    # artificially inflate the score. Multiple independent risk categories
    # accumulate into the SVI. This is a transparent demo formula, not a
    # clinically validated instrument.
    # SVI v3: category-level scoring. Multiple words from the SAME category
    # must not stack repeatedly (e.g. "threat", "violence", and "safety" are
    # all safety signals). This prevents double-counting and score inflation.
    # Each category contributes once when it is present.
    category_weights = {
        "distress": 0.22,
        "anxiety": 0.14,
        "safety": 0.28,
        "isolation": 0.10,
        "urgent": 0.20,
    }
    category_scores = {
        cat: (weight if features[cat]["count"] > 0 else 0.0)
        for cat, weight in category_weights.items()
    }
    nlp_score = sum(category_scores.values())

    # Context bonuses reward combinations of independent risk dimensions,
    # rather than repeated keywords. Bonuses are deliberately bounded.
    active = sum(1 for v in category_scores.values() if v > 0)
    if active >= 3:
        nlp_score += 0.08
    if features["safety"]["count"] and features["distress"]["count"]:
        nlp_score += 0.04
    nlp_score = min(1.0, nlp_score)

    return {
        "wordCount": word_count,
        "sentenceCount": sentences,
        "signals": features,
        "entitiesAndNeeds": sorted(set(requested)),
        "matchedSignals": [{"category": c, "term": h} for c, h in all_hits[:20]],
        "nlpScore": round(nlp_score, 3),
    }

def speech_score(voice):
    if not voice: return 0.0, []
    word_count = float(voice.get("wordCount", 0) or 0)
    duration = float(voice.get("durationSec", 0) or 0)
    pauses = float(voice.get("pauseCount", 0) or 0)
    pace = (word_count / duration * 60.0) if duration > 0 else 0.0
    signals = []
    score = 0.0

    # Interaction-level signals only; not a clinical voice diagnosis.
    if pauses >= 3:
        score += min(0.18, pauses * 0.03)
        signals.append("frequent_long_pauses")
    if pace > 190:
        score += 0.08
        signals.append("fast_speech")
    elif 0 < pace < 75 and word_count >= 6:
        score += 0.06
        signals.append("slow_speech")
    return min(1.0, score), signals

def assess(payload):
    narrative = normalize(payload.get("narrative", ""))
    voice = payload.get("voice") or {}
    nlp = nlp_features(narrative)
    sp_score, sp_signals = speech_score(voice)

    # Multimodal SVI. Text/NLP is the primary explainable signal;
    # speech interaction features add a bounded contribution when available.
    text_score = nlp["nlpScore"]
    if narrative and voice:
        svi = min(1.0, 0.78 * text_score + 0.22 * sp_score)
        mode = "BOTH"
    elif voice:
        # Voice-only still uses the transcript produced by browser speech recognition.
        svi = min(1.0, 0.78 * text_score + 0.22 * sp_score)
        mode = "VOICE"
    else:
        svi = text_score
        mode = "TEXT"

    # Ensure non-empty meaningful input does not collapse to an unexplained 0.0.
    # Neutral narratives can legitimately produce a low score.
    if narrative and svi < 0.005:
        svi = 0.01

    if svi <= 0.34: risk = "LOW"
    elif svi <= 0.59: risk = "MODERATE"
    elif svi <= 0.79: risk = "HIGH"
    else: risk = "CRITICAL"

    recommendations = []
    if risk in ("HIGH", "CRITICAL"):
        recommendations.append("Priority human review")
    if "counselling" in nlp["entitiesAndNeeds"] or risk in ("MODERATE","HIGH","CRITICAL"):
        recommendations.append("Counselling / psychosocial support review")
    if "legal_aid" in nlp["entitiesAndNeeds"]:
        recommendations.append("Legal aid review")
    if "medical_assistance" in nlp["entitiesAndNeeds"]:
        recommendations.append("Medical assistance review")
    if "safety_review" in nlp["entitiesAndNeeds"] or "urgent" in nlp["signals"] and nlp["signals"]["urgent"]["count"]:
        recommendations.append("Safety and protection pathway review")
    if not recommendations:
        recommendations.append("Standard human review")

    factors = []
    for cat, obj in nlp["signals"].items():
        if obj["count"]:
            factors.append(f"{cat}: {', '.join(obj['signals'])}")
    factors.extend(sp_signals)
    if not factors:
        factors.append("No strong distress/vulnerability language signal detected")

    return {
        "svi": round(svi, 2),
        "risk": risk,
        "inputModeDetected": mode,
        "nlp": nlp,
        "speech": {
            "score": round(sp_score, 3),
            "signals": sp_signals,
            "paceWpm": round((float(voice.get("wordCount",0) or 0) / float(voice.get("durationSec",1) or 1) * 60), 1) if voice and float(voice.get("durationSec",0) or 0) > 0 else 0
        },
        "explainableFactors": factors,
        "recommendations": recommendations,
        "humanReviewRequired": True,
        "note": "Prototype screening only; not a clinical diagnosis. Final decisions remain with authorized human personnel."
    }

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._send(200, {"ok": True, "service": "NLP"})
        return self._send(404, {"error":"Not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/analyze":
            return self._send(404, {"error":"Not found"})
        try:
            length = int(self.headers.get("Content-Length","0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            return self._send(200, assess(payload))
        except Exception as e:
            return self._send(400, {"error": str(e)})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    print(f"NLP service running on http://127.0.0.1:{port}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
