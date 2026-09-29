const $ = id => document.getElementById(id);
let currentCase = null;
let recognition = null;
let voiceStart = 0;
let lastResultAt = 0;
let pauseCount = 0;
let voiceWords = 0;
let voiceText = "";

document.querySelectorAll(".nav").forEach(b => b.onclick = () => {
  document.querySelectorAll(".nav").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
  $(b.dataset.page).classList.add("active");
  if (b.dataset.page === "dashboard") loadCases();
});

$("mode").onchange = syncMode;
function syncMode() {
  const m = $("mode").value;
  $("textBox").style.display = m === "voice" ? "none" : "block";
  $("voiceBox").style.display = m === "text" ? "none" : "block";
}
syncMode();

function makeVoiceSession(additionMode=false) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("This browser does not support Speech Recognition. Try Microsoft Edge or Google Chrome.");
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = $("language").value === "Hindi" ? "hi-IN" : "en-IN";
  voiceStart = Date.now();
  lastResultAt = voiceStart;
  pauseCount = 0;
  voiceWords = 0;
  voiceText = "";

  recognition.onstart = () => {
    if (additionMode) $("additionVoiceStatus").textContent = "Listening… speak now.";
    else $("voiceStatus").textContent = "Listening… speak now.";
    $("startVoice").disabled = true;
    $("stopVoice").disabled = false;
  };
  recognition.onresult = event => {
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) finalText += chunk + " ";
      else interim += chunk + " ";
    }
    const now = Date.now();
    if (now - lastResultAt > 1800 && voiceText.trim()) pauseCount++;
    lastResultAt = now;
    if (finalText) {
      voiceText += finalText;
      voiceWords += finalText.trim().split(/\s+/).filter(Boolean).length;
    }
    const display = (voiceText + interim).trim();
    if (additionMode) $("addition").value = display;
    else $("voiceTranscript").textContent = display || "Listening…";
  };
  recognition.onerror = e => {
    if (additionMode) $("additionVoiceStatus").textContent = "Voice error: " + e.error;
    else $("voiceStatus").textContent = "Voice error: " + e.error;
  };
  recognition.onend = () => {
    const durationSec = Math.max(1, (Date.now()-voiceStart)/1000);
    const data = { transcript: voiceText.trim(), durationSec, wordCount: voiceWords, pauseCount };
    if (additionMode) {
      $("addition").value = voiceText.trim();
      $("addition").dataset.voiceJson = JSON.stringify(data);
      $("additionVoiceStatus").textContent = `Voice captured • ${voiceWords} words • ${durationSec.toFixed(1)} sec`;
    } else {
      $("voiceTranscript").textContent = voiceText.trim() || "No speech captured.";
      $("voiceTranscript").dataset.voiceJson = JSON.stringify(data);
      $("voiceStatus").textContent = `Voice captured • ${voiceWords} words • ${durationSec.toFixed(1)} sec`;
    }
    $("startVoice").disabled = false;
    $("stopVoice").disabled = true;
  };
  recognition.start();
}

$("startVoice").onclick = () => makeVoiceSession(false);
$("stopVoice").onclick = () => recognition && recognition.stop();
$("addVoice").onclick = () => makeVoiceSession(true);

function getVoiceData() {
  try { return JSON.parse($("voiceTranscript").dataset.voiceJson || "null"); } catch { return null; }
}

async function post(url, body) {
  const r = await fetch(url, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}

$("analyze").onclick = async () => {
  $("error").textContent = "";
  if (!$("consent").checked) { $("error").textContent = "Please provide consent before starting the prototype assessment."; return; }
  const mode = $("mode").value;
  let narrative = $("narrative").value.trim();
  const voice = getVoiceData();
  if (mode === "voice" && voice) narrative = voice.transcript;
  if (mode === "both" && voice) narrative = [narrative, voice.transcript].filter(Boolean).join("\n\n");
  if (!narrative) { $("error").textContent = "Please provide text, voice, or both."; return; }

  try {
    $("analyze").disabled = true;
    currentCase = await post("/api/cases", {
      consent: true,
      language: $("language").value,
      inputMode: mode,
      narrative,
      voice
    });
    renderAssessment(currentCase);
    $("updateCard").classList.remove("hidden");
    $("detailCard").classList.remove("hidden");
  } catch(e) {
    $("error").textContent = e.message;
  } finally { $("analyze").disabled = false; }
};

$("addText").onclick = async () => {
  if (!currentCase) return;
  const addition = $("addition").value.trim();
  if (!addition) return;
  try {
    const voiceUpdate = (() => { try { return JSON.parse($("addition").dataset.voiceJson || "null"); } catch { return null; }})();
    currentCase = await post(`/api/cases/${encodeURIComponent(currentCase.caseId)}/add`, {
      addition, source: voiceUpdate ? "voice" : "text", voiceUpdate
    });
    $("addition").value = "";
    delete $("addition").dataset.voiceJson;
    $("additionVoiceStatus").textContent = "";
    renderAssessment(currentCase);
  } catch(e) { $("error").textContent = e.message; }
};

function renderAssessment(c) {
  const a = c.assessment;
  $("svi").textContent = Number(a.svi).toFixed(2);
  $("risk").textContent = a.risk;
  $("barFill").style.width = Math.min(100, Number(a.svi)*100) + "%";
  $("factors").innerHTML = "<b>Explainable NLP / speech factors:</b><br>" +
    a.explainableFactors.map(x => "• " + escapeHtml(x)).join("<br>");
  $("recommendations").innerHTML = a.recommendations.map(x => `<li>${escapeHtml(x)}</li>`).join("");
  $("caseId").textContent = "Case ID: " + c.caseId;
  $("timeline").innerHTML =
    `<div class="timelineItem"><b>Created</b><br>${new Date(c.createdAt).toLocaleString()}<br>Initial narrative analyzed.</div>` +
    c.additions.map(x => `<div class="timelineItem"><b>Added information</b><br>${new Date(x.at).toLocaleString()}<br>${escapeHtml(x.text)}</div>`).join("") +
    `<div class="timelineItem"><b>Current assessment</b><br>SVI ${Number(a.svi).toFixed(2)} • ${a.risk}<br>${escapeHtml(a.note)}</div>`;
}

async function loadCases() {
  const r = await fetch("/api/cases");
  const cases = await r.json();
  $("cases").innerHTML = cases.length ? cases.map(c => `
    <div class="case ${c.risk==="CRITICAL"?"danger":""}">
      <div><b>${c.caseId}</b><div class="muted">${new Date(c.updatedAt).toLocaleString()} • ${c.inputMode} • ${c.language}</div>
      <div class="muted">Review: ${c.reviewStatus}</div></div>
      <div class="score">${Number(c.svi).toFixed(2)}<div class="muted">${c.risk}</div>
      <button class="smallBtn" onclick="openCase('${c.caseId}')">Open</button></div>
    </div>`).join("") : "<div class='card'>No cases yet.</div>";
}

window.openCase = async id => {
  const r = await fetch("/api/cases/" + encodeURIComponent(id));
  const c = await r.json();
  currentCase = c;
  document.querySelector('[data-page="assessment"]').click();
  $("consent").checked = true;
  $("mode").value = "text";
  syncMode();
  $("narrative").value = c.narrative;
  renderAssessment(c);
  $("updateCard").classList.remove("hidden");
  $("detailCard").classList.remove("hidden");
};

$("refresh").onclick = loadCases;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
