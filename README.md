# NHAA 14566 — Sahayak AI SIH Prototype v2

## What is new in v2
- Voice-only, text-only, or text + voice input.
- Browser speech recognition produces a transcript for voice input.
- Explainable Python NLP layer extracts distress, anxiety, safety, isolation, urgency, legal and support signals.
- Working SVI from 0.00–1.00 with:
  - 0.00–0.24 LOW
  - 0.25–0.49 MODERATE
  - 0.50–0.74 HIGH
  - 0.75–1.00 CRITICAL
- Speech interaction signals: duration, word pace and inferred long pauses.
- Add missing information later to the SAME case.
- Every addition is appended to the narrative and the SVI is recalculated.
- Officer dashboard with case queue and human-review status.
- Local JSON storage: no MongoDB required for laptop demo.
- No API keys required.

## Run on Windows
1. Install Node.js LTS.
2. Install Python 3.10+ and add Python to PATH.
3. Extract this ZIP.
4. Double-click `START_WINDOWS.bat`.
5. Browser opens at `http://localhost:5000`.
6. Allow microphone permission for voice testing.

## Demo flow
Create Case → Consent → choose Text / Voice / Both → Analyze → SVI + risk + explainable factors → Add missing information → Re-analyze same Case → Officer Dashboard.

## NLP
The included Python service is a transparent prototype NLP screening layer. It is intentionally lightweight and deterministic so the laptop demo works without downloading a large model. For production/SIH architecture, the service can be replaced or augmented with a validated transformer model such as IndicBERT and representative multilingual training/validation data.

## Important
This is a screening/prioritization prototype, not a clinical diagnosis. AI output is a flag and recommendation for authorized human review. Production use requires consent, privacy controls, representative multilingual data, validation by qualified professionals, security testing and governance.

## Troubleshooting
- If the browser does not open, visit `http://localhost:5000`.
- If the page cannot connect, keep the backend terminal open and check its messages.
- If voice does not work, use Microsoft Edge or Google Chrome and allow microphone permission.
- If `python` is not recognized, reinstall Python with "Add Python to PATH".
